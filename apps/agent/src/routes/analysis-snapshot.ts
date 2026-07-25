/**
 * ANALYZING turn-bounded snapshot helpers(ADR-0020 D10 · ticket 06)
 *
 * Scope:为 `start` handler 的双 turn(turn-1 admission / turn-2 brainstorm)
 * 在 chunks.jsonl 第一次写之前各做一次 snapshot;空 turn(0 chunk)不 snapshot;
 * snapshot 失败不阻断后续 turn(decision 47 best-effort);StatusBar 回滚菜单
 * 通过 list + restore 还原到 latest session。
 *
 * 路径(沿用 ADR-0009 既有 `<req-id>/<ts>/` 命名规范,把 `<ts>` 槽换成语义化 id):
 *   <AIDEVSPACE_SNAPSHOT_DIR>/<req-id>/<snapshotId>/chunks.jsonl
 *
 * Sidecar:
 *   <AIDEVSPACE_SNAPSHOT_DIR>/<req-id>/<snapshotId>/.session-id
 *   写入产生该 snapshot 的 session id,让 list API 在不知道 session 时
 *   仍能告诉前端 "这 snapshot 来自哪条 session",前端 restore 即可定位。
 *
 * 不在范围内:
 * - technical-brief.md / modules.yaml 已有 snapshotBeforeWriteAgent 路径(generate-brief),不复用
 * - 不引入 chunk-row 粒度的 snapshot(only turn-bounded)
 * - 不动 StatusBar 其它面板;StatusBar 自己负责 list 拉取与 restore POST
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** turn-bounded snapshot 语义 id 集合 —— ADR-0020 D10 字面契约 */
export const SESSION_SNAPSHOT_IDS = ['before_admission', 'before_brainstorm'] as const
export type SessionSnapshotId = (typeof SESSION_SNAPSHOT_IDS)[number]

/** session id sidecar 文件名 —— 与 chunks.jsonl 同目录 */
const SESSION_ID_SIDECAR = '.session-id'

/** 公共查询返回的元数据 shape(供 REST 序列化与前端 dropdown 消费) */
export interface SessionSnapshotEntry {
  id: SessionSnapshotId
  sessionId: string | null
  takenAt: string | null
}

export type RestoreResult =
  | {
      ok: true
      restoredSessionId: string
      chunksPath: string
      restoredAt: string
      /** 还原出的 chunks.jsonl 行数(空 = 0) */
      chunksLines: number
    }
  | {
      ok: false
      error: 'snapshot_not_found' | 'snapshot_dir_unset' | 'no_active_session'
      reason?: string
    }

/** env 闸门:AIDEVSPACE_SNAPSHOT_DIR 未设 → 所有写操作 best-effort 跳过 */
function snapshotRoot(): string | null {
  return process.env.AIDEVSPACE_SNAPSHOT_DIR ?? null
}

/** workspace root(给 restore 写回用,沿用 analysis.ts 同款 fallback 链) */
function workspaceRoot(): string {
  return process.env.AIDEVSPACE_ROOT ?? defaultRoot()
}

function defaultRoot(): string {
  try {
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

/**
 * 写前 snapshot hook(turn-bounded 版,decision 47 · ADR-0009 第 4 层)。
 *
 * 原子地拷贝 `<sessionDir>/chunks.jsonl` 到 `<snapRoot>/<reqId>/<snapshotId>/chunks.jsonl`
 * 并写入 `.session-id` sidecar —— 让 list 端点能把 snapshot 与产生它的 session 配对。
 *
 * 失败静默(best-effort)—— snapshot 不应阻断主流程;chunks.jsonl 与 sidecar 同
 * try/catch 块,任一失败整组 no-op(避免 list 看到一半产物)。
 */
export function takeSessionSnapshot(
  sessionDir: string,
  reqId: string,
  snapshotId: SessionSnapshotId,
  sessionId: string,
): void {
  const root = snapshotRoot()
  if (!root) return
  try {
    const targetDir = join(root, reqId, snapshotId)
    mkdirSync(targetDir, { recursive: true })
    const source = join(sessionDir, 'chunks.jsonl')
    if (existsSync(source)) {
      writeFileSync(join(targetDir, 'chunks.jsonl'), readFileSync(source))
    }
    writeFileSync(join(targetDir, SESSION_ID_SIDECAR), sessionId, 'utf8')
  } catch {
    /* best-effort */
  }
}

/**
 * Inverse of `snapshotSessionBeforeTurn` —— turn 写 0 chunk 时清掉空 snapshot,
 * 避免磁盘堆积无意义副本。失败静默。
 */
export function removeSessionSnapshot(
  reqId: string,
  snapshotId: SessionSnapshotId,
): void {
  const root = snapshotRoot()
  if (!root) return
  try {
    rmSync(join(root, reqId, snapshotId), { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
}

/**
 * 列 req-id 下所有 turn-bounded snapshot —— REST `GET /api/.../snapshots` 消费。
 *
 * 过滤规则:目录存在 + 含 chunks.jsonl(空 turn 被 remove 后不会进列表);
 * sessionId 从 `.session-id` sidecar 读;takenAt 取目录 mtime ISO。
 */
export function listSessionSnapshots(reqId: string): SessionSnapshotEntry[] {
  const root = snapshotRoot()
  if (!root) return []
  const reqDir = join(root, reqId)
  if (!existsSync(reqDir)) return []
  const out: SessionSnapshotEntry[] = []
  for (const id of SESSION_SNAPSHOT_IDS) {
    const chunksPath = join(reqDir, id, 'chunks.jsonl')
    if (!existsSync(chunksPath)) continue
    let sessionId: string | null = null
    const sidecarPath = join(reqDir, id, SESSION_ID_SIDECAR)
    if (existsSync(sidecarPath)) {
      try {
        sessionId = readFileSync(sidecarPath, 'utf8').trim() || null
      } catch {
        sessionId = null
      }
    }
    let takenAt: string | null = null
    try {
      takenAt = statSync(join(reqDir, id)).mtime.toISOString()
    } catch {
      takenAt = null
    }
    out.push({ id, sessionId, takenAt })
  }
  return out
}

/**
 * 找到 req-id 下 mtime 最新的 session 目录(不带 .jsonl / .yaml 后缀)。
 * 若 sessions/ 目录不存在或为空 → 返 null。
 */
function latestSessionDir(reqId: string): { dir: string; sessionId: string } | null {
  const base = join(workspaceRoot(), 'requirements', reqId, 'analysis', 'sessions')
  if (!existsSync(base)) return null
  const entries = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())
  if (entries.length === 0) return null
  const sorted = entries
    .map((e) => {
      let mtime = 0
      try {
        mtime = statSync(join(base, e.name)).mtime.getTime()
      } catch {
        mtime = 0
      }
      return { name: e.name, mtime }
    })
    .sort((a, b) => b.mtime - a.mtime)
  return { dir: join(base, sorted[0].name), sessionId: sorted[0].name }
}

/**
 * 把 snapshot 还原到 latest session 的 chunks.jsonl —— ticket 06 字面契约
 * "回滚到一个已知 good 状态"。失败分类(便于 REST 端点映射状态码):
 *
 * - snapshot_dir_unset → AIDEVSPACE_SNAPSHOT_DIR 未设
 * - snapshot_not_found → snapshot 文件不存在(可能空 turn 被清掉)
 * - no_active_session → 该 req 下还没有 session
 *
 * 注:本期不拒 `is_streaming` session(decision 47 + ticket 06 字面)—— 用户主动
 * 点回滚 = 接受覆盖风险,后续可由 SessionStore 的 mtime + chunks.jsonl 大小校验
 * 决定是否真覆盖(本期不做)。
 */
export function restoreSnapshot(
  reqId: string,
  snapshotId: SessionSnapshotId,
): RestoreResult {
  const root = snapshotRoot()
  if (!root) {
    return { ok: false, error: 'snapshot_dir_unset', reason: 'AIDEVSPACE_SNAPSHOT_DIR not set' }
  }
  const sourcePath = join(root, reqId, snapshotId, 'chunks.jsonl')
  if (!existsSync(sourcePath)) {
    return { ok: false, error: 'snapshot_not_found' }
  }
  const latest = latestSessionDir(reqId)
  if (!latest) {
    return { ok: false, error: 'no_active_session' }
  }
  const targetPath = join(latest.dir, 'chunks.jsonl')
  const restored = readFileSync(sourcePath).toString('utf8')
  writeFileSync(targetPath, restored)
  const chunksLines =
    restored.length === 0
      ? 0
      : restored.split('\n').filter((l: string) => l.trim().length > 0).length
  return {
    ok: true,
    restoredSessionId: latest.sessionId,
    chunksPath: targetPath,
    restoredAt: new Date().toISOString(),
    chunksLines,
  }
}

/**
 * Type guard:服务端校验 snapshot_id 是否在白名单(给 REST 端点用)。
 */
export function isSessionSnapshotId(v: unknown): v is SessionSnapshotId {
  return typeof v === 'string' && (SESSION_SNAPSHOT_IDS as readonly string[]).includes(v)
}