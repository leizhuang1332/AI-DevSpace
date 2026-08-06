/**
 * TaskCardTranscript —— 物理独立 transcript 读写 + 父 snapshot 派生
 *
 * ADR-0028 D1 / D3 / D6 实现要点:
 *
 * 1. **物理独立** —— 每张 TaskCard 各自的 transcript 落
 *    `<root>/requirements/<req-id>/board/tasks/<cardId>/transcript.yaml`,
 *    与父 analyzing transcript 互不引用字段。
 *
 * 2. **派生父 snapshot** —— TaskCard transcript 创建时一次性拍父 analyzing
 *    transcript 末尾 K 条消息作为初始上下文,记录 `snapshot_at` +
 *    `messages_count` + `snapshot_hash`(sha256 规范化后序列化);后续父
 *    transcript 变化不影响本 transcript(快照稳定,符合 ADR-0028 D3「派生
 *    而不是实时引用」取舍)。
 *
 * 3. **不挂 Run 守门** —— `appendMessage` 永远把 `tool_calls` 写为 `[]`;
 *    即使 caller 传非空也覆盖,符合 ADR-0028 D2(详情页右抽屉不渲染
 *    「开始 Run」按钮 + 不挂 Run)。
 *
 * 4. **atomic 写** —— 沿用 `writeFileAtomic`(tmp + rename 模式),防止 fsync
 *    期间崩溃撕裂 YAML。
 *
 * 5. **SSR 容错** —— 读操作在文件不存在 / 解析失败时返默认值,不抛错;
 *    父 transcript 不存在时 snapshot 为「空快照」(messages_count=0,
 *    snapshot_hash=sha256:<空串哈希>)。
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import yaml from 'yaml'
import {
  ParentTranscriptSnapshotSchema,
  TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
  TaskCardTranscriptSchema,
  TranscriptMessageSchema,
  type ParentTranscriptSnapshot,
  type TaskCardTranscript,
  type TranscriptMessage,
} from '@ai-devspace/shared'

/** 默认 snapshot 大小(K=10,ADR-0028 D3 实施阶段定) */
export const DEFAULT_TRANSCRIPT_SNAPSHOT_K = 10

/** TaskCard transcript 物理路径 */
export function taskCardTranscriptPathFor(
  workspaceRoot: string,
  requirementId: string,
  cardId: string,
): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'board',
    'tasks',
    cardId,
    'transcript.yaml',
  )
}

/** 父 analyzing transcript 物理路径(用于派生初始快照) */
export function parentAnalyzingTranscriptPathFor(
  workspaceRoot: string,
  requirementId: string,
): string {
  return join(
    workspaceRoot,
    'requirements',
    requirementId,
    'analyzing',
    'transcript.yaml',
  )
}

/**
 * 规范化父 transcript 的 messages 数组,产出稳定字节序(用于 sha256)。
 *
 * 设计要点:
 * - 父 transcript 走 YAML,key 顺序不稳定;JSON 序列化天然有序。
 * - 取核心 4 字段(`ts` + `role` + `content` + `refs`)→ JSON 序列化。
 * - `tool_calls` 不参与 hash —— TaskCard transcript 不关心父 transcript
 *   的工具调用细节,只关心"对话流是什么"。
 * - `ts` 保留:父 transcript 一旦写入不再追加(顺序追加日志),`ts`
 *   视为稳定字段;后续若有抖动(改写旧消息),snapshot_hash 会变化,
 *   caller 可据此决策是否重建 transcript。
 */
function canonicalizeParentMessages(
  messages: unknown[],
): string {
  const slim = messages.map((m) => {
    if (!m || typeof m !== 'object') return null
    const msg = m as Record<string, unknown>
    return {
      ts: typeof msg.ts === 'string' ? msg.ts : '',
      role: typeof msg.role === 'string' ? msg.role : '',
      content: typeof msg.content === 'string' ? msg.content : '',
      refs: Array.isArray(msg.refs) ? msg.refs : [],
    }
  })
  // sort_keys 友好:JSON.stringify 第二参数用数组按固定顺序写 key
  return JSON.stringify(slim)
}

/** sha256(规范化后字符串),格式 `sha256:<64hex>` —— 与 ParentTranscriptSnapshotSchema 正则一致 */
function sha256Hex(canonical: string): string {
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex')
}

// ---------------------------------------------------------------------------
// 读父 transcript(用于派生 snapshot)
// ---------------------------------------------------------------------------

/**
 * 解析父 analyzing transcript 文件,容错返默认值。
 *
 * 父 transcript 的 schema 与 TaskCard transcript 共享 messages 形态
 * (ts / role / content / refs,见 ADR-0028 D6 表格),因此用同一组
 * zod schema 校验;`tool_calls` 字段父端可能存在(TaskCard 端强制 [])。
 *
 * 不存在 / 解析失败 / 缺 messages 字段 → 返空 messages;不抛错。
 */
export function readParentAnalyzingTranscript(
  workspaceRoot: string,
  requirementId: string,
): TranscriptMessage[] {
  const file = parentAnalyzingTranscriptPathFor(workspaceRoot, requirementId)
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  let parsed: unknown
  try {
    parsed = yaml.parse(raw)
  } catch {
    return []
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const obj = parsed as Record<string, unknown>
  if (!Array.isArray(obj.messages)) return []
  const out: TranscriptMessage[] = []
  for (const m of obj.messages) {
    const r = TranscriptMessageSchema.safeParse(m)
    if (r.success) out.push(r.data)
  }
  return out
}

/**
 * 派生父 transcript snapshot —— 取末尾 K 条,计算 sha256。
 *
 * 父 transcript 不存在 / 为空 → messages_count=0,snapshot_hash 仍合法
 * (sha256: 空字符串的哈希,稳定的可重复值),后续 schema 升级可识别。
 *
 * `K` 默认 10(ADR-0028 D3 实施阶段定);允许 caller 覆盖(rollout 用户可配,
 * 留口)。
 */
export function deriveParentSnapshot(params: {
  workspaceRoot: string
  requirementId: string
  snapshotAt?: string
  K?: number
}): ParentTranscriptSnapshot {
  const K = params.K ?? DEFAULT_TRANSCRIPT_SNAPSHOT_K
  const parentMessages = readParentAnalyzingTranscript(
    params.workspaceRoot,
    params.requirementId,
  )
  const tail = parentMessages.slice(-K)
  const canonical = canonicalizeParentMessages(tail)
  const hash = sha256Hex(canonical)
  return ParentTranscriptSnapshotSchema.parse({
    snapshot_at: params.snapshotAt ?? new Date().toISOString(),
    messages_count: tail.length,
    snapshot_hash: hash,
  })
}

// ---------------------------------------------------------------------------
// atomic write(沿用 AnalysisRunService 模式)
// ---------------------------------------------------------------------------

/** atomic 写文件(tmp + rename);防止 fsync 期间崩溃撕裂 YAML */
function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}

// ---------------------------------------------------------------------------
// TaskCardTranscript 读写
// ---------------------------------------------------------------------------

/**
 * TaskCard transcript 持久化 + 派生 snapshot 服务。
 *
 * 单实例足够(无状态,纯文件 IO);workspaceRoot 通过构造注入,便于测试
 * 用 mkdtemp 隔离。
 */
export class TaskCardTranscriptService {
  constructor(public readonly workspaceRoot: string) {}

  /** transcript 物理路径 */
  transcriptPathFor(requirementId: string, cardId: string): string {
    return taskCardTranscriptPathFor(this.workspaceRoot, requirementId, cardId)
  }

  /**
   * 读 transcript。文件不存在 → 返 null(SSR 容错,UI 可继续渲染)。
   * 文件存在但解析失败 → 返 null(避免给前端脏数据;UI 走空态分支)。
   */
  read(
    requirementId: string,
    cardId: string,
  ): TaskCardTranscript | null {
    const file = this.transcriptPathFor(requirementId, cardId)
    if (!existsSync(file)) return null
    let raw: string
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = yaml.parse(raw)
    } catch {
      return null
    }
    const r = TaskCardTranscriptSchema.safeParse(parsed)
    return r.success ? r.data : null
  }

  /**
   * 写 transcript(atomic)。
   *
   * 守门:
   * - 写入前 zod 二次校验(防 caller 直接构造绕过 schema)
   * - 自动强制 messages[*].tool_calls = [](即使 caller 传入非空)
   *
   * 路径父目录不存在 → mkdir -p(沿用 decision 36「目录即真相」)。
   */
  write(
    requirementId: string,
    cardId: string,
    transcript: TaskCardTranscript,
  ): { ok: true; path: string } | { ok: false; code: 'invalid_transcript' } {
    const sanitized: TaskCardTranscript = {
      ...transcript,
      messages: transcript.messages.map((m) => ({
        ...m,
        tool_calls: [],
      })),
    }
    const validated = TaskCardTranscriptSchema.safeParse(sanitized)
    if (!validated.success) return { ok: false, code: 'invalid_transcript' }

    const path = this.transcriptPathFor(requirementId, cardId)
    writeFileAtomic(path, yaml.stringify(validated.data))
    return { ok: true, path }
  }

  /**
   * 创建初始 transcript —— 派生父 snapshot + 空 messages。
   *
   * 文件已存在 → 覆盖(允许"重置 transcript"运维动作);若不希望覆盖,
   * caller 应当先 `read` 检查。
   */
  createInitial(
    requirementId: string,
    cardId: string,
    options?: { snapshotAt?: string; K?: number },
  ): TaskCardTranscript {
    const parentSnapshot = deriveParentSnapshot({
      workspaceRoot: this.workspaceRoot,
      requirementId,
      snapshotAt: options?.snapshotAt,
      K: options?.K,
    })
    return TaskCardTranscriptSchema.parse({
      schema_version: TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
      task_card_id: cardId,
      parent_transcript_snapshot: parentSnapshot,
      messages: [],
    })
  }

  /**
   * 追加一条消息。
   *
   * 守门:
   * - `tool_calls` 永远覆盖为 `[]`(即使 caller 传非空)
   * - ts 由本方法强制写为调用时刻(caller 传 ts 字段会被忽略);
   *   这样保证 ts 单调由服务层决定,schema 端不开放自定义。
   *
   * transcript 不存在 → 自动创建初始 transcript(派生父 snapshot),
   * 再追加。返回「追加后的完整 transcript」。
   */
  appendMessage(
    requirementId: string,
    cardId: string,
    input: {
      role: 'user' | 'assistant'
      content: string
      refs?: TranscriptMessage['refs']
    },
  ): TaskCardTranscript {
    const existing =
      this.read(requirementId, cardId) ??
      this.createInitial(requirementId, cardId)
    const newMessage = TranscriptMessageSchema.parse({
      ts: new Date().toISOString(),
      role: input.role,
      content: input.content,
      refs: input.refs ?? [],
      tool_calls: [],
    })
    const next: TaskCardTranscript = {
      ...existing,
      messages: [...existing.messages, newMessage],
    }
    this.write(requirementId, cardId, next)
    return next
  }
}