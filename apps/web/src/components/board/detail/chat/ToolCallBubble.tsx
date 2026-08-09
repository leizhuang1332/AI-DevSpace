'use client'

/**
 * ToolCallBubble — 单条工具调用 + 结果渲染(ADR-0029 D10)
 *
 * 形态:
 * - 进行中(partial=true / 无 tool_result):spinner + toolName + args 摘要
 * - 完成:✓ + toolName + args 摘要 + result 折叠
 * - error:✗ + error message
 */

import type { ReactNode } from 'react'

export interface ToolCallBubbleProps {
  id: string
  name: string
  args: Record<string, unknown>
  result?: { content: unknown; isError: boolean } | null
  partial?: boolean
}

export function ToolCallBubble({
  id,
  name,
  args,
  result = null,
  partial = false,
}: ToolCallBubbleProps): ReactNode {
  const isPending = partial || !result
  const argsSummary = summarizeArgs(args)
  return (
    <div
      data-testid="board-chat-tool-bubble"
      data-tool-id={id}
      data-tool-name={name}
      className="my-1 border border-border rounded-md bg-bg-subtle text-xs"
    >
      <div className="flex items-center gap-1.5 px-2 py-1 border-b border-border">
        <span className="font-mono text-[10px]">
          {isPending ? '🌀' : result?.isError ? '✗' : '✓'}
        </span>
        <span className="font-semibold text-text-1">{name}</span>
        <span className="ml-auto font-mono text-[10px] text-text-3 truncate max-w-[60%]">
          {argsSummary}
        </span>
      </div>
      {!isPending && result && (
        <pre
          data-testid="board-chat-tool-result"
          className={`px-2 py-1 text-[11px] whitespace-pre-wrap break-words ${
            result.isError ? 'text-error' : 'text-text-2'
          }`}
        >
          {typeof result.content === 'string'
            ? result.content
            : JSON.stringify(result.content, null, 2)}
        </pre>
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