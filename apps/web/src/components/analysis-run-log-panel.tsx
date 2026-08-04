'use client'

/**
 * Analysis Run Log Panel(issue 06 · ADR-0021 决策 37-39)
 *
 * 渲染当前 Analysis Run 的持久化日志(SDK 文本 + 工具输入输出),
 * 折叠 / 展开由本地 UI 状态控制;用户的手动展开 / 折叠仅影响 UI,不改 Run 数据。
 *
 * 默认展开策略(决策 39):
 * - running Run → 默认展开,让用户实时观察
 * - 终态(succeeded / failed)Run → 默认折叠,优先展示 Issue 与 Response
 *
 * 安全(决策 71-73):
 * - 接收的 entry 已经过服务端脱敏(issue 06 决策 38);UI 不再补救
 * - system prompt / thinking / 内部消息 不会进入本组件(由
 *   AnalysisAgentRunner 拦截层保证;issue 06 验收 4 + 决策 37)
 *
 * 不做的事:
 * - 不修改 entry 内容(决策 36 · 原始 Run Log 与 UI 解耦)
 * - 不持久化折叠状态(决策 39:UI 状态不写入 Run 数据)
 * - 不在用户点开面板时再调 fetch(决策 39:用户手动展开属于 UI 状态;
 *   entry 已由父组件订阅 SSE 累积好,本组件仅消费 prop)
 */

import { useMemo } from 'react'
import type { AnalysisLogEntry, AnalysisRunStatus } from '@ai-devspace/shared'

export interface AnalysisRunLogPanelProps {
  /** 当前 Run Log entry(由父组件订阅 SSE 累积) */
  entries: ReadonlyArray<AnalysisLogEntry>
  /** 当前 Run 状态:决定默认展开 / 折叠 */
  runStatus: AnalysisRunStatus
  /**
   * 用户手动展开 / 折叠状态。null = 走默认(运行中展开,终态折叠);
   * true / false = 用户显式选择(覆盖默认)。
   */
  userToggle: boolean | null
  onToggle: (next: boolean) => void
}

// ---------------------------------------------------------------------------
// 单条 entry 渲染
// ---------------------------------------------------------------------------

function LogEntryLine({ entry }: { entry: AnalysisLogEntry }) {
  // 决策 71-73:服务端已脱敏;UI 不再做正则补救(避免双重脱敏引起歧义)
  if (entry.kind === 'text') {
    return (
      <div
        data-testid="analysis-run-log-entry"
        data-kind="text"
        className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap break-words"
      >
        <span className="font-mono text-[10px] text-text-3 mr-2 align-middle select-none">
          {formatTs(entry.ts)}
        </span>
        <span aria-hidden className="text-text-3 mr-1">💬</span>
        <span>{entry.text}</span>
      </div>
    )
  }
  if (entry.kind === 'tool_use') {
    return (
      <div
        data-testid="analysis-run-log-entry"
        data-kind="tool_use"
        data-name={entry.name}
        data-tool-use-id={entry.tool_use_id}
        className="text-sm leading-relaxed"
      >
        <div className="flex items-baseline gap-2 text-text-2">
          <span className="font-mono text-[10px] text-text-3 select-none">
            {formatTs(entry.ts)}
          </span>
          <span aria-hidden className="text-text-3">🔧</span>
          <span className="font-mono text-xs text-brand-700">{entry.name}</span>
          <span className="text-text-3 text-[10px]">tool_use_id={entry.tool_use_id}</span>
        </div>
        <pre
          data-testid="analysis-run-log-entry-input"
          className="mt-1 ml-6 text-[11px] font-mono bg-bg-subtle border border-border rounded px-2 py-1 overflow-auto max-h-40 whitespace-pre-wrap break-words"
        >
          {formatJson(entry.input)}
        </pre>
      </div>
    )
  }
  // tool_result
  return (
    <div
      data-testid="analysis-run-log-entry"
      data-kind="tool_result"
      data-name={entry.name}
      data-tool-use-id={entry.tool_use_id}
      className="text-sm leading-relaxed"
    >
      <div className="flex items-baseline gap-2 text-text-2">
        <span className="font-mono text-[10px] text-text-3 select-none">
          {formatTs(entry.ts)}
        </span>
        <span aria-hidden className="text-text-3">📤</span>
        <span className="font-mono text-xs text-brand-700">{entry.name}</span>
        <span className="text-text-3 text-[10px]">tool_use_id={entry.tool_use_id}</span>
      </div>
      <pre
        data-testid="analysis-run-log-entry-output"
        className="mt-1 ml-6 text-[11px] font-mono bg-bg-subtle border border-border rounded px-2 py-1 overflow-auto max-h-40 whitespace-pre-wrap break-words"
      >
        {formatJson(entry.output)}
      </pre>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 时间格式:HH:MM:SS(只显示时分秒,日期由父组件顶栏 + Run meta 提供)
// ---------------------------------------------------------------------------

function formatTs(iso: string): string {
  // 容错:无效 ISO → 原样显示
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

/**
 * 默认是否展开(决策 39):running → true;succeeded / failed → false
 * - 用户手动 toggle 一旦设置,后续维持用户选择(不再被状态变化覆盖)
 */
function defaultExpanded(status: AnalysisRunStatus): boolean {
  return status === 'running'
}

export function AnalysisRunLogPanel({
  entries,
  runStatus,
  userToggle,
  onToggle,
}: AnalysisRunLogPanelProps) {
  // 计算实际展开状态:用户 toggle 优先;否则按 Run 状态默认
  const expanded = userToggle ?? defaultExpanded(runStatus)

  // entry 计数(三种 kind 各显示)
  const counts = useMemo(() => {
    let text = 0
    let toolUse = 0
    let toolResult = 0
    for (const e of entries) {
      if (e.kind === 'text') text += 1
      else if (e.kind === 'tool_use') toolUse += 1
      else if (e.kind === 'tool_result') toolResult += 1
    }
    return { text, toolUse, toolResult, total: entries.length }
  }, [entries])

  return (
    <section
      data-testid="analysis-run-log-panel"
      data-expanded={expanded ? 'true' : 'false'}
      data-run-status={runStatus}
      data-entry-count={counts.total}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden flex flex-col"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between flex-shrink-0">
        <button
          type="button"
          data-testid="analysis-run-log-toggle"
          aria-expanded={expanded}
          aria-controls="analysis-run-log-body"
          onClick={() => onToggle(!expanded)}
          className="flex items-center gap-2 text-md font-semibold flex-1 text-left hover:text-brand-700 transition-colors"
        >
          <span aria-hidden className="text-text-3">
            {expanded ? '▼' : '▶'}
          </span>
          <span aria-hidden>📜</span>
          <span>Log</span>
          <span
            data-testid="analysis-run-log-counts"
            className="font-mono text-xs text-text-3 ml-1"
          >
            ({counts.text} 文本 · {counts.toolUse} 工具 · {counts.toolResult} 结果)
          </span>
        </button>
        {/* 状态标识:让用户明白为何当前默认展开/折叠 */}
        <span
          data-testid="analysis-run-log-status-hint"
          className="text-[11px] text-text-3 font-mono"
        >
          {runStatus === 'running' ? '运行中 · 默认展开' : '已终态 · 默认折叠'}
        </span>
      </header>
      {expanded && (
        <div
          id="analysis-run-log-body"
          data-testid="analysis-run-log-body"
          className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-2 max-h-[400px]"
        >
          {counts.total === 0 ? (
            <div
              data-testid="analysis-run-log-empty"
              className="text-sm text-text-3 text-center py-4"
            >
              暂无 Run Log
            </div>
          ) : (
            entries.map((entry, idx) => (
              <LogEntryLine
                // entry 本身稳定(只追加不修改);idx 仅用于 React key
                key={`${entry.kind}-${entry.ts}-${idx}`}
                entry={entry}
              />
            ))
          )}
        </div>
      )}
    </section>
  )
}
