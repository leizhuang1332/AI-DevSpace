'use client'

/**
 * IssueResponseEditor 组件(issue 04 · ADR-0021)
 *
 * 职责:
 * - 渲染 Markdown textarea + 自动保存 hook(useAnalysisResponse)
 * - 显示"输入中 / 保存中 / 已保存 / 保存失败"状态(issue 04 验收 4)
 * - 失焦 / 历史切换 / 组件卸载 → flush()(验收 6)
 * - 暴露 onFlushFailed / flushPromise 给父组件:开始分析前等待所有编辑器 flush
 *
 * 设计:
 * - 单独组件而不是塞进 IssueCard:让 IssueCard 保持纯展示;
 *   IssueResponseEditor 维护自己的 status + debounce,与 IssueCard 解耦。
 * - 与外层 flush gate 配合:flush() 暴露给父组件;
 *   flush() 返回 Promise<void> —— 成功 = 最新 draft 已持久化;失败 = dirty draft
 *   保存失败,需要阻塞启动分析。
 */

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  useAnalysisResponse,
  type SaveStatus,
} from '@/hooks/use-analysis-response'

export interface IssueResponseEditorProps {
  requirementId: string
  runId: string
  issueId: string
  /** 失焦时 flush(由父组件设 onBlur) */
  onFlushFailed?: (message: string) => void
  /** 暴露 flush 给父组件(用于跨 Run 切换 + 开始分析前的 flush gate) */
  flushRef?: MutableRefObject<(() => Promise<void>) | null>
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: '',
  dirty: '✏️ 输入中',
  saving: '⏳ 保存中',
  saved: '✅ 已保存',
  error: '❌ 保存失败',
}

const STATUS_TESTID: Record<SaveStatus, string> = {
  idle: 'issue-response-status-idle',
  dirty: 'issue-response-status-dirty',
  saving: 'issue-response-status-saving',
  saved: 'issue-response-status-saved',
  error: 'issue-response-status-error',
}

export function IssueResponseEditor({
  requirementId,
  runId,
  issueId,
  onFlushFailed,
  flushRef,
}: IssueResponseEditorProps) {
  const { draft, status, errorMessage, updatedAt, setDraft, flush } =
    useAnalysisResponse(requirementId, runId, issueId)

  // 把 flush 暴露给父组件(ref 形式)
  const invokeFlushRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    invokeFlushRef.current = flush
    if (!flushRef) return
    flushRef.current = flush
    return () => {
      flushRef.current = null
    }
  }, [flush, flushRef])

  // error 时回调父组件(便于父组件把全局状态切到"待重试")
  useEffect(() => {
    if (status === 'error' && errorMessage && onFlushFailed) {
      onFlushFailed(errorMessage)
    }
  }, [status, errorMessage, onFlushFailed])

  // 失焦时 flush
  const onBlur = useCallback(() => {
    void flush()
  }, [flush])

  const statusLabel = useMemo(() => {
    if (status === 'saved' && updatedAt) {
      const ts = new Date(updatedAt)
      const formatted = Number.isNaN(ts.getTime())
        ? updatedAt
        : ts.toLocaleString('zh-CN', { hour12: false })
      return `${STATUS_LABEL.saved} · ${formatted}`
    }
    return STATUS_LABEL[status]
  }, [status, updatedAt])

  return (
    <div
      data-testid="issue-response-editor"
      data-issue-id={issueId}
      data-status={status}
      className="border-t border-border pt-2 mt-1 flex flex-col gap-1.5"
    >
      <label
        htmlFor={`response-${issueId}`}
        className="text-xs font-medium text-text-2 flex items-center gap-1.5"
      >
        <span aria-hidden>📝</span>
        <span>Issue Response(自动保存)</span>
        <span className="font-mono text-[10px] text-text-3 ml-auto">
          v{status === 'idle' || status === 'saved' ? '' : ''}
        </span>
      </label>
      <textarea
        id={`response-${issueId}`}
        data-testid="issue-response-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        placeholder="回答、解释或补充需求上下文(留空表示未答复)"
        rows={3}
        className="w-full text-xs font-mono leading-relaxed border border-border bg-bg-elevated rounded-md p-2 focus:outline-none focus:border-brand"
      />
      <div
        data-testid={STATUS_TESTID[status]}
        data-status={status}
        className={`text-[11px] flex items-center justify-between ${
          status === 'error' ? 'text-error' : 'text-text-3'
        }`}
      >
        <span>{statusLabel}</span>
        {status === 'error' && errorMessage && (
          <span
            data-testid="issue-response-error-message"
            className="text-error truncate ml-2"
            title={errorMessage}
          >
            {errorMessage}
          </span>
        )}
      </div>
    </div>
  )
}