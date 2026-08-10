'use client'

/**
 * SubAgentBlock — sub-agent 4 状态视觉(ADR-0029 D14 / 决策 45 · issue 08)
 *
 * 状态(对照 docs/design/pages/board-chat-subagent.html 方案 A v1 4 状态):
 * - started:启动中(▶ 灰 + description)
 * - running:进度中(⏱️ brand 色 + spin 动画 + brand-50 bg + brand-700 文字)
 * - completed:完成(✅ success 绿 + duration)
 * - failed:失败(⚠️ error 红 + error/10 bg)
 *
 * 嵌套(nestedChildren):sub-sub-agent 递归渲染,level + 1 + border-left brand-100
 * 缩进(决策 d2)。schema 当前无 parentTaskId,数据层由 MessageStream 关联;
 * 本期 MessageStream 暂传空数组,渲染层先就绪。
 *
 * toolCalls:sub-agent 运行期间触发的工具调用摘要列表(设计 HTML .tool-list,
 * border-left + 每行 name + args 摘要,name 用 brand-700)。
 */

import { useMemo, type ReactNode } from 'react'
import type { ChatSubAgentEvent } from '@ai-devspace/shared'

type Status = 'started' | 'running' | 'completed' | 'failed'

/** sub-agent 内嵌的工具调用摘要(由 MessageStream 按 ts 区间关联传入) */
export interface SubAgentToolCall {
  name: string
  argsSummary: string
}

export interface SubAgentBlockProps {
  taskId: string
  events: ChatSubAgentEvent[]
  level?: number
  /** 本 sub-agent 运行期间触发的工具调用摘要列表 */
  toolCalls?: SubAgentToolCall[]
  /** 嵌套 sub-sub-agent(scheme d2;schema 无 parentTaskId,本期数据层暂空) */
  nestedChildren?: SubAgentBlockProps[]
}

const STATUS_ICON: Record<Status, string> = {
  started: '▶',
  running: '⏱️',
  completed: '✅',
  failed: '⚠️',
}

/** summary 行的视觉态(对照设计 HTML lines 85-91) */
function summaryClassFor(status: Status): string {
  if (status === 'running') {
    return 'bg-brand-50 text-brand-700'
  }
  if (status === 'failed') {
    return 'bg-error/10'
  }
  return 'bg-bg-subtle'
}

/** icon 视觉态(running 时 spin) */
function iconClassFor(status: Status): string {
  if (status === 'running') return 'text-brand'
  if (status === 'completed') return 'text-success'
  if (status === 'failed') return 'text-error'
  return 'text-text-3'
}

export function SubAgentBlock({
  taskId,
  events,
  level = 0,
  toolCalls = [],
  nestedChildren = [],
}: SubAgentBlockProps): ReactNode {
  const status = useMemo<Status>(() => {
    let s: Status = 'started'
    for (const ev of events) {
      if (ev.kind === 'task_started') s = 'started'
      else if (ev.kind === 'task_progress') s = 'running'
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
  const summaryClass = summaryClassFor(status)

  return (
    <details
      data-testid="board-chat-sub-agent"
      data-task-id={taskId}
      data-status={status}
      open={status !== 'completed'}
      style={indent}
      className="my-1 border border-border rounded-md bg-bg-elevated text-xs"
    >
      <summary
        className={`cursor-pointer px-2 py-1 flex items-center gap-1.5 select-none ${summaryClass} rounded-t-md`}
      >
        <span
          className={`font-mono text-[11px] inline-block w-4 text-center ${
            status === 'running' ? 'animate-spin' : ''
          } ${iconClassFor(status)}`}
          aria-hidden="true"
        >
          {STATUS_ICON[status]}
        </span>
        <span className="text-text-1 font-medium truncate flex-1">
          {description}
        </span>
        {status === 'running' && (
          <span className="text-text-3 text-[10px] font-mono">running…</span>
        )}
        {status === 'completed' && completed && (
          <span className="text-text-3 text-[10px] font-mono">
            {completed.durationMs}ms
          </span>
        )}
      </summary>
      <div className="px-2 py-1.5 border-t border-border text-[11px] text-text-2 space-y-1">
        {progressSummary && (
          <div
            data-testid="board-chat-sub-agent-summary"
            className="px-2 py-1 bg-bg-subtle rounded-sm italic text-text-2"
          >
            {progressSummary}
          </div>
        )}
        {completed && (
          <div className="font-mono text-[10px] text-text-3 break-all">
            result: {String(JSON.stringify(completed.result)).slice(0, 80)}
          </div>
        )}
        {latest && 'message' in latest && latest.kind === 'task_notification' && (
          <div className="text-text-3">{latest.message}</div>
        )}
        {toolCalls.length > 0 && (
          <div
            data-testid="board-chat-sub-agent-tools"
            className="flex flex-col gap-0.5 pl-3 border-l-2 border-border"
          >
            {toolCalls.map((tc, idx) => (
              <div
                key={`${tc.name}-${idx}`}
                className="font-mono text-[11px] text-text-3"
              >
                <span className="text-brand-700 font-semibold">{tc.name}</span>{' '}
                {tc.argsSummary}
              </div>
            ))}
          </div>
        )}
        {nestedChildren.length > 0 && (
          <div className="ml-4 pl-2 border-l-2 border-brand-100 flex flex-col">
            {nestedChildren.map((child) => (
              <SubAgentBlock
                key={child.taskId}
                taskId={child.taskId}
                events={child.events}
                level={level + 1}
                toolCalls={child.toolCalls}
                nestedChildren={child.nestedChildren}
              />
            ))}
          </div>
        )}
      </div>
    </details>
  )
}
