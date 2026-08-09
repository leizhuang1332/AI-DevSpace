'use client'

/**
 * MessageStream — 渲染 ChatSessionEvent[] 流(ADR-0029 D10)
 *
 * 把 9 类 SSE 事件 + 4 类 sub-agent 事件按时间序排好,渲染为 user / assistant
 * 气泡 + ToolCallBubble + SubAgentBlock(嵌入 assistant)。
 *
 * 打字机 20ms 节奏(决策 32):
 * - assistant text/thinking block `partial: true` 时显示 "…"
 * - 实际流式动画由 server 端逐 token 推;前端按 20ms 节流 setState 防抖动
 *   (本期简化:partial 直接显示原文,不用 useEffect 计时;后续可加 throttling)
 *
 * SubAgent 嵌入(决策 43):task_* 事件嵌入最近一条 assistant message 后,
 * 视觉一致。
 */

import { useMemo, type ReactNode } from 'react'
import type { ChatSessionEvent, ChatSubAgentEvent } from '@ai-devspace/shared'
import { SubAgentBlock } from './SubAgentBlock'
import { ToolCallBubble } from './ToolCallBubble'

export interface MessageStreamProps {
  events: ChatSessionEvent[]
}

export function MessageStream({ events }: MessageStreamProps): ReactNode {
  // 把事件按时间序排好(已由后端保证);本组件只 group:同一 ts 的 tool_call + tool_result 合并
  const items = useMemo(() => buildItems(events), [events])

  if (items.length === 0) {
    return (
      <div
        data-testid="board-chat-message-stream"
        className="flex-1 flex items-center justify-center text-xs text-text-3 text-center px-4 py-6"
      >
        还没有对话。在下方输入框开聊 —— 这是 Claude Code SDK session,带工具调用 + 权限拦截 + sub-agent。
      </div>
    )
  }

  return (
    <div
      data-testid="board-chat-message-stream"
      className="flex flex-col gap-3 flex-1 py-3 overflow-auto"
    >
      {items.map((it, idx) => renderItem(it, idx))}
    </div>
  )
}

interface MessageItem {
  kind: 'user' | 'assistant'
  ts: number
  text: string
  /** thinking block 单独渲染(视觉区分) */
  thinking: string
  /** 工具调用块(嵌入 assistant) */
  toolCalls: Array<{
    id: string
    name: string
    args: Record<string, unknown>
    partial: boolean
    result?: { content: unknown; isError: boolean } | null
  }>
  /** sub-agent 块(task_* 嵌入 assistant) */
  subAgents: Array<{ taskId: string; events: ChatSubAgentEvent[] }>
}

type StreamItem = MessageItem

function buildItems(events: ChatSessionEvent[]): StreamItem[] {
  const items: StreamItem[] = []
  // tool_use_id → 关联的 result
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean }
  >()
  for (const ev of events) {
    if (ev.kind === 'chat_tool_result') {
      toolResults.set(ev.id, { content: ev.content, isError: ev.isError })
    }
  }
  // 确保最后一条 assistant item 存在(若 tool_call/sub-agent 出现在 assistant 之前)
  const ensureTrailingAssistant = (): MessageItem => {
    const last = items[items.length - 1]
    if (last && last.kind === 'assistant') return last
    const stub: MessageItem = {
      kind: 'assistant',
      ts: Date.now(),
      text: '',
      thinking: '',
      toolCalls: [],
      subAgents: [],
    }
    items.push(stub)
    return stub
  }
  for (const ev of events) {
    if (ev.kind === 'chat_message_user') {
      const text = ev.content
        .filter((c) => c.kind === 'text')
        .map((c) => (c.kind === 'text' ? c.text : ''))
        .join('\n')
      items.push({
        kind: 'user',
        ts: ev.ts,
        text,
        thinking: '',
        toolCalls: [],
        subAgents: [],
      })
    } else if (ev.kind === 'chat_message_assistant') {
      let text = ''
      let thinking = ''
      for (const c of ev.content) {
        if (c.kind === 'text') text += c.text
        else if (c.kind === 'thinking') thinking += c.text
      }
      items.push({
        kind: 'assistant',
        ts: ev.ts,
        text,
        thinking,
        toolCalls: [],
        subAgents: [],
      })
    } else if (ev.kind === 'chat_tool_call') {
      const host = ensureTrailingAssistant()
      host.toolCalls.push({
        id: ev.id,
        name: ev.name,
        args: ev.args,
        partial: ev.partial,
        result: toolResults.get(ev.id) ?? null,
      })
    } else if (
      ev.kind === 'task_started' ||
      ev.kind === 'task_progress' ||
      ev.kind === 'task_notification' ||
      ev.kind === 'task_completed'
    ) {
      const host = ensureTrailingAssistant()
      let block = host.subAgents.find((s) => s.taskId === ev.taskId)
      if (!block) {
        block = { taskId: ev.taskId, events: [] }
        host.subAgents.push(block)
      }
      // ev 在此分支已 narrow 为 task_* 子 union(等于 ChatSubAgentEvent)
      block.events.push(ev as Extract<typeof ev, { taskId: string }>)
    }
  }
  return items
}

function renderItem(it: StreamItem, idx: number): ReactNode {
  if (it.kind === 'user') {
    return (
      <div
        key={`u-${idx}-${it.ts}`}
        data-testid="board-chat-msg-user"
        data-ts={it.ts}
        className="p-3 rounded-md text-sm leading-relaxed bg-bg-subtle self-end max-w-[85%]"
      >
        <div className="flex items-center gap-2 mb-1.5 text-xs text-text-3">
          <span className="font-semibold uppercase tracking-wide text-brand-700">用户</span>
          <span className="ml-auto font-mono text-[10px]">
            {formatTime(it.ts)}
          </span>
        </div>
        <div className="text-text-1 whitespace-pre-wrap">{it.text}</div>
      </div>
    )
  }
  return (
    <div
      key={`a-${idx}-${it.ts}`}
      data-testid="board-chat-msg-assistant"
      data-ts={it.ts}
      className="p-3 rounded-md text-sm leading-relaxed bg-brand-50 text-text-2 self-start max-w-[90%]"
    >
      <div className="flex items-center gap-2 mb-1.5 text-xs text-text-3">
        <span className="font-semibold uppercase tracking-wide text-brand-700">AI</span>
        <span className="ml-auto font-mono text-[10px]">{formatTime(it.ts)}</span>
      </div>
      {it.thinking && (
        <div className="text-[11px] italic text-text-3 border-l-2 border-border pl-2 mb-1.5 whitespace-pre-wrap">
          💭 {it.thinking}
        </div>
      )}
      {it.text && (
        <div className="whitespace-pre-wrap text-text-2">{it.text}</div>
      )}
      {it.toolCalls.map((tc) => (
        <ToolCallBubble
          key={tc.id}
          id={tc.id}
          name={tc.name}
          args={tc.args}
          result={tc.result}
          partial={tc.partial}
        />
      ))}
      {it.subAgents.map((sa) => (
        <SubAgentBlock key={sa.taskId} taskId={sa.taskId} events={sa.events} />
      ))}
    </div>
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}