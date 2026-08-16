'use client'

/**
 * DetachCodebaseDialog —— 需求级 codebase detach 二次确认弹窗(ADR-0034)
 *
 * 触发点:DRAFTING 页面 RepoBar 展开态 chip 上的红色 ✕ 按钮
 *        (apps/web/src/components/repo-bar.tsx:425-443)
 *
 * 镜像样板:`AddRepoModal`(同目录)的 useState + useEffect 模式;
 *          `DeleteRepoDialog`(同目录)的样式 + 测试 ID 约定。
 *
 * 设计要点:
 * - **悲观更新**(决策 Q8):点确认后调 `onConfirm()`,Promise resolve 前按钮
 *   显示「删除中…」且 disabled;reject 时错误 banner 展示,按钮恢复
 * - **不乐观移除 chip**:HTTP 失败时由父组件(drafting-zone)保留 chip,
 *   这里只管自己 dialog 的 submitting / error 状态
 * - **错误码翻译**(translateError):继承 AddRepoModal 风格,把 AgentError 的
 *   body.error 翻译为中文 banner;detach 错误码主要是 E_REQUIREMENT_NOT_FOUND
 *   / E_CODEBASE_NOT_FOUND / E_REQUIREMENT_NOT_DRAFTING / E_INTERNAL
 */

import { useEffect, useState } from 'react'
import { AgentError } from '@/lib/agent-client'

export interface DetachCodebaseDialogProps {
  open: boolean
  reqId: string
  repoName: string
  /** 父组件 onConfirm 返回 Promise;resolve 后弹窗自动关闭,reject 则 error 显示 */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * 把 AgentError 翻译成中文文案。
 *
 * detach 错误码(见 routes/requirement.ts DELETE handler):
 * - E_REQUIREMENT_NOT_FOUND → 「需求已不存在」
 * - E_CODEBASE_NOT_FOUND    → 「codebase 已不存在,可能已被自动清理」
 * - E_REQUIREMENT_NOT_DRAFTING → 「该需求已进入后续阶段,无法在 DRAFTING 之外 detach」
 * - E_INVALID_REPO_NAME      → 「仓库名包含非法字符」(理论上 route 层先拦)
 * - 其他                     → 通用后端 message
 */
function translateError(err: unknown): string {
  if (err instanceof AgentError) {
    const code = (err.body as { error?: string } | null)?.error
    const message = (err.body as { message?: string } | null)?.message
    switch (code) {
      case 'E_REQUIREMENT_NOT_FOUND':
        return '需求已不存在,无法 detach'
      case 'E_CODEBASE_NOT_FOUND':
        return 'codebase 已不存在(可能被自动清理),无需 detach'
      case 'E_REQUIREMENT_NOT_DRAFTING':
        return message ?? '该需求已进入后续阶段,无法在 DRAFTING 之外 detach'
      case 'E_INVALID_REPO_NAME':
        return '仓库名包含非法字符(/ \\ .. 等)'
      default:
        return message ?? `detach 失败(${err.status})`
    }
  }
  if (err instanceof Error) return err.message
  return '未知错误'
}

export function DetachCodebaseDialog({
  open,
  reqId,
  repoName,
  onConfirm,
  onCancel,
}: DetachCodebaseDialogProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 每次 open 变化重置状态(防止上一次的 error 残留 / submitting 卡住)
  useEffect(() => {
    if (open) {
      setSubmitting(false)
      setError(null)
    }
  }, [open])

  if (!open) return null

  async function handleConfirm() {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm()
      // resolve 后由父组件关 dialog;此处不再 onCancel(避免双触发)
    } catch (err) {
      setError(translateError(err))
      // 不关 dialog,让用户重试或取消
    } finally {
      setSubmitting(false)
    }
  }

  // 副信息中展示的 codebase 路径(用于帮助用户定位被删的是哪个目录)
  const codebasePath = `~/.aidevspace/requirements/${reqId}/codebase/${repoName}/`

  return (
    <div
      data-testid="detach-codebase-dialog"
      data-open={open ? 'true' : 'false'}
      data-repo-name={repoName}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detach-codebase-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => {
        if (!submitting) onCancel()
      }}
    >
      <div
        data-testid="detach-codebase-dialog-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2
              id="detach-codebase-dialog-title"
              data-testid="detach-codebase-dialog-title"
              className="text-lg font-semibold text-text-1"
            >
              取消关联「{repoName}」?
            </h2>
            <button
              type="button"
              data-testid="detach-codebase-dialog-close"
              onClick={onCancel}
              disabled={submitting}
              className="text-text-3 hover:text-text-1 text-lg leading-none disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="关闭"
            >
              ✕
            </button>
          </header>

          {/* 警告文案(决策 Q3:二次确认) */}
          <div
            data-testid="detach-codebase-dialog-warning"
            className="text-sm text-text-2 leading-relaxed"
          >
            <p>
              此操作会<strong className="text-error">删除本地 codebase 副本</strong>。
              未推送到远端的本地改动将丢失,且<span className="font-semibold">无法撤销</span>。
            </p>
            <p className="mt-2">
              若需保留改动,请先 <code className="px-1.5 py-0.5 bg-bg-subtle rounded font-mono text-xs">git push</code> 或拷贝到其他目录。
            </p>
          </div>

          {/* 副信息:codebase 路径(用户定位) */}
          <div
            data-testid="detach-codebase-dialog-path"
            className="text-xs text-text-3"
          >
            <span>Codebase 路径:</span>
            <code className="ml-1 px-1.5 py-0.5 bg-bg-subtle rounded font-mono text-xs break-all">
              {codebasePath}
            </code>
          </div>

          {/* 错误 banner(失败回滚 Q8) */}
          {error && (
            <div
              data-testid="detach-codebase-dialog-error"
              role="alert"
              className="text-sm text-error bg-error/10 px-3 py-2 rounded-md"
            >
              {error}
            </div>
          )}

          {/* 操作 footer */}
          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="detach-codebase-dialog-cancel"
              onClick={onCancel}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="detach-codebase-dialog-confirm"
              onClick={handleConfirm}
              disabled={submitting}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-error text-white border border-error hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? '删除中…' : '确认取消关联'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}