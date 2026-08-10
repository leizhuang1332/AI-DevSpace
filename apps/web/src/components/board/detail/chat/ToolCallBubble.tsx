'use client'

/**
 * ToolCallBubble — 单条工具调用 + 结果渲染(ADR-0029 D10 · issue 08)
 *
 * 形态(对照 docs/design/pages/board-chat-subagent.html):
 * - 进行中(partial=true / 无 tool_result):🌀 + toolName + args 摘要 + duration(若有)
 * - 完成:✓ + toolName + args 摘要 + duration + result 折叠(`<details>`)
 * - error:✗ + error message(result 折叠默认展开便于看到错误)
 *
 * durationMs:由 MessageStream 按 result.ts - call.ts 派生传入。
 * result 折叠:issue 明确 "result 折叠";默认 closed,error 默认 open。
 */

import type { ReactNode } from 'react'

export interface ToolCallBubbleProps {
  id: string
  name: string
  args: Record<string, unknown>
  result?: { content: unknown; isError: boolean } | null
  partial?: boolean
  /** 工具执行耗时(毫秒;由 MessageStream 从 result.ts - call.ts 派生) */
  durationMs?: number
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  if (m < 60) return `${m}m${rs}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h${rm}m`
}

export function ToolCallBubble({
  id,
  name,
  args,
  result = null,
  partial = false,
  durationMs,
}: ToolCallBubbleProps): ReactNode {
  const isPending = partial || !result
  const argsSummary = summarizeArgs(args)
  const isError = result?.isError === true
  return (
    <div
      data-testid="board-chat-tool-bubble"
      data-tool-id={id}
      data-tool-name={name}
      className="my-1 border border-border rounded-md bg-bg-subtle text-xs"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border">
        <span className="font-mono text-[10px]">
          {isPending ? '🌀' : isError ? '✗' : '✓'}
        </span>
        <span className="font-semibold text-text-1">{name}</span>
        <span className="ml-auto font-mono text-[10px] text-text-3 truncate max-w-[50%]">
          {argsSummary}
        </span>
        {durationMs !== undefined && durationMs > 0 && (
          <span
            data-testid="board-chat-tool-duration"
            className="font-mono text-[10px] text-text-3 shrink-0"
          >
            {formatDuration(durationMs)}
          </span>
        )}
      </div>
      {!isPending && result && (
        <details open={isError || undefined} className="px-2 py-1">
          <summary className="cursor-pointer text-[10px] text-text-3 select-none">
            {isError ? 'error' : 'result'}
          </summary>
          <pre
            data-testid="board-chat-tool-result"
            className={`mt-1 text-[11px] whitespace-pre-wrap break-words ${
              isError ? 'text-error' : 'text-text-2'
            }`}
          >
            {typeof result.content === 'string'
              ? result.content
              : JSON.stringify(result.content, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function summarizeArgs(args: Record<string, unknown>): string {
  if (args && typeof args === 'object') {
    if (typeof args.file_path === 'string') return args.file_path
    if (typeof args.path === 'string') return args.path
    if (typeof args.cmd === 'string') return args.cmd
    if (typeof args.command === 'string') return args.command
    if (typeof args.pattern === 'string') return args.pattern
    if (typeof args.url === 'string') return args.url
  }
  return JSON.stringify(args).slice(0, 60)
}
