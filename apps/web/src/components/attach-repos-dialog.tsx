'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DraftingRepo } from '@/lib/drafting'

/**
 * 关联 / 追加仓库弹层(issue 01 ticket · UI-POLISH-SPEC §9)
 *
 * 视觉对照基线:`docs/design/pages/01-new-requirement-modal.html` §5
 *
 * 两种形态由 `mode` prop 区分:
 * - **'first'**(首次关联):显示「统一分支名」input + footer 左侧写
 *   `此分支将应用于 N 个仓库`
 * - **'append'**(追加关联):**不**显示分支名 input,顶部紫色 banner
 *   提示 `将使用统一分支名 <branchName>(创建时已锁定)`
 *
 * 仓库选择(checkbox 列表):
 * - 从 `availableRepos` 渲染(全局仓库池)
 * - 已选中的 id(`pickedRepoIds` prop)默认勾选
 * - 末尾固定一行 `+ 添加新仓库(粘贴 Git URL)`,点击展开一行 input;
 *   提交时若该 input 非空,会作为新的 repo id 合成(以 git URL hash 作 id,可选)
 *   ——本期 mock 不真正持久化新仓库,只把它的 id 传给 onSubmit 让上层处理
 *
 * 校验:
 * - 至少勾选 1 个仓库
 * - first 模式:`branchName.trim()` 非空 + 长度 ≤ 100 + 不含路径非法字符
 *   (`\` `/` `:` `*` `?` `"` `<` `>` `|` 空白)
 *
 * 键盘 / a11y:
 * - 打开时 autoFocus 到 first 模式的 branchName input,append 模式不 autoFocus
 * - ESC 关闭
 * - backdrop 点击关闭
 * - 关闭 / 提交后焦点回触发按钮(由父组件持有 ref,本组件不感知)
 */

export type AttachReposMode = 'first' | 'append'

export interface AttachReposDialogProps {
  open: boolean
  /** 弹层模式:首次关联 / 追加关联 */
  mode: AttachReposMode
  /** 弹层标题前缀,如 `关联仓库 · <title>` / `追加仓库 · <title>` */
  titlePrefix: '关联仓库' | '追加仓库'
  /** 弹层标题后缀:需求标题 */
  requirementTitle: string
  /** 全局仓库池(checkbox 列表渲染源) */
  availableRepos: readonly DraftingRepo[]
  /** 已选仓库 id(默认勾选) */
  pickedRepoIds: readonly string[]
  /**
   * append 模式下展示「创建时已锁定」的分支名。
   * first 模式下可省略 —— 此时分支名由用户输入。
   */
  lockedBranchName?: string
  /** 提交:携带 trimmed 后的 repo id 列表 + 统一分支名(first 模式) */
  onSubmit: (value: {
    repoIds: string[]
    branchName: string
  }) => void
  /** 关闭弹层 */
  onClose: () => void
}

// 路径非法字符 + 空白(参考 UI-POLISH-SPEC §3.3 + §9.3:禁止 `\` `/` `:` `*` `?` `"` `<` `>` `|` 空白)
// 注:git 分支名允许 `/`(用于 `feat/xxx` 这种 namespace 风格),所以从禁列去除;
//   内部空白被一并禁列(避免 `feat foo` 这种空格切词)。
//   `\` 是文件系统反斜杠,需要禁;其他 shell / Windows 路径字符保留。
const BRANCH_FORBIDDEN_RE = /[\\:*?"<>|\s]/g
const BRANCH_MAX_LENGTH = 100

/** 校验统一分支名:trim 后非空 + 长度 ≤ 100 + 不含路径非法字符 */
export function validateBranchName(raw: string): {
  ok: boolean
  error?: string
  sanitized: string
} {
  const sanitized = raw.replace(BRANCH_FORBIDDEN_RE, '')
  const trimmed = sanitized.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: '请填写分支名', sanitized }
  }
  if (trimmed.length > BRANCH_MAX_LENGTH) {
    return {
      ok: false,
      error: `分支名不能超过 ${BRANCH_MAX_LENGTH} 字`,
      sanitized,
    }
  }
  return { ok: true, sanitized: trimmed }
}

export function AttachReposDialog({
  open,
  mode,
  titlePrefix,
  requirementTitle,
  availableRepos,
  pickedRepoIds,
  lockedBranchName,
  onSubmit,
  onClose,
}: AttachReposDialogProps) {
  const headingId = useId()
  const branchInputRef = useRef<HTMLInputElement | null>(null)

  // ---------------------------------------------------------------------------
  // 受控表单状态
  // ---------------------------------------------------------------------------
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(pickedRepoIds),
  )
  const [branchName, setBranchName] = useState<string>('')
  const [branchError, setBranchError] = useState<string | null>(null)
  /** 「+ 添加新仓库(粘贴 Git URL)」展开态 + 输入值 */
  const [showNewRepo, setShowNewRepo] = useState<boolean>(false)
  const [newRepoUrl, setNewRepoUrl] = useState<string>('')

  // 打开时 reset + 移到焦点
  useEffect(() => {
    if (!open) return
    setSelectedIds(new Set(pickedRepoIds))
    setBranchName('')
    setBranchError(null)
    setShowNewRepo(false)
    setNewRepoUrl('')
    // first 模式才 autoFocus 到分支名 input(append 模式无 input)
    if (mode === 'first') {
      const id = window.setTimeout(() => {
        branchInputRef.current?.focus()
      }, 0)
      return () => window.clearTimeout(id)
    }
    return undefined
    // intentionally only depend on `open` toggle to reset; pickedRepoIds changes mid-mount
    // are surfaced by the user toggling chips, not by parent re-passing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  // Escape 关闭 + Tab/Shift+Tab 焦点陷阱(issue 01 ticket 验收 #12)
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      // 焦点陷阱:首尾循环 —— 收集弹层内所有可聚焦元素
      const dialog = document.querySelector<HTMLElement>(
        '[data-testid="attach-repos-dialog"]',
      )
      if (!dialog) return
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('hidden'))
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  // ---------------------------------------------------------------------------
  // 派生:校验 + 启用条件
  // ---------------------------------------------------------------------------
  const branchCheck = useMemo(
    () => (mode === 'first' ? validateBranchName(branchName) : null),
    [mode, branchName],
  )
  const pickedRepoCount = selectedIds.size + (showNewRepo && newRepoUrl.trim() ? 1 : 0)
  const canSubmit =
    pickedRepoCount > 0 &&
    (mode === 'append' || (branchCheck !== null && branchCheck.ok))

  // ---------------------------------------------------------------------------
  // handlers
  // ---------------------------------------------------------------------------
  const handleToggleRepo = (repoId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(repoId)) next.delete(repoId)
      else next.add(repoId)
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    let finalRepoIds = Array.from(selectedIds)
    if (showNewRepo && newRepoUrl.trim()) {
      // mock:用 URL 自身作 id(去掉协议 + 路径末尾斜杠,大写统一小写)
      const slug = newRepoUrl
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\.git$/, '')
        .replace(/\/+$/, '')
      finalRepoIds = [...finalRepoIds, `repo-new-${slug}`]
    }
    const finalBranchName =
      mode === 'first' ? branchCheck?.sanitized ?? '' : lockedBranchName ?? ''
    onSubmit({ repoIds: finalRepoIds, branchName: finalBranchName })
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  if (!open) return null

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------
  return (
    <div
      data-testid="attach-repos-dialog-backdrop"
      data-mode={mode}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm p-6"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="attach-repos-dialog"
        data-mode={mode}
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative z-[301] w-[480px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Head */}
        <div
          data-testid="attach-repos-dialog-head"
          className="flex items-center justify-between px-6 py-5 border-b border-border"
        >
          <h2
            id={headingId}
            data-testid="attach-repos-dialog-title"
            className="text-md font-semibold flex items-center gap-2 text-text-1"
          >
            <span aria-hidden>{mode === 'first' ? '🔗' : '➕'}</span>
            {titlePrefix} · {requirementTitle || '未命名需求'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (ESC)"
            aria-label="关闭"
            data-testid="attach-repos-dialog-close"
            className="w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm flex items-center justify-center hover:bg-bg-elevated hover:text-text-1 focus:outline-none focus:ring-2 focus:ring-brand-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          data-testid="attach-repos-dialog-body"
          className="px-6 py-5 flex flex-col gap-4 overflow-auto"
        >
          {/* append 模式顶部紫色 banner:展示锁定的分支名 */}
          {mode === 'append' && (
            <div
              data-testid="attach-repos-dialog-locked-banner"
              className="px-3 py-2 rounded-md text-xs bg-brand-50 text-brand-700 border border-brand"
            >
              将使用统一分支名 <span className="font-mono">{lockedBranchName ?? '—'}</span>(创建时已锁定)
            </div>
          )}

          {/* 仓库选择(checkbox 列表) */}
          <div>
            <label className="block text-sm font-medium text-text-1 mb-2">
              此需求将关联以下仓库(可多选)
            </label>
            <div
              data-testid="attach-repos-dialog-repo-list"
              role="group"
              aria-label="可选仓库"
              className="bg-bg-subtle border border-border rounded-md p-3 max-h-[200px] overflow-auto flex flex-col gap-1"
            >
              {availableRepos.length === 0 ? (
                <div className="text-xs text-text-3 italic py-2 px-1">
                  暂无可选仓库
                </div>
              ) : (
                availableRepos.map((repo) => {
                  const checked = selectedIds.has(repo.id)
                  return (
                    <label
                      key={repo.id}
                      data-testid="attach-repos-dialog-repo-option"
                      data-repo-id={repo.id}
                      data-checked={checked ? 'true' : 'false'}
                      className={[
                        'flex items-center gap-3 px-2 py-1.5 rounded-md cursor-pointer text-sm',
                        checked ? 'bg-bg-elevated' : 'hover:bg-bg-elevated',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        data-testid="attach-repos-dialog-repo-checkbox"
                        data-repo-id={repo.id}
                        checked={checked}
                        onChange={() => handleToggleRepo(repo.id)}
                        className="w-4 h-4 accent-brand-500"
                      />
                      <span className="font-mono font-medium text-text-1">
                        {repo.name}
                      </span>
                    </label>
                  )
                })
              )}

              {/* 添加新仓库(粘贴 Git URL) */}
              <div
                data-testid="attach-repos-dialog-new-repo"
                className="border-t border-border mt-1 pt-2"
              >
                {!showNewRepo ? (
                  <button
                    type="button"
                    data-testid="attach-repos-dialog-add-new-toggle"
                    onClick={() => setShowNewRepo(true)}
                    className="text-xs text-brand-600 hover:text-brand-700 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-50 rounded px-1"
                  >
                    ＋ 添加新仓库(粘贴 Git URL)
                  </button>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="attach-repos-dialog-new-repo-url"
                      className="text-xs text-text-3"
                    >
                      Git URL
                    </label>
                    <input
                      id="attach-repos-dialog-new-repo-url"
                      type="text"
                      data-testid="attach-repos-dialog-new-repo-url"
                      value={newRepoUrl}
                      onChange={(e) => setNewRepoUrl(e.target.value)}
                      placeholder="如:https://github.com/your-org/your-repo.git"
                      spellCheck={false}
                      className="w-full px-2 h-8 bg-bg border border-border-strong rounded-md text-xs font-mono focus:outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-50)]"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* first 模式:统一分支名 input */}
          {mode === 'first' && (
            <div>
              <label
                htmlFor="attach-repos-dialog-branch"
                className="block text-sm font-medium text-text-1 mb-2"
              >
                统一分支名 <span className="text-error">*</span>
                <span className="text-xs text-text-3 font-normal ml-1">
                  (应用于所有仓库)
                </span>
              </label>
              <input
                id="attach-repos-dialog-branch"
                ref={branchInputRef}
                type="text"
                data-testid="attach-repos-dialog-branch"
                value={branchName}
                maxLength={BRANCH_MAX_LENGTH}
                onChange={(e) => {
                  const next = e.target.value.replace(BRANCH_FORBIDDEN_RE, '')
                  setBranchName(next)
                  if (branchError) {
                    const check = validateBranchName(next)
                    setBranchError(check.ok ? null : check.error ?? null)
                  }
                }}
                onBlur={() => {
                  if (mode === 'first') {
                    const check = validateBranchName(branchName)
                    setBranchError(check.ok ? null : check.error ?? null)
                  }
                }}
                placeholder="feat/<slug>"
                spellCheck={false}
                aria-required="true"
                aria-invalid={branchError ? 'true' : 'false'}
                className="w-full px-3 h-9 bg-bg-subtle border border-border-strong rounded-md text-sm font-mono text-text-1 focus:outline-none focus:border-brand focus:bg-bg-elevated focus:shadow-[0_0_0_3px_var(--brand-50)]"
              />
              <div className="text-xs text-text-3 mt-1">
                基于默认 base 分支(main),可在仓库设置覆盖
              </div>
              {branchError && (
                <div
                  data-testid="attach-repos-dialog-branch-error"
                  role="alert"
                  className="text-xs text-error mt-1"
                >
                  {branchError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-bg-subtle">
          <span
            data-testid="attach-repos-dialog-footer-left"
            className="text-xs text-text-3"
          >
            {mode === 'first'
              ? `此分支将应用于 ${pickedRepoCount} 个仓库`
              : `追加 ${pickedRepoCount} 个仓库 · 沿用 ${lockedBranchName ?? '—'}`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="attach-repos-dialog-cancel"
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium text-text-2 hover:text-text-1 focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="attach-repos-dialog-submit"
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              ✓ 添加
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}