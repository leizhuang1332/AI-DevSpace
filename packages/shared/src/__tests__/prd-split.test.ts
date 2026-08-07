/**
 * PRD 拆解 Run 共享契约测试 — issue 05 / ADR-0027 D4
 *
 * 覆盖:
 * - PrdSplitProposalSchema 正反例(缺 title 抛 / suggested_status 非 backlog 抛 /
 *   suggested_priority null ok / ordinal/tool_use_id 必填)
 * - ProposeCardToolInputSchema(模型入参形态;suggested_priority 可缺省)
 * - PrdSplitRunMetaSchema 状态枚举 + finished_at/error nullable
 * - PrdSplitCardsFileSchema round-trip
 * - 路由 schema:PrdSplitStartBodySchema granularity/expected_count 边界
 */

import { describe, expect, it } from 'vitest'
import {
  PRD_SPLIT_CARDS_SCHEMA_VERSION,
  PRD_SPLIT_GRANULARITY,
  PrdSplitCardsFileSchema,
  PrdSplitGranularitySchema,
  PrdSplitProposalSchema,
  PrdSplitRunMetaSchema,
  PrdSplitStartBodySchema,
  ProposeCardToolInputSchema,
} from '../prd-split.js'

const VALID_PROPOSAL = {
  ordinal: 1,
  tool_use_id: 'mcp-propose_card-1',
  title: '退款接口',
  content: '实现退款',
  suggested_status: 'backlog',
  suggested_priority: 'high',
  labels: ['p0'],
} as const

function patchProposal(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...VALID_PROPOSAL, ...overrides }
}

describe('PrdSplitProposalSchema — issue 05', () => {
  it('accepts a complete proposal', () => {
    const r = PrdSplitProposalSchema.safeParse(VALID_PROPOSAL)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual(VALID_PROPOSAL)
  })

  it('accepts null suggested_priority + default labels', () => {
    const r = PrdSplitProposalSchema.safeParse({
      ordinal: 2,
      tool_use_id: 'mcp-propose_card-2',
      title: 'x',
      content: '',
      suggested_status: 'backlog',
      suggested_priority: null,
      labels: [],
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing title', () => {
    const r = PrdSplitProposalSchema.safeParse(
      patchProposal({ title: undefined }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects empty title', () => {
    const r = PrdSplitProposalSchema.safeParse(patchProposal({ title: '   ' }))
    expect(r.success).toBe(false)
  })

  it('rejects non-backlog suggested_status (spec fixed)', () => {
    const r = PrdSplitProposalSchema.safeParse(
      patchProposal({ suggested_status: 'todo' }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects invalid suggested_priority', () => {
    const r = PrdSplitProposalSchema.safeParse(
      patchProposal({ suggested_priority: 'urgent-but-wrong' }),
    )
    expect(r.success).toBe(false)
  })

  it('rejects ordinal < 1', () => {
    const r = PrdSplitProposalSchema.safeParse(patchProposal({ ordinal: 0 }))
    expect(r.success).toBe(false)
  })

  it('rejects missing tool_use_id', () => {
    const r = PrdSplitProposalSchema.safeParse(
      patchProposal({ tool_use_id: undefined }),
    )
    expect(r.success).toBe(false)
  })
})

describe('ProposeCardToolInputSchema — model tool input', () => {
  it('accepts title + content + suggested_priority', () => {
    const r = ProposeCardToolInputSchema.safeParse({
      title: '退款',
      content: '实现退款',
      suggested_priority: 'high',
      labels: ['p0'],
    })
    expect(r.success).toBe(true)
  })

  it('accepts minimal title only (content/priority/labels default)', () => {
    const r = ProposeCardToolInputSchema.safeParse({ title: '退款' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.content).toBe('')
      expect(r.data.suggested_priority).toBeUndefined()
      expect(r.data.labels).toBeUndefined()
    }
  })

  it('accepts null suggested_priority (explicit none)', () => {
    const r = ProposeCardToolInputSchema.safeParse({
      title: 'x',
      suggested_priority: null,
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing title', () => {
    const r = ProposeCardToolInputSchema.safeParse({ content: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('PrdSplitGranularitySchema', () => {
  it('accepts 粗 / 中 / 细', () => {
    for (const g of Object.values(PRD_SPLIT_GRANULARITY)) {
      expect(PrdSplitGranularitySchema.safeParse(g).success).toBe(true)
    }
  })

  it('rejects non-enum granularity', () => {
    expect(PrdSplitGranularitySchema.safeParse('huge').success).toBe(false)
    expect(PrdSplitGranularitySchema.safeParse('coarse').success).toBe(false)
  })
})

describe('PrdSplitRunMetaSchema', () => {
  const VALID_META = {
    schema_version: PRD_SPLIT_CARDS_SCHEMA_VERSION,
    run_id: 'prd-abc-123456',
    requirement_id: 'req-001',
    status: 'running',
    created_at: '2026-08-07T08:00:00.000Z',
    finished_at: null,
    error: null,
    granularity: '粗',
    expected_count: 5,
    actual_count: 0,
  } as const

  it('accepts a running Run meta', () => {
    const r = PrdSplitRunMetaSchema.safeParse(VALID_META)
    expect(r.success).toBe(true)
  })

  it('accepts succeeded with finished_at + actual_count', () => {
    const r = PrdSplitRunMetaSchema.safeParse({
      ...VALID_META,
      status: 'succeeded',
      finished_at: '2026-08-07T08:01:00.000Z',
      actual_count: 5,
    })
    expect(r.success).toBe(true)
  })

  it('accepts failed with error string', () => {
    const r = PrdSplitRunMetaSchema.safeParse({
      ...VALID_META,
      status: 'failed',
      finished_at: '2026-08-07T08:01:00.000Z',
      error: 'SDK timeout',
      actual_count: 2,
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown status', () => {
    const r = PrdSplitRunMetaSchema.safeParse({
      ...VALID_META,
      status: 'pending',
    })
    expect(r.success).toBe(false)
  })

  it('rejects wrong schema_version', () => {
    const r = PrdSplitRunMetaSchema.safeParse({
      ...VALID_META,
      schema_version: 99,
    })
    expect(r.success).toBe(false)
  })
})

describe('PrdSplitCardsFileSchema', () => {
  const VALID_FILE = {
    schema_version: PRD_SPLIT_CARDS_SCHEMA_VERSION,
    run_id: 'prd-abc-123456',
    requirement_id: 'req-001',
    created_at: '2026-08-07T08:00:00.000Z',
    granularity: '中',
    expected_count: 3,
    candidates: [
      {
        ordinal: 1,
        tool_use_id: 'mcp-propose_card-1',
        title: 'a',
        content: '',
        suggested_status: 'backlog',
        suggested_priority: null,
        labels: [],
      },
      {
        ordinal: 2,
        tool_use_id: 'mcp-propose_card-2',
        title: 'b',
        content: '实现 b',
        suggested_status: 'backlog',
        suggested_priority: 'medium',
        labels: [],
      },
    ],
  } as const

  it('accepts a complete cards file', () => {
    const r = PrdSplitCardsFileSchema.safeParse(VALID_FILE)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.candidates).toHaveLength(2)
  })

  it('accepts empty candidates (Run started, no cards yet)', () => {
    const r = PrdSplitCardsFileSchema.safeParse({ ...VALID_FILE, candidates: [] })
    expect(r.success).toBe(true)
  })

  it('defaults candidates to [] when omitted', () => {
    const { candidates: _omit, ...noCandidates } = VALID_FILE
    const r = PrdSplitCardsFileSchema.safeParse(noCandidates)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.candidates).toEqual([])
  })

  it('rejects invalid candidate in array', () => {
    const r = PrdSplitCardsFileSchema.safeParse({
      ...VALID_FILE,
      candidates: [{ ordinal: 1, tool_use_id: 'x', title: '', suggested_status: 'backlog' }],
    })
    expect(r.success).toBe(false)
  })
})

describe('PrdSplitStartBodySchema', () => {
  it('accepts valid body', () => {
    const r = PrdSplitStartBodySchema.safeParse({
      granularity: '粗',
      expected_count: 5,
      use_context: ['prd'],
    })
    expect(r.success).toBe(true)
  })

  it('defaults use_context to []', () => {
    const r = PrdSplitStartBodySchema.safeParse({
      granularity: '中',
      expected_count: 3,
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.use_context).toEqual([])
  })

  it('rejects expected_count < 1', () => {
    const r = PrdSplitStartBodySchema.safeParse({
      granularity: '粗',
      expected_count: 0,
    })
    expect(r.success).toBe(false)
  })

  it('rejects expected_count > 50', () => {
    const r = PrdSplitStartBodySchema.safeParse({
      granularity: '粗',
      expected_count: 51,
    })
    expect(r.success).toBe(false)
  })

  it('rejects missing granularity', () => {
    const r = PrdSplitStartBodySchema.safeParse({ expected_count: 5 })
    expect(r.success).toBe(false)
  })
})
