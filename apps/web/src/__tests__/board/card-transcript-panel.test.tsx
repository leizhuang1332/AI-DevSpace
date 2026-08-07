/**
 * CardTranscriptPanel + Input 组件测试 — issue 08 / ADR-0028 D5
 *
 * 验收:
 * - head 渲染(标题 + 物理独立 badge + ✕)
 * - 消息流渲染(user / assistant + refs)
 * - 空态
 * - ✕ 收起 → onClose
 * - 输入框 textarea + 发送按钮 + ⌘+↵ 发送
 * - 空内容 → 发送 disabled
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { CardTranscriptPanel } from '@/components/board/detail/CardTranscriptPanel'
import type { TaskCard, TaskCardTranscript } from '@ai-devspace/shared'

const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKX9'

function makeCard(overrides: Partial<TaskCard> = {}): TaskCard {
  return {
    id: CARD_ID,
    parent_id: 'req-1',
    status: 'in_progress',
    title: '主卡',
    content: '',
    priority: null,
    assignee: null,
    labels: [],
    depends_on: [],
    order_index: null,
    source: 'manual',
    is_archived: false,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    completed_at: null,
    ...overrides,
  }
}

function makeTranscript(
  overrides: Partial<TaskCardTranscript> = {},
): TaskCardTranscript {
  return {
    schema_version: 1,
    task_card_id: CARD_ID,
    parent_transcript_snapshot: {
      snapshot_at: '2026-08-07T00:00:00Z',
      messages_count: 0,
      snapshot_hash: 'sha256:' + '0'.repeat(64),
    },
    messages: [],
    ...overrides,
  }
}

afterEach(() => cleanup())

describe('CardTranscriptPanel · 渲染', () => {
  it('head 渲染 标题 + 物理独立 badge + ✕', () => {
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-transcript-head')).toHaveTextContent(
      'AI 协作',
    )
    expect(screen.getByTestId('board-detail-transcript-badge')).toHaveTextContent(
      '物理独立 · 仅描述',
    )
    expect(screen.getByTestId('board-detail-transcript-close')).toBeInTheDocument()
  })

  it('空 transcript → 空态文案', () => {
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-transcript-msgs')).toHaveTextContent(
      '还没有对话',
    )
  })

  it('消息流渲染 user / assistant + refs', () => {
    const transcript = makeTranscript({
      messages: [
        {
          ts: '2026-08-07T10:00:00Z',
          role: 'user',
          content: '用户问的',
          refs: [{ kind: 'run_id', run_id: 'run-17' }],
          tool_calls: [],
        },
        {
          ts: '2026-08-07T10:01:00Z',
          role: 'assistant',
          content: 'AI 答的',
          refs: [],
          tool_calls: [],
        },
      ],
    })
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={transcript}
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const msgs = screen.getAllByTestId('board-detail-transcript-msg')
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toHaveAttribute('data-role', 'user')
    expect(msgs[0]).toHaveTextContent('用户问的')
    expect(msgs[1]).toHaveAttribute('data-role', 'assistant')
    expect(msgs[1]).toHaveTextContent('AI 答的')
    // ref 渲染
    expect(screen.getByTestId('board-detail-transcript-ref')).toHaveTextContent(
      '📎 Run #17',
    )
  })

  it('✕ → onClose', () => {
    const onClose = vi.fn()
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByTestId('board-detail-transcript-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CardTranscriptPanel · 输入框', () => {
  it('textarea + 发送按钮渲染', () => {
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-transcript-input')).toBeInTheDocument()
    expect(screen.getByTestId('board-detail-transcript-send')).toBeInTheDocument()
  })

  it('空内容 → 发送 disabled', () => {
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('board-detail-transcript-send')).toBeDisabled()
  })

  it('输入内容 + 点击发送 → onSend(content) + 清空', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={onSend}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByTestId('board-detail-transcript-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '新消息' } })
    fireEvent.click(screen.getByTestId('board-detail-transcript-send'))
    expect(onSend).toHaveBeenCalledWith('新消息')
  })

  it('⌘+Enter → 发送', () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={onSend}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByTestId('board-detail-transcript-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '快捷键消息' } })
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledWith('快捷键消息')
  })

  it('普通 Enter 不发送', () => {
    const onSend = vi.fn()
    render(
      <CardTranscriptPanel
        card={makeCard()}
        transcript={null}
        onSend={onSend}
        onClose={vi.fn()}
      />,
    )
    const input = screen.getByTestId('board-detail-transcript-input') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: '普通回车' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })
})
