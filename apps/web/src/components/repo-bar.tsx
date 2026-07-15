'use client'

import { useCallback } from 'react'
import { shouldShowRepoSoftWarning, type DraftingRepo } from '@/lib/drafting'

/**
 * DRAFTING 工位的底部仓库条(issue 08)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.repo-bar` 区域
 *
 * 布局(issue 08 验收 #1 #2 #3):
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ 关联仓库  ✓ refund-service  ✓ order-service  ＋ coupon-service  ＋…│
 * │                                                  [⚠ 仅 N 个仓库…] │
 * │                                                       [▶ 进入 ANALYZING] │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - **sticky 底部**:position: sticky + bottom: 0;随工作区滚动一直可见
 *   (验收 #3)。使用 sticky 而非 fixed 是因为我们想要"在工作区内滚动时跟随",
 *   而非"漂浮在 viewport 底部";前者与设计稿 `.repo-bar` 一致。
 * - **chips 多选**:点击 chip 切换 on/off 状态;`on` chip 蓝底蓝字,`off` chip
 *   灰底灰字(对应设计稿 `.chip.on` vs `.chip`)
 * - **软警告**(验收 #4 #5 #6):`shouldShowRepoSoftWarning(selectedIds)` 为 true
 *   时,渲染 ⚠ 提示。纯函数,不参与 launch validity。
 * - **启动按钮**(验收 #7 #8):`canLaunch` 完全由父组件基于 title + PRD 计算,
 *   本组件只负责呈现 + 点击回调。disabled 时按钮半透明 + cursor: not-allowed。
 * - **不影响 launch**:本组件**不**自行计算 validity、不读取仓库数量来调整
 *   disabled(issue 08 验收 #7 #8 明确要求)。
 * - **不耦合 PRD 状态**:本组件不读取 title / prdMarkdown;如果父组件想显示
 *   "请填写 PRD" 提示,通过 `launchDisabledHint` prop 显式注入(单一职责)。
 */

export interface RepoBarProps {
  /** 仓库候选列表(chip 渲染源) */
  repos: DraftingRepo[]
  /** 已选中仓库 id 列表(决定哪些 chip 是 "on" 态) */
  selectedRepoIds: string[]
  /** 切换 chip 的回调(id 不存在 → no-op) */
  onToggleRepo: (repoId: string) => void
  /**
   * Launch validity:由父组件基于 title + PRD 内容计算(issue 01 验收 #5 + issue 08 验收 #7)
   * 故意不接受 `repos` / `selectedRepoIds` —— 软警告不参与 launch 决策
   */
  canLaunch: boolean
  /**
   * 启动按钮 disabled 时显示的辅助提示文案(可选;空表示不显示)。
   * 例如 "请填写 PRD Markdown" / "请填写标题与 PRD Markdown"。
   * 由父组件(DraftingZone)基于 PRD 字段状态计算并传入,本组件不感知 PRD。
   */
  launchDisabledHint?: string
  /** 启动按钮点击回调(canLaunch=false 时不应被调用;父组件已校验) */
  onLaunch: () => void
}

/** 仓库软警告文案模板:N 由 selectedRepoIds.length 替换 */
const SOFT_WARNING_PREFIX = '⚠ 仅 '
const SOFT_WARNING_SUFFIX = ' 个仓库 · ANALYZING 可能无法完整关联代码上下文'

export function RepoBar({
  repos,
  selectedRepoIds,
  onToggleRepo,
  canLaunch,
  launchDisabledHint,
  onLaunch,
}: RepoBarProps) {
  // -------------------------------------------------------------------------
  // 软警告可见性(纯函数;selectedRepoIds 变化时 O(1) 重新计算)
  // -------------------------------------------------------------------------
  const showSoftWarning = shouldShowRepoSoftWarning(selectedRepoIds)
  const softWarningText =
    SOFT_WARNING_PREFIX +
    String(selectedRepoIds.length) +
    SOFT_WARNING_SUFFIX

  // -------------------------------------------------------------------------
  // chip 切换(防御性:id 不在 repos 中 → 忽略)
  // -------------------------------------------------------------------------
  const handleChipClick = useCallback(
    (repoId: string) => {
      if (!repos.some((r) => r.id === repoId)) return
      onToggleRepo(repoId)
    },
    [repos, onToggleRepo],
  )

  const handleChipKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, repoId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleChipClick(repoId)
      }
    },
    [handleChipClick],
  )

  // -------------------------------------------------------------------------
  // 启动按钮(disabled 时 userEvent click 会被 silent no-op,但我们仍守一道)
  // -------------------------------------------------------------------------
  const handleLaunchClick = useCallback(() => {
    if (!canLaunch) return
    onLaunch()
  }, [canLaunch, onLaunch])

  return (
    <div
      data-testid="drafting-repo-bar"
      data-selected-count={String(selectedRepoIds.length)}
      data-soft-warning={showSoftWarning ? 'true' : 'false'}
      data-can-launch={canLaunch ? 'true' : 'false'}
      data-repo-count={String(repos.length)}
      role="region"
      aria-label="仓库选择与启动操作"
      className={[
        // sticky bottom —— 跟随工作区滚动(验收 #3)
        'sticky bottom-0 z-10',
        // 视觉:与设计稿 .repo-bar 一致(浅底 + 上边框 + 内边距 + flex 横向)
        'bg-bg-elevated border-t border-border',
        'px-6 py-3',
        'flex items-center gap-3 flex-wrap',
        'text-sm',
      ].join(' ')}
    >
      {/* 标签:"关联仓库" */}
      <span
        data-testid="drafting-repo-bar-label"
        className="text-text-3 text-xs uppercase tracking-wider font-semibold"
      >
        关联仓库
      </span>

      {/* chips 容器 */}
      <div
        data-testid="drafting-repo-bar-chips"
        className="flex-1 flex items-center gap-2 flex-wrap min-w-0"
      >
        {repos.length === 0 ? (
          <span
            data-testid="drafting-repo-bar-empty"
            className="text-text-3 text-xs italic"
          >
            暂无可选仓库
          </span>
        ) : (
          repos.map((repo) => {
            const selected = selectedRepoIds.includes(repo.id)
            return (
              <button
                key={repo.id}
                type="button"
                role="switch"
                aria-checked={selected}
                data-testid="drafting-repo-chip"
                data-repo-id={repo.id}
                data-repo-name={repo.name}
                data-selected={selected ? 'true' : 'false'}
                onClick={() => handleChipClick(repo.id)}
                onKeyDown={(e) => handleChipKeyDown(e, repo.id)}
                className={[
                  'inline-flex items-center gap-1',
                  'h-[30px] px-3 rounded-full text-sm',
                  'transition-colors duration-100',
                  'focus:outline-none focus:ring-2 focus:ring-brand-50',
                  selected
                    ? 'bg-brand-50 border border-brand text-brand-700 font-medium'
                    : 'bg-bg border border-border-strong text-text-2 hover:border-brand hover:text-brand-700',
                ].join(' ')}
              >
                <span aria-hidden>{selected ? '✓' : '＋'}</span>
                <span>{repo.name}</span>
              </button>
            )
          })
        )}
      </div>

      {/* 软警告:仅 N 个仓库 · …(验收 #4 #5) */}
      {showSoftWarning && (
        <span
          data-testid="drafting-repo-soft-warning"
          data-warning-count={String(selectedRepoIds.length)}
          role="status"
          className={[
            'inline-flex items-center gap-1',
            'h-[26px] px-2.5 rounded-md',
            'text-xs font-medium',
            'bg-warning-50 text-warning',
          ].join(' ')}
        >
          {softWarningText}
        </span>
      )}

      {/* 启动按钮:从 PRD 卡片脚迁入(验收 #7 #8) */}
      {!canLaunch && launchDisabledHint && (
        <span
          data-testid="drafting-launch-disabled-hint"
          className="text-xs text-text-3"
        >
          {launchDisabledHint}
        </span>
      )}
      <button
        type="button"
        data-testid="drafting-action-launch"
        data-variant="primary"
        disabled={!canLaunch}
        onClick={handleLaunchClick}
        className={[
          'inline-flex items-center gap-1.5 rounded-md text-md font-medium',
          'h-10 px-5 bg-brand text-white hover:bg-brand-600',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus:ring-2 focus:ring-brand-50',
        ].join(' ')}
      >
        ▶ 进入 ANALYZING
      </button>
    </div>
  )
}