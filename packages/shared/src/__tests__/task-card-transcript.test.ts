/**
 * TaskCard transcript 共享契约测试 — issue 04 / ADR-0028
 *
 * 覆盖验收项:
 * - 正例:完整 transcript 通过校验
 * - 反例:缺必填 / 错 schema_version / 错 task_card_id ULID / 错 line_range
 *   顺序 / 错 snapshot_hash 格式 → 报错且字段级
 * - prd_section.line_range:schema 层 enforce `end >= start`
 */

import { describe, expect, it } from 'vitest'
import {
  TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
  TaskCardTranscriptSchema,
  TranscriptMessageSchema,
  TranscriptRefSchema,
} from '../task-card-transcript.js'

const VALID_HASH =
  'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const validTranscript = {
  schema_version: TASK_CARD_TRANSCRIPT_SCHEMA_VERSION,
  task_card_id: '01J7X3K2P5EVR0Z3YQJD8HFKXA',
  parent_transcript_snapshot: {
    snapshot_at: '2026-08-06T08:00:00.000Z',
    messages_count: 0,
    snapshot_hash: VALID_HASH,
  },
  messages: [],
} as const

function patch(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...validTranscript, ...overrides }
}

describe('TaskCardTranscriptSchema — issue 04', () => {
  it('accepts a complete transcript', () => {
    const r = TaskCardTranscriptSchema.safeParse(validTranscript)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual(validTranscript)
  })

  it('accepts a transcript with messages and refs', () => {
    const r = TaskCardTranscriptSchema.safeParse(
      patch({
        messages: [
          {
            ts: '2026-08-06T09:00:00.000Z',
            role: 'user',
            content: '看 Run #17 产物',
            refs: [{ kind: 'run_id', run_id: 'run-abc' }],
            tool_calls: [],
          },
          {
            ts: '2026-08-06T09:00:30.000Z',
            role: 'assistant',
            content: '已读',
            refs: [
              {
                kind: 'prd_section',
                path: 'requirement.md',
                line_range: [12, 18],
              },
            ],
            tool_calls: [],
          },
        ],
      }),
    )
    expect(r.success).toBe(true)
  })

  it('rejects wrong schema_version with a literal-level message', () => {
    const r = TaskCardTranscriptSchema.safeParse(patch({ schema_version: 99 }))
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.some((i) => i.path.includes('schema_version'))).toBe(true)
  })

  it('rejects non-ULID task_card_id', () => {
    const r = TaskCardTranscriptSchema.safeParse(patch({ task_card_id: 'not-a-ulid' }))
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.some((i) => i.path.includes('task_card_id'))).toBe(true)
  })

  it('rejects malformed snapshot_hash', () => {
    const r = TaskCardTranscriptSchema.safeParse(
      patch({
        parent_transcript_snapshot: {
          snapshot_at: '2026-08-06T08:00:00.000Z',
          messages_count: 0,
          snapshot_hash: 'md5:notavalidhash',
        },
      }),
    )
    expect(r.success).toBe(false)
    if (r.success) return
    expect(
      r.error.issues.some((i) => i.path.includes('snapshot_hash')),
    ).toBe(true)
  })

  // -------------------------------------------------------------------------
  // prd_section.line_range schema-level 守门(refine)
  // -------------------------------------------------------------------------

  it('rejects line_range with end < start at the schema layer', () => {
    const r = TranscriptRefSchema.safeParse({
      kind: 'prd_section',
      path: 'requirement.md',
      line_range: [10, 5],
    })
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.issues.some((i) => i.message.includes('end must be >= start'))).toBe(
      true,
    )
  })

  it('accepts line_range with end == start (single-line section)', () => {
    const r = TranscriptRefSchema.safeParse({
      kind: 'prd_section',
      path: 'requirement.md',
      line_range: [10, 10],
    })
    expect(r.success).toBe(true)
  })

  // -------------------------------------------------------------------------
  // message 守门
  // -------------------------------------------------------------------------

  it('forces tool_calls default to [] when omitted on a message', () => {
    const r = TranscriptMessageSchema.safeParse({
      ts: '2026-08-06T09:00:00.000Z',
      role: 'user',
      content: '消息',
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.tool_calls).toEqual([])
    expect(r.data.refs).toEqual([])
  })

  it('rejects unknown role', () => {
    const r = TranscriptMessageSchema.safeParse({
      ts: '2026-08-06T09:00:00.000Z',
      role: 'tool',
      content: '...',
    });
    expect(r.success).toBe(false)
  })
})