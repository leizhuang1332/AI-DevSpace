'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { DraftingRepo } from '@/lib/drafting'
import type { RepoCloneProgressStatus } from '@ai-devspace/shared'
import { useTabFocusTrap } from '@/hooks/use-tab-focus-trap'

/**
 * 关联 / 追加仓库弹层(issue 01 ticket · UI-POLISH-SPEC §9 ·
 *   repo-registry-clone/issues/06-web-frontend-followup.md)
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
 * - 从 `availableRepos` 渲染(全局仓库池,字段名 name/gitUrl/description)
 * - 已选中的 name(`pickedRepoNames` prop)默认勾选
 *
 * 移除项(决策 Q14):
 * - 「＋ 添加新仓库(粘贴 Git URL)」入口 —— 改为弹层底部一行链接
 *   「没找到?去仓库页添加 →」,引导用户跳到 `/repos` 页面添加仓库
 *   (兑现 ADR-0016 D7 欠账,issue 06 ticket 跟改)
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
  /** 全局仓库池(checkbox 列表渲染源,字段名 name/gitUrl/description) */
  availableRepos: readonly DraftingRepo[]
  /** 已选仓库 name(默认勾选,issue 06 字段从 id 改为 name) */
  pickedRepoNames: readonly string[]
  /**
   * append 模式下展示「创建时已锁定」的分支名。
   * first 模式下可省略 —— 此时分支名由用户输入。
   */
  lockedBranchName?: string
  /**
   * 提交 in-flight(issue 14):true 时 disable submit + 显示 spinner,
   * 锁定 ESC / backdrop 关闭,branch input + repo checkbox 全部只读。
   * 由父组件在 onSubmit 调起 HTTP 请求期间置 true,响应回来后置 false。
   */
  inFlight?: boolean
  /**
   * 实时 clone 进度(issue 14,数据源来自父组件 SSE 订阅 `repo-clone-progress`):
   * `repoName -> { status, attempt? }`。
   * 提交后用这个表渲染每个 repo 旁边的状态 badge,让用户看到
   * 「正在 clone multica...」实时反馈,不靠 HTTP 响应那一刻才知道进度。
   * `attempt` 仅在 `status === 'retrying'` 时附(issue 16),badge 用此显示「第 N/2 次重试」。
   */
  cloneStatuses?: Readonly<
    Record<string, { status: RepoCloneProgressStatus; attempt?: number }>
  >
  /** 提交:携带 trimmed 后的 repo name 列表 + 统一分支名(first 模式) */
  onSubmit: (value: {
    repoNames: string[]
    branchName: string
  }) => void
  /** 关闭弹层 */
  onClose: () => void
  /** 「去仓库页添加 →」链接的目标地址;缺省时 `/repos`(issue 07 落地后稳定) */
  reposPageHref?: string
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
  pickedRepoNames,
  lockedBranchName,
  inFlight = false,
  cloneStatuses,
  onSubmit,
  onClose,
  reposPageHref = '/repos',
}: AttachReposDialogProps) {
  const headingId = useId()
  const branchInputRef = useRef<HTMLInputElement | null>(null)
  const dialogRef = useRef<HTMLFormElement | null>(null)

  // -------------------------------------------------------------------------
  // 受控表单状态
  // -------------------------------------------------------------------------
  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    () => new Set(pickedRepoNames),
  )
  const [branchName, setBranchName] = useState<string>('')
  const [branchError, setBranchError] = useState<string | null>(null)

  // 打开时 reset + 移到焦点
  useEffect(() => {
    if (!open) return
    setSelectedNames(new Set(pickedRepoNames))
    setBranchName('')
    setBranchError(null)
    // first 模式才 autoFocus 到分支名 input(append 模式无 input)
    if (mode === 'first') {
      const id = window.setTimeout(() => {
        branchInputRef.current?.focus()
      }, 0)
      return () => window.clearTimeout(id)
    }
    return undefined
    // intentionally only depend on `open` toggle to reset; pickedRepoNames changes
    // mid-mount are surfaced by the user toggling chips, not by parent re-passing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode])

  // Escape 关闭(issue 01 ticket 验收 #12) — stopPropagation 防止 store 全局 Esc 同时重置其他 overlay。
  // Issue 14:in-flight 期间禁止 ESC 关闭(避免用户误关丢掉 in-progress 状态)
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inFlight) {
          // 静默吞掉 ESC —— 等 HTTP 响应回来后由父组件关闭
          e.preventDefault()
          e.stopPropagation()
          return
        }
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, inFlight])

  // Tab/Shift+Tab 焦点陷阱(issue 01 ticket 验收 #12) — 抽到 useTabFocusTrap 与 new-requirement-modal 复用
  useTabFocusTrap(open, dialogRef)

  // -------------------------------------------------------------------------
  // 派生:校验 + 启用条件
  // -------------------------------------------------------------------------
  const branchCheck = useMemo(
    () => (mode === 'first' ? validateBranchName(branchName) : null),
    [mode, branchName],
  )
  // issue 06 (ADR-0030 D7 / 决策 Q14):删除 Git URL 入口后,提交数 = 选中数;
  // 不再有 "+1 个待创建" 的过渡项需要并入。
  const pickedRepoCount = selectedNames.size
  // Issue 14:in-flight 期间强制 disabled,防止用户连点触发重复提交
  const canSubmit =
    pickedRepoCount > 0 &&
    (mode === 'append' || (branchCheck !== null && branchCheck.ok)) &&
    !inFlight

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------
  const handleToggleRepo = (repoName: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev)
      if (next.has(repoName)) next.delete(repoName)
      else next.add(repoName)
      return next
    })
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    const finalRepoNames = Array.from(selectedNames)
    const finalBranchName =
      mode === 'first' ? branchCheck?.sanitized ?? '' : lockedBranchName ?? ''
    onSubmit({ repoNames: finalRepoNames, branchName: finalBranchName })
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !inFlight) onClose()
  }

  if (!open) return null

  // -------------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------------
  return (
    <div
      data-testid="attach-repos-dialog-backdrop"
      data-mode={mode}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm p-6"
    >
      <form
        ref={dialogRef}
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
                  const checked = selectedNames.has(repo.name)
                  // Issue 14:SSE 进度表里有此 repo → 显示 status badge
                  const statusInfo = cloneStatuses?.[repo.name]
                  const status = statusInfo?.status
                  return (
                    <label
                      key={repo.name}
                      data-testid="attach-repos-dialog-repo-option"
                      data-repo-name={repo.name}
                      data-checked={checked ? 'true' : 'false'}
                      className={[
                        'flex items-center gap-3 px-2 py-1.5 rounded-md text-sm',
                        inFlight
                          ? 'cursor-not-allowed opacity-70'
                          : 'cursor-pointer',
                        checked ? 'bg-bg-elevated' : 'hover:bg-bg-elevated',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        data-testid="attach-repos-dialog-repo-checkbox"
                        data-repo-name={repo.name}
                        checked={checked}
                        onChange={() => handleToggleRepo(repo.name)}
                        disabled={inFlight}
                        className="w-4 h-4 accent-brand-500 disabled:opacity-50"
                      />
                      <span className="font-mono font-medium text-text-1 flex-1">
                        {repo.name}
                      </span>
                      {/* Issue 14 + 16:实时 clone 进度 badge(只在 in-flight + 有状态时显示) */}
                      {inFlight && status && (
                        <CloneStatusBadge
                          status={status}
                          attempt={statusInfo?.attempt}
                        />
                      )}
                    </label>
                  )
                })
              )}
            </div>

            {/* 「没找到?去仓库页添加 →」跳转引导(决策 Q14) */}
            <div
              data-testid="attach-repos-dialog-repos-hint"
              className="mt-2 text-xs text-text-3"
            >
              没找到?{' '}
              <a
                href={reposPageHref}
                data-testid="attach-repos-dialog-repos-link"
                className="text-brand-600 hover:text-brand-700 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-50 rounded"
              >
                去仓库页添加 →
              </a>
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
                readOnly={inFlight}
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
              disabled={inFlight}
              data-testid="attach-repos-dialog-cancel"
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium text-text-2 hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="attach-repos-dialog-submit"
              data-in-flight={inFlight ? 'true' : 'false'}
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              {inFlight ? (
                <>
                  <svg
                    className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  关联中...
                </>
              ) : (
                <>✓ 添加</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * Issue 14:实时 clone 进度 badge。
 * pending → 灰色「排队中」;cloning → 蓝色 spinner「克隆中」;
 * ready → 绿色 ✓「完成」;failed → 红色 ✗「失败」。
 *
 * 数据源来自父组件 SSE 订阅 `repo-clone-progress` 事件,
 * 经 `cloneStatuses` prop 传入(避免 dialog 自行订阅导致与父组件 race)。
 */
function CloneStatusBadge({
  status,
  attempt,
}: {
  status: RepoCloneProgressStatus
  /** Issue 16:仅 `status === 'retrying'` 时显示「第 N/2 次重试」 */
  attempt?: number
}): JSX.Element {
  if (status === 'pending') {
    return (
      <span
        data-testid="clone-status-badge-pending"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-bg-elevated text-text-3 border border-border"
      >
        排队中
      </span>
    )
  }
  if (status === 'cloning') {
    return (
      <span
        data-testid="clone-status-badge-cloning"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand"
      >
        <svg
          className="animate-spin h-2.5 w-2.5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        克隆中
      </span>
    )
  }
  if (status === 'ready') {
    return (
      <span
        data-testid="clone-status-badge-ready"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200"
      >
        ✓ 完成
      </span>
    )
  }
  if (status === 'retrying') {
    // Issue 16.5:spec 要求蓝色 spinner + 「第 N/2 次重试」文案(N = attempt, 2 = MAX_RETRIES)
    const label = attempt ? `第 ${attempt}/2 次重试` : '重试中'
    return (
      <span
        data-testid="clone-status-badge-retrying"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand"
      >
        <svg
          className="animate-spin h-2.5 w-2.5"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        {label}
      </span>
    )
  }
  // failed
  return (
    <span
      data-testid="clone-status-badge-failed"
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
    >
      ✗ 失败
    </span>
  )
}