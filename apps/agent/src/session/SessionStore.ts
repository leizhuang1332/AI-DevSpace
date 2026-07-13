/**
 * SessionStore —— ADR-0010 Q7.1 / Q7.2 (会话 meta CRUD)
 *
 * 职责:管理 `<root>/requirements/<reqId>/sessions/<localSid>/meta.yaml`。
 *
 * 双 ID (Q7.1):
 *   - `sid` (= local_sid):Agent 生成的 UUID,永久稳定,路径/URL/引用都用它
 *   - `sdkSessionId`:SDK 返的,首次 query 后由 SessionRecorder 回填(创建时留空)
 *   - `provider`:标记所属 SDK,便于未来切 Codex/Opencode 时批量迁移
 *
 * 对外接口只收 `localSid`,靠 findSessionDir 反查 reqId(见 sessionPaths.ts)。
 * 写盘走 tmp+rename 原子写(对齐 WorkspaceService)。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile, rename, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import yaml from 'yaml'
import type { ModelSelection, SessionKind } from '../providers/AIProvider.js'
import {
  sessionDirFor,
  sessionsDirFor,
  metaPathFor,
  findSessionDir,
} from './sessionPaths.js'

/** session meta.yaml 完整形态 —— ADR-0010 Q7.3 */
export interface SessionMeta {
  /** local_sid —— Agent 生成的 UUID,永久稳定 (Q7.1) */
  sid: string
  /** 父需求 id */
  reqId: string
  /** 所属 SDK (Q7.1);本期固定 'claude-code' */
  provider: string
  /** SDK 返的 session_id;创建时留空,首次 query 后回填 */
  sdkSessionId: string
  /** ISO 8601 创建时间 */
  created_at: string
  /** ISO 8601 最近活跃时间 */
  last_active_at: string
  /** 用户起名 / 系统生成 */
  topic: string
  /** chat / task */
  kind: SessionKind
  /** SDK 子进程 cwd */
  cwd?: string
  /** 当前 focus (Q5 dynamic prompt 用) */
  current_focus?: string
  /** 用户手选的 model (Q9.1);未选时用 provider.main 兜底 */
  model?: ModelSelection
  /** SDK 找不到旧 session 时重建的标记 (Q8.6 / ResumeManager) */
  recovered?: boolean
  /** 归档标记 */
  archived?: boolean
}

/** createSession 入参 */
export interface CreateSessionMetaOptions {
  topic: string
  kind: SessionKind
  cwd?: string
  current_focus?: string
  model?: ModelSelection
  /** provider 覆盖;默认 'claude-code' */
  provider?: string
}

export interface SessionStoreDeps {
  /** workspace 根路径 (WorkspaceService.resolveRoot()) */
  root: string
  /** 时间戳注入 —— 便于测试;默认 new Date().toISOString() */
  now?: () => string
}

const DEFAULT_PROVIDER = 'claude-code'

export class SessionStore {
  readonly #root: string
  readonly #now: () => string

  constructor(deps: SessionStoreDeps) {
    this.#root = deps.root
    this.#now = deps.now ?? (() => new Date().toISOString())
  }

  /**
   * 新建 session:生成 local_sid,立即写 meta.yaml(sdkSessionId 留空)。
   * 对齐验收「用户点新建会话 → meta.yaml 立即创建」。
   */
  async createSession(
    reqId: string,
    opts: CreateSessionMetaOptions,
  ): Promise<SessionMeta> {
    const sid = randomUUID()
    const ts = this.#now()
    const meta: SessionMeta = {
      sid,
      reqId,
      provider: opts.provider ?? DEFAULT_PROVIDER,
      sdkSessionId: '',
      created_at: ts,
      last_active_at: ts,
      topic: opts.topic,
      kind: opts.kind,
      ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
      ...(opts.current_focus !== undefined ? { current_focus: opts.current_focus } : {}),
      ...(opts.model !== undefined ? { model: opts.model } : {}),
    }
    await this.#writeMeta(sessionDirFor(this.#root, reqId, sid), metaPathFor(this.#root, reqId, sid), meta)
    return meta
  }

  /** 读回 session meta;找不到返回 null */
  async getSession(localSid: string): Promise<SessionMeta | null> {
    const found = findSessionDir(this.#root, localSid)
    if (!found) return null
    return this.#readMeta(metaPathFor(this.#root, found.reqId, localSid))
  }

  /** 列 req 下全部 session,按 created_at 升序;无目录返回 [] */
  async listSessions(reqId: string): Promise<SessionMeta[]> {
    const parent = sessionsDirFor(this.#root, reqId)
    let entries: Dirent[]
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch {
      return []
    }
    const metas: SessionMeta[] = []
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const meta = await this.#readMeta(metaPathFor(this.#root, reqId, e.name))
      if (meta) metas.push(meta)
    }
    metas.sort((a, b) => a.created_at.localeCompare(b.created_at))
    return metas
  }

  /**
   * 合并 patch 到 meta,刷新 last_active_at,原子写回。
   * 典型用途:首次 query 后回填 sdkSessionId(双 ID 维护)。
   * sid / reqId / created_at 不允许被 patch 覆盖。
   */
  async updateSession(
    localSid: string,
    patch: Partial<Omit<SessionMeta, 'sid' | 'reqId' | 'created_at'>>,
  ): Promise<SessionMeta> {
    const found = findSessionDir(this.#root, localSid)
    if (!found) throw new Error(`SessionStore.updateSession: session ${localSid} not found`)
    const current = await this.#readMeta(metaPathFor(this.#root, found.reqId, localSid))
    if (!current) throw new Error(`SessionStore.updateSession: meta.yaml missing for ${localSid}`)

    const next: SessionMeta = {
      ...current,
      ...patch,
      // 保护不可变字段
      sid: current.sid,
      reqId: current.reqId,
      created_at: current.created_at,
      last_active_at: this.#now(),
    }
    await this.#writeMeta(found.dir, metaPathFor(this.#root, found.reqId, localSid), next)
    return next
  }

  /** 归档:标 archived:true(不删盘) */
  async archiveSession(localSid: string): Promise<SessionMeta> {
    return this.updateSession(localSid, { archived: true })
  }

  // ===== private =====

  async #readMeta(path: string): Promise<SessionMeta | null> {
    if (!existsSync(path)) return null
    const raw = await readFile(path, 'utf8')
    const parsed = yaml.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as SessionMeta
  }

  async #writeMeta(dir: string, path: string, meta: SessionMeta): Promise<void> {
    await mkdir(dir, { recursive: true })
    const text = yaml.stringify(meta, { indent: 2, lineWidth: 0 })
    const tmp = path + '.tmp'
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, path)
  }
}
