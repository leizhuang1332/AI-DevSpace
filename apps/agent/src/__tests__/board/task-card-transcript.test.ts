/**
 * TaskCardTranscript 单测 — issue 04 / ADR-0028
 *
 * 覆盖验收项:
 * - transcript.yaml round-trip(写入 → 读出 = 一致)
 * - 派生 snapshot hash 复算(同样父 transcript → 同样 hash)
 * - tool_calls 永远空(写入时即使传入非空也覆盖为 [])
 * - appendMessage 在 transcript 不存在时自动创建初始 transcript
 * - read() 文件不存在 / 解析失败返 null(SSR 容错)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import yaml from 'yaml'
import {
  TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
  type TaskCardTranscript,
} from '@ai-devspace/shared'
import {
  DEFAULT_TRANSCRIPT_SNAPSHOT_K,
  TaskCardTranscriptService,
  deriveParentSnapshot,
  parentAnalyzingTranscriptPathFor,
  readParentAnalyzingTranscript,
} from '../../services/board/TaskCardTranscript.js'

const REQ_ID = 'req-2026-test'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKXA'

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aidevsp-tcard-trans-'))
}

/** 构造合法的 transcript(测试用 baseline) */
function makeTranscript(
  overrides: Partial<TaskCardTranscript> = {},
): TaskCardTranscript {
  return {
    schema_version: TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
    task_card_id: CARD_ID,
    parent_transcript_snapshot: {
      snapshot_at: '2026-08-06T08:00:00.000Z',
      messages_count: 0,
      snapshot_hash:
        'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    messages: [],
    ...overrides,
  }
}

/** 写一个 YAML 文件到指定路径(自动 mkdir -p 父目录),消除重复样板 */
function writeYamlFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

describe('TaskCardTranscriptService — issue 04', () => {
  let root: string
  let svc: TaskCardTranscriptService

  beforeEach(() => {
    root = tmpRoot()
    svc = new TaskCardTranscriptService(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // 物理路径
  // -------------------------------------------------------------------------

  it('uses the per-card transcript path under board/tasks/<cardId>/', () => {
    const path = svc.transcriptPathFor(REQ_ID, CARD_ID)
    expect(path).toBe(
      join(root, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'transcript.yaml'),
    )
  })

  // -------------------------------------------------------------------------
  // round-trip
  // -------------------------------------------------------------------------

  it('round-trips a transcript: write → read = identical', () => {
    const original = makeTranscript({
      messages: [
        {
          ts: '2026-08-06T09:00:00.000Z',
          role: 'user',
          content: '我想澄清 webhook 处理顺序',
          refs: [
            {
              kind: 'prd_section',
              path: 'requirement.md',
              line_range: [12, 18],
            },
          ],
          tool_calls: [],
        },
        {
          ts: '2026-08-06T09:00:30.000Z',
          role: 'assistant',
          content: '建议先考虑 ...(文本回复,不调工具)',
          refs: [],
          tool_calls: [],
        },
      ],
    })
    const w = svc.write(REQ_ID, CARD_ID, original)
    expect(w.ok).toBe(true)
    if (!w.ok) return
    expect(w.path).toBe(svc.transcriptPathFor(REQ_ID, CARD_ID))

    const read = svc.read(REQ_ID, CARD_ID)
    expect(read).toEqual(original)
  })

  it('write preserves all messages and refs faithfully', () => {
    const original = makeTranscript({
      messages: [
        {
          ts: '2026-08-06T09:00:00.000Z',
          role: 'user',
          content: '看 Run #17 产物',
          refs: [{ kind: 'run_id', run_id: 'run-abc123' }],
          tool_calls: [],
        },
        {
          ts: '2026-08-06T09:01:00.000Z',
          role: 'assistant',
          content: '已读取该 Run 的 issues.jsonl',
          refs: [
            { kind: 'run_id', run_id: 'run-abc123' },
            { kind: 'asset', name: 'diagram.png' },
          ],
          tool_calls: [],
        },
      ],
    })
    svc.write(REQ_ID, CARD_ID, original)
    const read = svc.read(REQ_ID, CARD_ID)
    expect(read?.messages).toHaveLength(2)
    expect(read?.messages[0]?.refs[0]).toEqual({ kind: 'run_id', run_id: 'run-abc123' })
    expect(read?.messages[1]?.refs).toHaveLength(2)
  })

  // -------------------------------------------------------------------------
  // tool_calls 永远空(ADR-0028 D2 守门)
  // -------------------------------------------------------------------------

  it('write() forces tool_calls=[] on every message even when caller provides values', () => {
    const original = makeTranscript({
      messages: [
        {
          ts: '2026-08-06T09:00:00.000Z',
          role: 'assistant',
          content: '试图偷偷塞 tool_calls',
          refs: [],
          // 故意塞非空 tool_calls —— 写入时必须被覆盖
          tool_calls: [{ name: 'run_analysis', input: { skill_name: 'x' } }],
        },
      ],
    })
    const w = svc.write(REQ_ID, CARD_ID, original)
    expect(w.ok).toBe(true)

    // 从磁盘重新解析(防止内存被改但磁盘没改的伪 GREEN)
    const raw = yaml.parse(
      readFileSync(svc.transcriptPathFor(REQ_ID, CARD_ID), 'utf8'),
    ) as TaskCardTranscript
    expect(raw.messages[0]?.tool_calls).toEqual([])
    expect(raw.messages[0]?.tool_calls).toHaveLength(0)
  })

  // -------------------------------------------------------------------------
  // 父 snapshot 派生
  // -------------------------------------------------------------------------

  describe('deriveParentSnapshot', () => {
    /** 写一个父 transcript 文件到指定路径,包含 N 条 user 消息 */
    function writeParentTranscript(count: number): void {
      const path = parentAnalyzingTranscriptPathFor(root, REQ_ID)
      const messages = Array.from({ length: count }).map((_, i) => ({
        ts: new Date(2026, 7, 6, 8, i).toISOString(),
        role: 'user' as const,
        content: `父 transcript 消息 ${i}`,
        refs: [],
      }))
      writeYamlFile(path, yaml.stringify({ messages }))
    }

    it('returns messages_count=0 and stable empty hash when parent transcript missing', () => {
      // 不创建父 transcript
      const snap = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
      })
      expect(snap.messages_count).toBe(0)
      // sha256: 规范化空数组 (JSON.stringify([])) 的 64hex 哈希
      // —— 这里改用正则校验格式 + idempotency,而非硬编码,允许未来
      // canonicalizeParentMessages 内部调整时只更新一处。
      expect(snap.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
      // 同样的「空父 transcript」必须每次产出同样 hash(idempotency)
      const snap2 = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
      })
      expect(snap.snapshot_hash).toBe(snap2.snapshot_hash)
      expect(snap.snapshot_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('takes last K messages and computes stable hash', () => {
      writeParentTranscript(15)
      const K = 5
      const snap = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K,
      })
      expect(snap.messages_count).toBe(K)
      expect(snap.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })

    it('produces identical hash for identical parent content (idempotency)', () => {
      writeParentTranscript(15)
      const a = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K: 10,
      })
      const b = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K: 10,
      })
      expect(a.snapshot_hash).toBe(b.snapshot_hash)
      expect(a.messages_count).toBe(b.messages_count)
    })

    it('matches an independently computed SHA-256 of the last K canonicalized parent messages', () => {
      // 验收门「派生 snapshot 复算 hash」:不依赖实现,直接读父 transcript
      // YAML,独立做 canonicalization + SHA-256,验证与 deriveParentSnapshot
      // 产出匹配 —— 任何 canonicalization 偏移会立即 RED。
      const N = 15
      const K = 10
      writeParentTranscript(N)

      // 1) 直接从磁盘读父 transcript(模拟 caller 视角)
      const raw = yaml.parse(
        readFileSync(parentAnalyzingTranscriptPathFor(root, REQ_ID), 'utf8'),
      ) as { messages: Array<Record<string, unknown>> }
      const tail = raw.messages.slice(-K)

      // 2) 独立 canonicalize:与实现一致的 4 字段(slim)→ JSON
      const slim = tail.map((m) => ({
        ts: typeof m.ts === 'string' ? m.ts : '',
        role: typeof m.role === 'string' ? m.role : '',
        content: typeof m.content === 'string' ? m.content : '',
        refs: Array.isArray(m.refs) ? m.refs : [],
      }))
      const canonical = JSON.stringify(slim)
      const expectedHash =
        'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('hex')

      // 3) 调用实现,验证 hash 一致
      const snap = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K,
      })
      expect(snap.snapshot_hash).toBe(expectedHash)
      expect(snap.messages_count).toBe(K)
    })

    it('hash changes when parent content changes', () => {
      writeParentTranscript(5)
      const a = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K: 10,
      })
      // 追加一条新消息
      writeParentTranscript(6)
      const b = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K: 10,
      })
      expect(a.snapshot_hash).not.toBe(b.snapshot_hash)
    })

    it('caps messages_count at K even when parent has fewer messages', () => {
      writeParentTranscript(3)
      const snap = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
        K: 10,
      })
      expect(snap.messages_count).toBe(3)
    })

    it('default K equals DEFAULT_TRANSCRIPT_SNAPSHOT_K', () => {
      writeParentTranscript(20)
      const snap = deriveParentSnapshot({
        workspaceRoot: root,
        requirementId: REQ_ID,
      })
      expect(snap.messages_count).toBe(DEFAULT_TRANSCRIPT_SNAPSHOT_K)
      expect(DEFAULT_TRANSCRIPT_SNAPSHOT_K).toBe(10)
    })
  })

  // -------------------------------------------------------------------------
  // readParentAnalyzingTranscript 容错
  // -------------------------------------------------------------------------

  describe('readParentAnalyzingTranscript', () => {
    it('returns empty array when parent transcript missing', () => {
      expect(readParentAnalyzingTranscript(root, REQ_ID)).toEqual([])
    })

    it('returns empty array when parent transcript is malformed', () => {
      const path = parentAnalyzingTranscriptPathFor(root, REQ_ID)
      writeYamlFile(path, ':::not yaml :::\n  broken: [' )
      expect(readParentAnalyzingTranscript(root, REQ_ID)).toEqual([])
    })

    it('returns empty array when parent transcript has no messages field', () => {
      const path = parentAnalyzingTranscriptPathFor(root, REQ_ID)
      writeYamlFile(path, 'schema_version: 1\n')
      expect(readParentAnalyzingTranscript(root, REQ_ID)).toEqual([])
    })

    it('skips invalid messages but keeps valid ones', () => {
      const path = parentAnalyzingTranscriptPathFor(root, REQ_ID)
      const good = {
        ts: '2026-08-06T08:00:00.000Z',
        role: 'user',
        content: '有效消息',
        refs: [],
        tool_calls: [],
      }
      // 在 messages 数组中混入一个非对象(应被 zod 校验拒绝并跳过)
      writeYamlFile(
        path,
        yaml.stringify({ messages: [good, 'not an object', good] }),
      )
      const out = readParentAnalyzingTranscript(root, REQ_ID)
      expect(out).toHaveLength(2)
      expect(out[0]?.content).toBe('有效消息')
    })
  })

  // -------------------------------------------------------------------------
  // read 容错
  // -------------------------------------------------------------------------

  describe('read', () => {
    it('returns null when transcript file does not exist', () => {
      expect(svc.read(REQ_ID, CARD_ID)).toBeNull()
    })

    it('returns null when transcript yaml is malformed', () => {
      const path = svc.transcriptPathFor(REQ_ID, CARD_ID)
      writeYamlFile(path, 'broken: [' )
      expect(svc.read(REQ_ID, CARD_ID)).toBeNull()
    })

    it('returns null when transcript fails schema validation', () => {
      const path = svc.transcriptPathFor(REQ_ID, CARD_ID)
      // schema_version 故意非法(schema 限定 literal 1)
      writeYamlFile(
        path,
        yaml.stringify({
          schema_version: 99,
          task_card_id: CARD_ID,
          parent_transcript_snapshot: {
            snapshot_at: '2026-08-06T08:00:00.000Z',
            messages_count: 0,
            snapshot_hash:
              'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          },
          messages: [],
        }),
      )
      expect(svc.read(REQ_ID, CARD_ID)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // createInitial
  // -------------------------------------------------------------------------

  describe('createInitial', () => {
    it('creates a transcript with derived parent snapshot and empty messages', () => {
      const t = svc.createInitial(REQ_ID, CARD_ID)
      expect(t.schema_version).toBe(TASK_CARD_TRANSCRIPT_SCHEMA_VERSION)
      expect(t.task_card_id).toBe(CARD_ID)
      expect(t.messages).toEqual([])
      expect(t.parent_transcript_snapshot.messages_count).toBe(0)
      expect(t.parent_transcript_snapshot.snapshot_hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    })

    it('persists the initial transcript to disk and re-reads equal', () => {
      const t = svc.createInitial(REQ_ID, CARD_ID)
      svc.write(REQ_ID, CARD_ID, t)
      const r = svc.read(REQ_ID, CARD_ID)
      expect(r).toEqual(t)
    })
  })

  // -------------------------------------------------------------------------
  // appendMessage
  // -------------------------------------------------------------------------

  describe('appendMessage', () => {
    it('appends user message to existing transcript', () => {
      const initial = svc.createInitial(REQ_ID, CARD_ID)
      svc.write(REQ_ID, CARD_ID, initial)
      const next = svc.appendMessage(REQ_ID, CARD_ID, {
        role: 'user',
        content: '我想澄清 webhook 处理顺序',
      })
      expect(next.messages).toHaveLength(1)
      expect(next.messages[0]?.role).toBe('user')
      expect(next.messages[0]?.content).toBe('我想澄清 webhook 处理顺序')
      expect(next.messages[0]?.tool_calls).toEqual([])
      // 父 snapshot 保持不变(snapshot 是创建时拍的,后续追加不动)
      expect(next.parent_transcript_snapshot).toEqual(
        initial.parent_transcript_snapshot,
      )
    })

    it('appends assistant message with tool_calls always forced to empty', () => {
      svc.createInitial(REQ_ID, CARD_ID)
      const next = svc.appendMessage(REQ_ID, CARD_ID, {
        role: 'assistant',
        content: 'AI 描述性回复',
      })
      expect(next.messages[0]?.role).toBe('assistant')
      expect(next.messages[0]?.tool_calls).toEqual([])
    })

    it('auto-creates initial transcript when none exists (lazy init)', () => {
      // 不显式 createInitial —— appendMessage 应自动派生 snapshot + 创建
      const next = svc.appendMessage(REQ_ID, CARD_ID, {
        role: 'user',
        content: '第一条消息',
      })
      expect(next.messages).toHaveLength(1)
      expect(next.parent_transcript_snapshot.messages_count).toBe(0)
      // 持久化到磁盘 → 可读出
      const r = svc.read(REQ_ID, CARD_ID)
      expect(r).toEqual(next)
    })

    it('multiple appends accumulate messages in order', () => {
      svc.createInitial(REQ_ID, CARD_ID)
      svc.appendMessage(REQ_ID, CARD_ID, { role: 'user', content: 'msg1' })
      svc.appendMessage(REQ_ID, CARD_ID, { role: 'assistant', content: 'msg2' })
      svc.appendMessage(REQ_ID, CARD_ID, { role: 'user', content: 'msg3' })
      const r = svc.read(REQ_ID, CARD_ID)
      expect(r?.messages.map((m) => m.content)).toEqual(['msg1', 'msg2', 'msg3'])
      expect(r?.messages.every((m) => m.tool_calls.length === 0)).toBe(true)
    })

    it('appended message carries refs through', () => {
      svc.createInitial(REQ_ID, CARD_ID)
      const next = svc.appendMessage(REQ_ID, CARD_ID, {
        role: 'user',
        content: '看 Run #17 产物',
        refs: [{ kind: 'run_id', run_id: 'run-abc123' }],
      })
      expect(next.messages[0]?.refs).toEqual([
        { kind: 'run_id', run_id: 'run-abc123' },
      ])
    })
  })

  // -------------------------------------------------------------------------
  // write 拒绝非法输入
  // -------------------------------------------------------------------------

  it('write() rejects transcript that fails schema validation', () => {
    // schema_version 故意非法
    const bad = {
      ...makeTranscript(),
      schema_version: 99 as unknown as 1,
    }
    const w = svc.write(REQ_ID, CARD_ID, bad)
    expect(w.ok).toBe(false)
    if (w.ok) return
    expect(w.code).toBe('invalid_transcript')
    // 磁盘上不应有任何文件
    expect(svc.read(REQ_ID, CARD_ID)).toBeNull()
  })
})