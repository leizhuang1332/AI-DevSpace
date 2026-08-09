'use client'

/**
 * SubAgentBlock — sub-agent 4 状态视觉(ADR-0029 决策 45)
 *
 * 状态:
 * - started:启动中(spinner + description)
 * - progress:进度中(spinner + latest summary)
 * - completed:完成(✓ + result 摘要)
 * - failed:失败(✗ + duration)
 *
 * 嵌套缩进由父组件决定(level prop)。
 */

import { useMemo, type ReactNode } from 'react'
import type { ChatSubAgentEvent } from '@ai-devspace/shared'

type Status = 'started' | 'progress' | 'completed' | 'failed'

export interface SubAgentBlockProps {
  taskId: string
  events: ChatSubAgentEvent[]
  level?: number
}

export function SubAgentBlock({
  taskId,
  events,
  level = 0,
}: SubAgentBlockProps): ReactNode {
  const status = useMemo<Status>(() => {
    let s: Status = 'started'
    for (const ev of events) {
      if (ev.kind === 'task_started') s = 'started'
      else if (ev.kind === 'task_progress') s = 'progress'
      else if (ev.kind === 'task_completed') s = 'completed'
      else if (ev.kind === 'task_notification' && ev.status === 'warning')
        s = 'failed'
    }
    return s
  }, [events])

  const latest = events[events.length - 1]
  const taskStartedEvent = events.find(
    (e): e is Extract<ChatSubAgentEvent, { kind: 'task_started' }> =>
      e.kind === 'task_started' && e.taskId === taskId,
  )
  const description = taskStartedEvent?.description ?? ''
  const progressSummary = events
    .filter(
      (e): e is Extract<ChatSubAgentEvent, { kind: 'task_progress' }> =>
        e.kind === 'task_progress' && e.taskId === taskId,
    )
    .map((e) => e.summary)
    .join(' · ')
  const completed = events.find(
    (e): e is Extract<ChatSubAgentEvent, { kind: 'task_completed' }> =>
      e.kind === 'task_completed' && e.taskId === taskId,
  )

  const indent = { paddingLeft: `${level * 12 + 8}px` }

  return (
    <details
      data-testid="board-chat-sub-agent"
      data-task-id={taskId}
      data-status={status}
      open={status !== 'completed'}
      style={indent}
      className="my-1 border border-border rounded-md bg-bg-subtle text-xs"
    >
      <summary className="cursor-pointer px-2 py-1 flex items-center gap-1.5 select-none">
        <span className="font-mono text-[10px] text-text-3">
          {status === 'started' || status === 'progress' ? '🌀' : status === 'completed' ? '✅' : '⚠️'}
        </span>
        <span className="text-text-2 font-medium truncate">{description}</span>
        {status === 'progress' && (
          <span className="ml-auto text-text-3 text-[10px]">progress…</span>
        )}
        {status === 'completed' && completed && (
          <span className="ml-auto text-text-3 text-[10px] font-mono">
            {completed.durationMs}ms
          </span>
        )}
      </summary>
      <div className="px-2 py-1 border-t border-border text-[11px] text-text-2 space-y-0.5">
        {progressSummary && (
          <div data-testid="board-chat-sub-agent-summary">
            {progressSummary}
          </div>
        )}
        {completed && (
          <div className="font-mono text-[10px] text-text-3">
            result: {String(JSON.stringify(completed.result)).slice(0, 80)}
          </div>
        )}
        {latest && 'message' in latest && latest.kind === 'task_notification' && (
          <div className="text-text-3">{latest.message}</div>
        )}
      </div>
    </details>
  )
}