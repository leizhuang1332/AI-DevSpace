'use client'

/**
 * board — PrdSplitResultBanner(issue 08 / ADR-0027 D4)
 *
 * SplitFromPrdModal onSuccess(runId) → BoardSection 设 activeSplitRunId → 渲染本 banner。
 *
 * 轮询行为(usePrdSplitRunDetail):
 * - status='running' → 显示「⏳ 拆分中…」+ 进度提示
 * - status='succeeded' → 显示「建议卡片组 N 条 [载入到看板]」按钮 → onReview
 * - status='failed' → 显示错误 banner + [重试] / [关闭]
 *
 * 守门(ADR-0023 zero-touch):轮询 GET /runs/:runId,不触达 Provider。
 */

import { usePrdSplitRunDetail } from '@/lib/board-detail-hooks'

export interface PrdSplitResultBannerProps {
  requirementId: string
  runId: string
  /** 用户点「载入到看板」 → 打开 PrdSplitReviewModal */
  onReview: () => void
  /** 关闭 banner(取消轮询 + 清 activeSplitRunId) */
  onDismiss: () => void
}

export function PrdSplitResultBanner({
  requirementId,
  runId,
  onReview,
  onDismiss,
}: PrdSplitResultBannerProps) {
  const { detail, isError } = usePrdSplitRunDetail(requirementId, runId, true)

  // 轮询 / 详情加载失败
  if (isError) {
    return (
      <div
        data-testid="board-split-result-banner"
        data-status="error"
        className="flex items-center gap-3 px-4 py-2 bg-error/10 border border-error/30 rounded-md text-sm text-error"
      >
        <span>⚠ 拆分 Run 加载失败</span>
        <button
          type="button"
          data-testid="board-split-result-dismiss"
          onClick={onDismiss}
          className="ml-auto text-error/80 hover:text-error text-xs"
        >
          关闭
        </button>
      </div>
    )
  }

  // loading(running)
  if (!detail || detail.run.status === 'running') {
    return (
      <div
        data-testid="board-split-result-banner"
        data-status="running"
        className="flex items-center gap-3 px-4 py-2 bg-brand-50 border border-brand/30 rounded-md text-sm text-brand-700"
      >
        <span className="animate-pulse">⏳</span>
        <span>PRD 拆分中…AI 正在分析 PRD 生成候选卡片</span>
      </div>
    )
  }

  // failed
  if (detail.run.status === 'failed') {
    return (
      <div
        data-testid="board-split-result-banner"
        data-status="failed"
        className="flex items-center gap-3 px-4 py-2 bg-error/10 border border-error/30 rounded-md text-sm text-error"
      >
        <span>⚠ 拆分失败:{detail.run.error ?? '未知错误'}</span>
        <button
          type="button"
          data-testid="board-split-result-dismiss"
          onClick={onDismiss}
          className="ml-auto text-error/80 hover:text-error text-xs"
        >
          关闭
        </button>
      </div>
    )
  }

  // succeeded
  const count = detail.cards.length
  return (
    <div
      data-testid="board-split-result-banner"
      data-status="succeeded"
      className="flex items-center gap-3 px-4 py-2 bg-success/10 border border-success/30 rounded-md text-sm text-success"
    >
      <span>✓</span>
      <span>建议卡片组 {count} 条</span>
      <button
        type="button"
        data-testid="board-split-load-cards"
        onClick={onReview}
        className="ml-auto px-3 py-1 rounded-md text-xs font-medium bg-success text-white border border-success hover:bg-success/90"
      >
        载入到看板
      </button>
      <button
        type="button"
        data-testid="board-split-result-dismiss"
        onClick={onDismiss}
        className="text-text-3 hover:text-text-1 text-xs"
      >
        ✕
      </button>
    </div>
  )
}
