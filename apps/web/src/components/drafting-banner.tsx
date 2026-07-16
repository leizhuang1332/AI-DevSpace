'use client'

/**
 * DRAFTING 顶部 banner(issue 01 ticket · 决策 30 · ticket 02 部分成功态扩展)
 *
 * 四态:
 * - **hidden**:不渲染任何 DOM(`state === 'hidden'` 时返回 null)
 * - **success**(淡黄 `#fffbeb`):`📦 未关联任何仓库 · 添加仓库后将在 RepoBar 操作`
 *   - 右侧 `[+ 关联仓库]` + `✕`
 * - **partial**(橙色 `#fff7ed`,ticket 02 验收 #8 部分成功):`⚠ 已关联 N · 失败 M:<name1> <name2>`
 *   - 右侧 `[重试该 repo]` + `✕`
 * - **error**(淡红 `#fef2f2`):`❌ <错误类型>`,如「网络异常 / 鉴权失败 / 磁盘空间不足」
 *   - 右侧 `[重试]`(不显示 ✕)
 *
 * 设计要点:
 * - 完全受控:`state` + `errorMessage` + `partialSummary` + 四个回调全部由父组件持有,
 *   本组件不持 state、不读 context、不访问 sessionStorage
 * - 焦点回弹:`trigger` 字符串标识被点击的入口('banner-plus' / 'banner-retry'),
 *   父组件基于该标识自行 querySelector 焦点目标并 focus(本组件不持 ref)
 * - 错误态无 `✕`:决策 30 L3 规定失败必须可重试,而非被静默关闭
 * - **partial 颜色刻意区别于 success**:warning 警示语义;不要复用 success 的 #fffbeb
 *
 * 不在本组件范围:
 * - 触发弹层(`onRequestAttach` 只回调,不直接调 useUIOverlay)
 * - 重试逻辑(`onRetry` / `onRetryFailed` 只回调,父组件决定是重新调 API 还是弹窗重开)
 */
export type DraftingBannerState = 'hidden' | 'success' | 'partial' | 'error'

export interface DraftingPartialSummary {
  /** 成功的 repo 数量 */
  succeeded: number
  /** 失败的 repo 名列表(显示在文案中) */
  failedNames: string[]
}

export interface DraftingBannerProps {
  /** banner 状态:`hidden` 时不渲染任何 DOM */
  state: DraftingBannerState
  /**
   * 错误态文案(error 时必填,其他态忽略)。
   * 如 "网络异常" / "鉴权失败" / "磁盘空间不足" —— 见 ticket 02 E_* 错误码。
   */
  errorMessage?: string
  /**
   * 部分成功摘要(partial 时必填,其他态忽略)。
   * 由父组件(drafting-zone)从后端 results 数组派生。
   */
  partialSummary?: DraftingPartialSummary
  /** 点 banner `[+ 关联仓库]` 按钮(成功态);第二参数为触发按钮的 ref 用于焦点回弹 */
  onRequestAttach?: (trigger: 'banner-plus' | 'banner-retry') => void
  /** 点 banner ✕ 按钮(成功态 / 部分成功态) */
  onDismiss?: () => void
  /** 点 banner `[重试]` 按钮(失败态) */
  onRetry?: () => void
  /**
   * 点 banner `[重试该 repo]` 按钮(部分成功态)。
   * 父组件应基于 failedNames 重新调弹层 / API,把失败 repo 重新提交。
   */
  onRetryFailed?: (failedNames: string[]) => void
}

export function DraftingBanner({
  state,
  errorMessage,
  partialSummary,
  onRequestAttach,
  onDismiss,
  onRetry,
  onRetryFailed,
}: DraftingBannerProps) {
  if (state === 'hidden') return null

  if (state === 'error') {
    return (
      <div
        data-testid="drafting-banner"
        data-banner-state="error"
        role="alert"
        className={[
          'px-6 py-3 bg-[#fef2f2] border-b border-[#fecaca]',
          'flex items-center justify-between',
          'text-sm text-[#991b1b]',
        ].join(' ')}
      >
        <div
          data-testid="drafting-banner-left"
          className="flex items-center gap-2"
        >
          <span aria-hidden>❌</span>
          <span>{errorMessage ?? '创建失败,请重试'}</span>
        </div>
        <div
          data-testid="drafting-banner-actions"
          className="flex items-center gap-2"
        >
          {onRetry && (
            <button
              type="button"
              data-testid="drafting-banner-retry"
              onClick={() => {
                onRequestAttach?.('banner-retry')
                onRetry()
              }}
              className={[
                'h-7 px-3 rounded-md bg-bg-elevated border border-[#fecaca]',
                'text-sm text-[#991b1b] hover:bg-[#fef2f2]',
                'focus:outline-none focus:ring-2 focus:ring-[#fecaca]',
              ].join(' ')}
            >
              重试
            </button>
          )}
        </div>
      </div>
    )
  }

  if (state === 'partial') {
    const succeeded = partialSummary?.succeeded ?? 0
    const failedNames = partialSummary?.failedNames ?? []
    return (
      <div
        data-testid="drafting-banner"
        data-banner-state="partial"
        data-failed-count={String(failedNames.length)}
        role="alert"
        className={[
          'px-6 py-3 bg-[#fff7ed] border-b border-[#fed7aa]',
          'flex items-center justify-between gap-3',
          'text-sm text-[#9a3412]',
        ].join(' ')}
      >
        <div
          data-testid="drafting-banner-left"
          className="flex items-center gap-2 flex-wrap min-w-0"
        >
          <span aria-hidden>⚠️</span>
          <span>
            已关联 {succeeded} · 失败 {failedNames.length}:
            {failedNames.length > 0 ? failedNames.join(' ') : '(无)'}
          </span>
        </div>
        <div
          data-testid="drafting-banner-actions"
          className="flex items-center gap-2 shrink-0"
        >
          {onRetryFailed && failedNames.length > 0 && (
            <button
              type="button"
              data-testid="drafting-banner-retry-failed"
              onClick={() => onRetryFailed(failedNames)}
              className={[
                'h-7 px-3 rounded-md bg-bg-elevated border border-[#fed7aa]',
                'text-sm text-[#9a3412] hover:bg-[#fff7ed]',
                'focus:outline-none focus:ring-2 focus:ring-[#fed7aa]',
              ].join(' ')}
            >
              重试该 repo
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              data-testid="drafting-banner-close"
              aria-label="关闭 banner"
              onClick={onDismiss}
              className={[
                'w-7 h-7 rounded-md text-[#9a3412]',
                'hover:bg-[#fff7ed]',
                'focus:outline-none focus:ring-2 focus:ring-[#fed7aa]',
              ].join(' ')}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    )
  }

  // success state
  return (
    <div
      data-testid="drafting-banner"
      data-banner-state="success"
      role="status"
      className={[
        'px-6 py-3 bg-[#fffbeb] border-b border-[#fde68a]',
        'flex items-center justify-between',
        'text-sm text-[#78350f]',
      ].join(' ')}
    >
      <div
        data-testid="drafting-banner-left"
        className="flex items-center gap-2"
      >
        <span aria-hidden>📦</span>
        <span>未关联任何仓库 · 添加仓库后将在 RepoBar 操作</span>
      </div>
      <div
        data-testid="drafting-banner-actions"
        className="flex items-center gap-2"
      >
        {onRequestAttach && (
          <button
            type="button"
            data-testid="drafting-banner-plus"
            onClick={() => onRequestAttach('banner-plus')}
            className={[
              'h-7 px-3 rounded-md bg-bg-elevated border border-[#fde68a]',
              'text-sm text-[#78350f] hover:bg-[#fffbeb]',
              'focus:outline-none focus:ring-2 focus:ring-[#fde68a]',
            ].join(' ')}
          >
            ＋ 关联仓库
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            data-testid="drafting-banner-close"
            aria-label="关闭 banner"
            onClick={onDismiss}
            className={[
              'w-7 h-7 rounded-md text-[#78350f]',
              'hover:bg-[#fffbeb]',
              'focus:outline-none focus:ring-2 focus:ring-[#fde68a]',
            ].join(' ')}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}