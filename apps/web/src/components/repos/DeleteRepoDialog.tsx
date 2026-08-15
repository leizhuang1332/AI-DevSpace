'use client'

/**
 * DeleteRepoDialog —— `/repos` 列表页卡片 hover「删除」二次确认弹窗
 *
 * issue 07 / ADR-0030 Q7:
 * - 删除只摧 yaml 条目,**不** rm 任何 codebase/<name>/ 目录(决策 113 沿用)
 * - usageCount>0 时文案必须明确告知用户「codebase/ 不会被删,但 DRAFTING 不再能选此仓库」
 * - usageCount=0 时简单文案即可
 *
 * onConfirm 只返 repo,不直接调 API —— 由调用方(列表页)负责实际 delete + 错误兜底,
 * 这样对话框是纯展示组件,便于单测。
 */

import type { RepoRegistryEntry } from '@/lib/repo-attach'

export interface DeleteRepoDialogProps {
  open: boolean
  repo: RepoRegistryEntry
  usageCount: number
  onConfirm: (repo: RepoRegistryEntry) => void
  onCancel: () => void
}

export function DeleteRepoDialog({
  open,
  repo,
  usageCount,
  onConfirm,
  onCancel,
}: DeleteRepoDialogProps) {
  if (!open) return null
  return (
    <div
      data-testid="delete-repo-dialog"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onCancel}
    >
      <div
        data-testid="delete-repo-dialog-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2
              data-testid="delete-repo-dialog-title"
              className="text-lg font-semibold text-text-1"
            >
              删除仓库「{repo.name}」?
            </h2>
            <button
              type="button"
              data-testid="delete-repo-dialog-close"
              onClick={onCancel}
              className="text-text-3 hover:text-text-1 text-lg leading-none"
              aria-label="关闭"
            >
              ✕
            </button>
          </header>

          {usageCount === 0 ? (
            <p
              data-testid="delete-repo-dialog-usage-zero"
              className="text-sm text-text-2"
            >
              该仓库尚未被任何需求使用,可以直接删除。
            </p>
          ) : (
            <div
              data-testid="delete-repo-dialog-usage-nonzero"
              className="flex flex-col gap-2 text-sm text-text-2"
            >
              <p>
                该仓库正被 <strong className="text-text-1">{usageCount}</strong> 个需求使用。
              </p>
              <p>
                删除注册表条目后,这些需求的{' '}
                <code className="font-mono bg-bg-subtle px-1 rounded">
                  codebase/{repo.name}/
                </code>{' '}
                不会被删除(本地文件保留),但你无法再在 DRAFTING 关联此仓库。
              </p>
            </div>
          )}

          <p className="text-xs text-text-3">
            删除后可在 <code className="font-mono">~/.aidevspace/repos.yaml</code> 手动恢复条目。
          </p>

          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="delete-repo-cancel"
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="delete-repo-confirm"
              onClick={() => onConfirm(repo)}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-error text-white border border-error hover:opacity-90"
            >
              确认删除
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}
