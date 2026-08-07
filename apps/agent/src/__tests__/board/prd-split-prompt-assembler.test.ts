/**
 * PrdSplitPromptAssembler 单测 — issue 05 / ADR-0027 D4
 *
 * 覆盖:
 * - systemPrompt 含 PRD 文本 + granularity + expected_count + 父 transcript tail
 * - 空父 transcript 不崩(渲染"无父对话上下文"占位)
 * - use_context 透传
 * - userPrompt 含粒度 + 数量 + 收尾约定
 * - systemPrompt 完全替换语义(含 L1 "默认 system prompt 已被平台完全替换")
 */

import { describe, expect, it } from 'vitest'
import {
  assemblePrdSplitSystemPrompt,
  buildPrdSplitUserPrompt,
} from '../../prd-split/PrdSplitPromptAssembler.js'
import type { TranscriptMessage } from '@ai-devspace/shared'

const PRD = `# 退款需求\n\n实现退款接口,支持原路退回。\n`

function mkMsg(role: 'user' | 'assistant', content: string): TranscriptMessage {
  return {
    ts: '2026-08-07T08:00:00.000Z',
    role,
    content,
    refs: [],
    tool_calls: [],
  }
}

describe('assemblePrdSplitSystemPrompt — issue 05', () => {
  it('embeds PRD text + granularity + expected_count', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '粗',
      expected_count: 5,
      use_context: ['prd'],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('# 退款需求')
    expect(sys).toContain('**req-001**')
    expect(sys).toContain('粗')
    expect(sys).toContain('约 **5** 张')
    expect(sys).toContain('`prd`')
  })

  it('renders "无父对话上下文" when no parent transcript', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '中',
      expected_count: 3,
      use_context: [],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('无父对话上下文')
  })

  it('embeds parent transcript tail messages', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '细',
      expected_count: 8,
      use_context: [],
      parent_transcript_messages: [
        mkMsg('user', '先做退款'),
        mkMsg('assistant', '好的,建议拆三块'),
      ],
    })
    expect(sys).toContain('先做退款')
    expect(sys).toContain('好的,建议拆三块')
    expect(sys).toContain('[2026-08-07T08:00:00.000Z] user:')
    expect(sys).toContain('[2026-08-07T08:00:00.000Z] assistant:')
  })

  it('declares full system-prompt replacement (Claude Code default overridden)', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '粗',
      expected_count: 5,
      use_context: [],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('默认 system prompt 已被平台完全替换')
  })

  it('lists propose_card in capability boundary + forbids Bash/Write', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '粗',
      expected_count: 5,
      use_context: [],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('`propose_card`')
    expect(sys).toContain('`Bash`')
    expect(sys).toContain('`Write`')
  })

  it('pins suggested_status=backlog in protocol (model must not pass it)', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '粗',
      expected_count: 5,
      use_context: [],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('backlog')
    expect(sys).toContain('不要传 `suggested_status`')
  })

  it('use_context array items are interpolated', () => {
    const sys = assemblePrdSplitSystemPrompt({
      requirement_id: 'req-001',
      prd_markdown: PRD,
      granularity: '粗',
      expected_count: 5,
      use_context: ['prd', 'repos'],
      parent_transcript_messages: [],
    })
    expect(sys).toContain('`prd`')
    expect(sys).toContain('`repos`')
  })
})

describe('buildPrdSplitUserPrompt — issue 05', () => {
  it('contains granularity + expected_count + end-turn instruction', () => {
    const user = buildPrdSplitUserPrompt({ granularity: '粗', expected_count: 5 })
    expect(user).toContain('粗')
    expect(user).toContain('5')
    expect(user).toContain('`propose_card`')
    expect(user).toContain('正常结束本轮 turn')
    expect(user).toContain('不要')
  })
})
