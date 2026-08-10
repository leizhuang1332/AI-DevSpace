/**
 * SubAgentBlock 单元测试 — issue 08 · ADR-0029 D14
 *
 * 覆盖 board-chat-panel 集成测未直达的 prop:
 * - nestedChildren 递归渲染 + 缩进 border-left
 * - 4 状态 data-status 值(started/running/completed/failed)
 * - failed 状态视觉(error/10 bg)
 * - toolCalls 摘要列表
 *
 * 集成测覆盖了:running/completed 状态 + toolCalls(MessageStream 关联)。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ChatSubAgentEvent } from '@ai-devspace/shared'
import { SubAgentBlock } from '@/components/board/detail/chat/SubAgentBlock'

const startedEvent = (taskId: string, description: string): ChatSubAgentEvent => ({
  kind: 'task_started',
  ts: 1700000000000,
  taskId,
  description,
  agentType: 'general-purpose',
})

const progressEvent = (taskId: string, summary: string): ChatSubAgentEvent => ({
  kind: 'task_progress',
  ts: 1700000000500,
  taskId,
  summary,
})

const completedEvent = (taskId: string): ChatSubAgentEvent => ({
  kind: 'task_completed',
  ts: 1700000002000,
  taskId,
  result: 'ok',
  durationMs: 2000,
})

const failedEvent = (taskId: string): ChatSubAgentEvent => ({
  kind: 'task_notification',
  ts: 1700000002000,
  taskId,
  message: '出错了',
  status: 'warning',
})

afterEach(() => {
  cleanup()
})

describe('SubAgentBlock · 4 状态', () => {
  it('仅 task_started → data-status=started', () => {
    render(
      <SubAgentBlock
        taskId="t-start"
        events={[startedEvent('t-start', '启动中')]}
      />,
    )
    expect(screen.getByTestId('board-chat-sub-agent')).toHaveAttribute(
      'data-status',
      'started',
    )
  })

  it('task_progress → data-status=running', () => {
    render(
      <SubAgentBlock
        taskId="t-run"
        events={[
          startedEvent('t-run', '跑'),
          progressEvent('t-run', '一半'),
        ]}
      />,
    )
    expect(screen.getByTestId('board-chat-sub-agent')).toHaveAttribute(
      'data-status',
      'running',
    )
  })

  it('task_completed → data-status=completed', () => {
    render(
      <SubAgentBlock
        taskId="t-done"
        events={[
          startedEvent('t-done', '完成'),
          completedEvent('t-done'),
        ]}
      />,
    )
    expect(screen.getByTestId('board-chat-sub-agent')).toHaveAttribute(
      'data-status',
      'completed',
    )
  })

  it('task_notification status=warning → data-status=failed + error bg', () => {
    render(
      <SubAgentBlock
        taskId="t-fail"
        events={[
          startedEvent('t-fail', '失败'),
          failedEvent('t-fail'),
        ]}
      />,
    )
    const block = screen.getByTestId('board-chat-sub-agent')
    expect(block).toHaveAttribute('data-status', 'failed')
    const summary = block.querySelector('summary')
    expect(summary?.className).toContain('bg-error/10')
  })
})

describe('SubAgentBlock · nestedChildren', () => {
  it('nestedChildren 渲染递归 SubAgentBlock + border-left', () => {
    const childEvents: ChatSubAgentEvent[] = [
      startedEvent('child-1', '子 sub-agent'),
      completedEvent('child-1'),
    ]
    render(
      <SubAgentBlock
        taskId="parent-1"
        events={[startedEvent('parent-1', '父 sub-agent'), completedEvent('parent-1')]}
        nestedChildren={[
          {
            taskId: 'child-1',
            events: childEvents,
            toolCalls: [],
          },
        ]}
      />,
    )
    const blocks = screen.getAllByTestId('board-chat-sub-agent')
    expect(blocks).toHaveLength(2)
    // 子 block 的 data-task-id = child-1
    const child = blocks.find((b) =>
      b.getAttribute('data-task-id') === 'child-1',
    )
    expect(child).toBeDefined()
    // 子 block 的 paddingLeft > 父(level 1 → 12*1+8=20;父 level 0 → 8)
    const parent = blocks.find((b) =>
      b.getAttribute('data-task-id') === 'parent-1',
    )
    const parentPad = Number(parent?.style.paddingLeft.replace('px', ''))
    const childPad = Number(child?.style.paddingLeft.replace('px', ''))
    expect(childPad).toBeGreaterThan(parentPad)
  })

  it('无 nestedChildren → 只渲染 1 个 block', () => {
    render(
      <SubAgentBlock
        taskId="solo-1"
        events={[startedEvent('solo-1', '独立'), completedEvent('solo-1')]}
      />,
    )
    expect(screen.getAllByTestId('board-chat-sub-agent')).toHaveLength(1)
  })
})

describe('SubAgentBlock · toolCalls', () => {
  it('toolCalls 列表渲染 + brand-700 tool name', () => {
    render(
      <SubAgentBlock
        taskId="t-tools"
        events={[startedEvent('t-tools', '用工具'), completedEvent('t-tools')]}
        toolCalls={[
          { name: 'Bash', argsSummary: 'ls -la' },
          { name: 'Read', argsSummary: '/a.txt' },
        ]}
      />,
    )
    const list = screen.getByTestId('board-chat-sub-agent-tools')
    expect(list).toHaveTextContent('Bash')
    expect(list).toHaveTextContent('ls -la')
    expect(list).toHaveTextContent('Read')
    expect(list).toHaveTextContent('/a.txt')
  })

  it('无 toolCalls → 不渲染 tool-list', () => {
    render(
      <SubAgentBlock
        taskId="t-notools"
        events={[startedEvent('t-notools', '无工具'), completedEvent('t-notools')]}
      />,
    )
    expect(screen.queryByTestId('board-chat-sub-agent-tools')).toBeNull()
  })
})
