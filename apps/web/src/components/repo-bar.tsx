'use client'

import { useCallback, useEffect, useState } from 'react'
import { shouldShowRepoSoftWarning, type DraftingRepo } from '@/lib/drafting'

/**
 * DRAFTING 工位的顶部仓库条 · 折叠 sticky(issue 09;从底部移到顶部)
 *
 * 视觉对照基线:`docs/design/pages/repo-bar-redesign-comparison-20260720.html` 方案 B
 *   + `docs/design/pages/19-final-drafting.html` 的 `.repo-bar` 区域
 *
 * 布局:
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ N=0 空态(沿用 issue 01 ticket):                                       │
 * │  关联仓库  [＋ 添加仓库…]  💡 首次添加仓库时会请你填写统一分支名  ▶  │
 * │                                                                       │
 * │ N≥1 折叠态(默认 40px):                                                │
 * │  关联仓库  [📦 已选 N 个仓库 ▾] [＋ 添加]  [⚠ 仅 N 个仓库 · …]   ▶   │
 * │                                                                       │
 * │ N≥1 展开态(用户点击 ▾ 后,内联展开):                                  │
 * │  ┌──────────────────────────────────────────────────────────────┐    │
 * │  │ [✓ refund 🟢 feat/foo ✕] [✓ order ✕] [＋ 添加仓库…]          │    │
 * │  │ ⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文         │    │
 * │  └──────────────────────────────────────────────────────────────┘    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * 设计要点(issue 09 7 个 freeze 决策):
 * - **默认折叠**(Q2 方案 B):bar 高度锁定 40px,只有"摘要"行可见,不再随 N
 *   增长换行膨胀(N=8 时从 135px 降到 40px,核心痛点)。
 * - **内联展开**(Q5 a):bar 自身撑开,展开面板从 bar 内部向下展开,bar
 *   仍 sticky top 不变(放在 PRD 主文档之上)。展开态不遮工作区(只是 bar 变高)。
 * - **边框与 PRD 同色同粗,但改用虚线**:PRD 主文档卡片的边框是 1px 实线
 *   `border` + `border-border`,RepoBar 同步使用同样的颜色 + 粗细,但用
 *   `border-dashed` 虚线样式(因为 RepoBar 是贴顶横条而非独立卡片,
 *   圆角/阴影仍只属于 PRD)。
 * - **N=0 沿用现状**(Q9 a):N=0 不走折叠,直接显示 issue 01 ticket 的
 *   `[＋ 添加仓库…]` + `💡 首次添加仓库时会请你填写统一分支名` hint。
 * - **× 一键取消关联**(Q1 + Q4 + Q6):点 × 立即从 `selectedRepoIds`
 *   移除,无 toast 无动画。可逆(重新 attach 即可)。
 * - **软警告折叠态外层常驻**(Q7 a):N≤1 时 ⚠ 文案在折叠行显示。
 *   展开态 chip 区下方再保留一份(同一文案,可见性不重复即可)。
 * - **展开区只显示已选 chip + ×**(Q8 a):不混入"可选但未选"——bar 是
 *   清理已选的地方,选/追加走 attach 弹层。
 * - **不耦合 PRD**:本组件不读 prdMarkdown;launch validity 完全由
 *   父组件(DraftingZone)基于 prdMarkdown 计算,经 props 注入。
 *
 * 不影响 launch(issue 08 验收 #7 #8 回归):`canLaunch` 由父组件基于
 * title + PRD 决定,本组件**不**根据仓库数量调整 disabled。
 *
 * 启动按钮已移除(后续 issue 迁移到 PRD 主文档 / Toolbar):本组件 props
 * 仍保留 `onLaunch` / `canLaunch` / `launchDisabledHint` 三个 launch 相关
 * 接口契约,供后续补 UI 时复用。本组件当前不渲染该按钮与 disabled hint。
 *
 * 单一职责:本组件不感知 prdMarkdown / title / 草稿内容,只渲染仓库
 * 选择 UI(launch 转发按需启用,目前未渲染)。
 */

export interface RepoBarProps {
  /** 仓库候选列表(过滤掉 "＋" 开头的占位条目) */
  repos: DraftingRepo[]
  /** 已选中仓库 id 列表 */
  selectedRepoIds: string[]
  /**
   * 失败的 repo id 列表(ticket 02 验收 #8 partial success)。
   * 失败的 chip 渲染为红色边框 + 错误图标 + 文案。
   */
  failedRepoIds?: readonly string[]
  /**
   * 取消关联回调(issue 09 · detach 按钮):点 × 立即从
   * `selectedRepoIds` 移除。无确认、无动画。
   */
  onDetachRepo: (repoId: string) => void
  /**
   * Launch validity:由父组件基于 title + PRD 内容计算(issue 08 验收 #7)。
   * 故意不接受 `repos` / `selectedRepoIds` —— 软警告不参与 launch 决策。
   */
  canLaunch: boolean
  /**
   * 启动按钮 disabled 时显示的辅助提示文案(可选;空表示不显示)。
   * 由父组件(DraftingZone)基于 PRD 字段状态计算并传入,本组件不感知 PRD。
   */
  launchDisabledHint?: string
  /** 启动按钮点击回调(canLaunch=false 时不应被调用;父组件已校验) */
  onLaunch: () => void
  /**
   * 触发关联仓库弹层的回调(issue 01 ticket):
   * - 提供:折叠态显示 `＋ 添加`,N=0 时显示 brand 色空态 + hint
   * - 不提供:不渲染 `＋` 入口
   */
  onRequestAttach?: () => void
  /**
   * ticket 02 验收 #9:已关联 repo chip 显示绿色小圆点 🟢 + 分支名。
   * lockedBranchName 为空时 chip 仍显示选中态,但不追加绿色小圆点。
   */
  attachedBranchName?: string
}

/** 仓库软警告文案模板:N 由 selectedRepoIds.length 替换 */
const SOFT_WARNING_PREFIX = '⚠ 仅 '
const SOFT_WARNING_SUFFIX = ' 个仓库 · ANALYZING 可能无法完整关联代码上下文'

/** 占位条目 name 前缀(issue 08 mock 期的"＋ 更多仓库…"占位) */
const PLACEHOLDER_PREFIX = '＋'

/** 摘要行固定高度(px)—— 与 issue 09 spec 视野代价 -70% 的承诺一致 */
const SUMMARY_ROW_HEIGHT_PX = 40

export function RepoBar({
  repos,
  selectedRepoIds,
  failedRepoIds = [],
  onDetachRepo,
  canLaunch,
  launchDisabledHint,
  onLaunch,
  onRequestAttach,
  attachedBranchName,
}: RepoBarProps) {
  // -------------------------------------------------------------------------
  // 折叠 / 展开 toggle(issue 09 Q2 方案 B)—— 默认折叠
  // -------------------------------------------------------------------------
  const [collapsed, setCollapsed] = useState<boolean>(true)

  // -------------------------------------------------------------------------
  // N=0 复位:从 N≥1 回到 N=0(全部 detach)时,自动回到 N=0 空态
  // 这保证下一次 attach 后 bar 默认是折叠的,符合 "N=0 走空态" 不变量
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (selectedRepoIds.length === 0) {
      setCollapsed(true)
    }
  }, [selectedRepoIds.length])

  // -------------------------------------------------------------------------
  // 软警告可见性(纯函数;selectedRepoIds 变化时 O(1) 重新计算)
  // -------------------------------------------------------------------------
  const showSoftWarning = shouldShowRepoSoftWarning(selectedRepoIds)

  // -------------------------------------------------------------------------
  // 真实可选仓库列表(过滤掉以 "＋" 开头的占位条目)
  // -------------------------------------------------------------------------
  const selectableRepos = onRequestAttach
    ? repos.filter((r) => !r.name.startsWith(PLACEHOLDER_PREFIX))
    : repos

  const isEmptyState = selectedRepoIds.length === 0

  // 已选仓库(用于展开态渲染)
  const selectedRepos = selectableRepos.filter((r) =>
    selectedRepoIds.includes(r.id),
  )

  // 失败但未选中的仓库(ticket 02 验收 #8 partial success)—— 也展示在
  // 展开区(红边 + ✕),让用户看到"刚才 attach 失败的 repo 还没选中";
  // 重试走 banner「重试该 repo」按钮,不在 chip 上提供重试入口
  // (避免和 banner 重试逻辑分裂)。
  // 用 id Set 做快速去重:同时在 selectedRepoIds 和 failedRepoIds 的
  // repo 视为"已选"(以 selectedRepos 为准)。
  const failedOnlyRepos = selectableRepos.filter(
    (r) =>
      failedRepoIds.includes(r.id) && !selectedRepoIds.includes(r.id),
  )

  // -------------------------------------------------------------------------
  // handlers
  // -------------------------------------------------------------------------
  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const handleDetach = useCallback(
    (repoId: string) => {
      if (!selectedRepoIds.includes(repoId)) return
      onDetachRepo(repoId)
    },
    [onDetachRepo, selectedRepoIds],
  )

  const handleLaunchClick = useCallback(() => {
    if (!canLaunch) return
    onLaunch()
  }, [canLaunch, onLaunch])

  // -------------------------------------------------------------------------
  // 摘要文案:N 数字由 selectedRepoIds.length 提供
  // -------------------------------------------------------------------------
  const summaryLabel =
    selectedRepoIds.length === 1
      ? '已选 1 个仓库'
      : `已选 ${selectedRepoIds.length} 个仓库`

  return (
    <div
      data-testid="drafting-repo-bar"
      data-selected-count={String(selectedRepoIds.length)}
      data-soft-warning={showSoftWarning ? 'true' : 'false'}
      data-can-launch={canLaunch ? 'true' : 'false'}
      data-repo-count={String(repos.length)}
      data-empty-state={isEmptyState ? 'true' : 'false'}
      data-collapsed={collapsed ? 'true' : 'false'}
      role="region"
      aria-label="仓库选择与启动操作"
      className={[
        // sticky top —— 跟随工作区滚动(迁到 PRD 主文档上方后改为贴顶)
        'sticky top-0 z-10',
        // 边框:与 PRD 主文档(drafting-prd-pane)保持一致
        // —— 同粗细 border(1px) + 同色 border-border,
        // 但改用 dashed 虚线以便与 PRD 实线卡片视觉区分(因为 RepoBar 是 sticky
        // 横向条而非独立卡片);圆角 / 阴影留给 PRD 卡片
        'border border-dashed border-border bg-bg-elevated',
        'text-sm',
      ].join(' ')}
    >
      {/* ============================================================== */}
      {/* N=0 空态(issue 01 ticket)—— 不走折叠,沿用现状                  */}
      {/* ============================================================== */}
      {isEmptyState ? (
        <div
          data-testid="repo-bar-empty"
          className="flex items-center gap-3 px-6 py-3 flex-wrap"
        >
          {/* 标签:"关联仓库" */}
          <span
            data-testid="drafting-repo-bar-label"
            className="text-text-3 text-xs uppercase tracking-wider font-semibold"
          >
            关联仓库
          </span>

          {/* 「＋ 添加仓库…」按钮(主色,引导点击) */}
          {onRequestAttach ? (
            <button
              type="button"
              data-testid="repo-bar-add"
              onClick={onRequestAttach}
              className={[
                'inline-flex items-center h-[30px] px-3 rounded-md text-sm',
                'border border-brand bg-brand-50 text-brand-700',
                'hover:bg-brand-100',
                'focus:outline-none focus:ring-2 focus:ring-brand-50',
              ].join(' ')}
            >
              ＋ 添加仓库…
            </button>
          ) : (
            <span className="text-text-3 text-xs italic">暂无可选仓库</span>
          )}

          {/* 空态 hint(issue 01 ticket) */}
          {onRequestAttach && (
            <span
              data-testid="repo-bar-empty-hint"
              className="text-xs text-text-3"
            >
              💡 首次添加仓库时会请你填写统一分支名
            </span>
          )}

          {/* 软警告在 N=0 也常驻(issue 08 验收 #4)—— 折叠 sticky 形态下保留视觉一致性 */}
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
                'flex-shrink-0',
              ].join(' ')}
            >
              {SOFT_WARNING_PREFIX +
                String(selectedRepoIds.length) +
                SOFT_WARNING_SUFFIX}
            </span>
          )}

          {/* 启动 ANALYZING 按钮已移除 —— 入口待后续 issue 补到 PRD 主文档 / Toolbar
              位置;canLaunch / launchDisabledHint / onLaunch 等 props 保留以供复用。
              disabled hint 也随之省略(用户不再此处看到 launch disabled 提示)。*/}
        </div>
      ) : (
        <>
          {/* ========================================================== */}
          {/* N≥1 摘要行(40px,固定高度,issue 09 spec)                   */}
          {/* ========================================================== */}
          <div
            data-testid="drafting-repo-bar-summary-row"
            style={{ minHeight: `${SUMMARY_ROW_HEIGHT_PX}px` }}
            className="flex items-center gap-3 px-6"
          >
            {/* 标签:"关联仓库" */}
            <span
              data-testid="drafting-repo-bar-label"
              className="text-text-3 text-xs uppercase tracking-wider font-semibold flex-shrink-0"
            >
              关联仓库
            </span>

            {/* 折叠摘要按钮 —— 点击切换 */}
            <button
              type="button"
              data-testid="drafting-repo-bar-summary"
              data-summary-count={String(selectedRepoIds.length)}
              onClick={handleToggleCollapse}
              aria-expanded={!collapsed}
              aria-controls="drafting-repo-bar-expanded"
              className={[
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm',
                'bg-bg border border-border-strong text-text-1',
                'hover:border-brand hover:text-brand-700',
                'focus:outline-none focus:ring-2 focus:ring-brand-50',
                'flex-shrink-0',
              ].join(' ')}
            >
              <span aria-hidden>📦</span>
              <span>{summaryLabel}</span>
              <span
                aria-hidden
                className="text-text-3 ml-0.5 text-xs"
                style={{
                  transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  transition: 'transform 0.15s',
                  display: 'inline-block',
                }}
              >
                ▾
              </span>
            </button>

            {/* 「＋ 添加」按钮(N≥1 也可继续追加,触发 attach 弹层 append 模式) */}
            {onRequestAttach && (
              <button
                type="button"
                data-testid="repo-bar-add-more"
                onClick={onRequestAttach}
                aria-label="追加仓库"
                className={[
                  'inline-flex items-center gap-1',
                  'h-8 px-3 rounded-full text-sm',
                  'border border-dashed border-border-strong text-text-3',
                  'hover:border-brand hover:text-brand-700 hover:bg-brand-50',
                  'focus:outline-none focus:ring-2 focus:ring-brand-50',
                  'flex-shrink-0',
                ].join(' ')}
              >
                <span aria-hidden>＋</span>
                <span>添加</span>
              </button>
            )}

            {/* 软警告(折叠态外层常驻) */}
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
                  'flex-shrink-0',
                ].join(' ')}
              >
                {SOFT_WARNING_PREFIX +
                  String(selectedRepoIds.length) +
                  SOFT_WARNING_SUFFIX}
              </span>
            )}

            {/* 启动 ANALYZING 按钮已移除 —— 入口待后续 issue 补到 PRD 主文档
              / Toolbar;canLaunch / launchDisabledHint / onLaunch 等 props 保留
              以供复用。disabled hint 也随之省略。*/}
          </div>

          {/* ========================================================== */}
          {/* N≥1 展开态(用户主动展开时内联出现)                          */}
          {/* ========================================================== */}
          {!collapsed && (
            <div
              data-testid="drafting-repo-bar-chips"
              id="drafting-repo-bar-expanded"
              className="flex flex-wrap items-center gap-2 px-6 py-3 border-t border-border"
            >
              {selectedRepos.length === 0 && failedOnlyRepos.length === 0 ? (
                <span className="text-xs text-text-3 italic">
                  暂无已选仓库(异常状态:selectedRepoIds 非空但 repos 中找不到)
                </span>
              ) : (
                <>
                  {/* 已选 chip:可 × 取消关联 */}
                  {selectedRepos.map((repo) => {
                    // ticket 02 验收 #9:已关联 + 锁定分支名 → 显示绿色小圆点 + 分支名
                    const showGreenDot = !!attachedBranchName
                    return (
                      <div
                        key={repo.id}
                        data-testid="drafting-repo-chip"
                        data-repo-id={repo.id}
                        data-repo-name={repo.name}
                        data-selected="true"
                        data-failed="false"
                        className={[
                          'inline-flex items-center gap-1',
                          'h-[30px] pl-3 pr-1 rounded-full text-sm',
                          'bg-brand-50 border border-brand text-brand-700 font-medium',
                        ].join(' ')}
                      >
                        <span aria-hidden>✓</span>
                        <span>
                          {showGreenDot ? '🟢 ' : ''}
                          {repo.name}
                        </span>
                        {showGreenDot && (
                          <span
                            data-testid="drafting-repo-chip-branch"
                            className="font-mono text-xs opacity-80"
                          >
                            {attachedBranchName}
                          </span>
                        )}
                        {/* × 取消关联按钮(issue 09)—— 一键生效,即时消失 */}
                        <button
                          type="button"
                          data-testid="drafting-repo-chip-detach"
                          data-repo-id={repo.id}
                          onClick={() => handleDetach(repo.id)}
                          aria-label={`取消关联 ${repo.name}`}
                          className={[
                            'inline-flex items-center justify-center',
                            'w-5 h-5 rounded-full',
                            'bg-bg-subtle text-text-2',
                            'hover:bg-error hover:text-white',
                            'focus:outline-none focus:ring-2 focus:ring-brand-50',
                            'ml-1 transition-colors',
                          ].join(' ')}
                        >
                          <span aria-hidden style={{ fontSize: '10px' }}>
                            ✕
                          </span>
                        </button>
                      </div>
                    )
                  })}

                  {/* 失败但未选中 chip(ticket 02 验收 #8)—— 仅展示,× 不提供;
                      重试走 banner「重试该 repo」按钮。data-selected="false"。 */}
                  {failedOnlyRepos.map((repo) => (
                    <div
                      key={`failed-${repo.id}`}
                      data-testid="drafting-repo-chip"
                      data-repo-id={repo.id}
                      data-repo-name={repo.name}
                      data-selected="false"
                      data-failed="true"
                      className={[
                        'inline-flex items-center gap-1',
                        'h-[30px] px-3 rounded-full text-sm',
                        'bg-error-50 border border-error text-error',
                      ].join(' ')}
                    >
                      <span aria-hidden>✕</span>
                      <span>{repo.name}</span>
                    </div>
                  ))}
                </>
              )}

              {/* 软警告在展开态也保留(可见性不重复——折叠行已显示,这里
                  是给展开后 chip 区域下方的二级提示;若折叠行未显示软警告
                  时,这里也隐藏) */}
              {showSoftWarning && (
                <div
                  data-testid="drafting-repo-expanded-soft-warning"
                  role="status"
                  className="w-full mt-1 text-xs text-warning"
                >
                  {SOFT_WARNING_PREFIX +
                    String(selectedRepoIds.length) +
                    SOFT_WARNING_SUFFIX}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
