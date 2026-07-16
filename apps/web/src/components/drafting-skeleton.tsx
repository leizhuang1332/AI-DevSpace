'use client'

/**
 * DRAFTING 工位骨架屏(issue 01 ticket · 决策 30)
 *
 * 设计要点:
 * - **决策 30**:新建需求进入 DRAFTING 时,先用骨架屏占位 ~1.5s,
 *   内容是 3 行 shimmer 占位 + 右上角「正在创建需求…」提示
 * - **shimmer 1.5s 循环**:`animate-pulse` 用 Tailwind 内建 keyframes,
 *   替代手写 CSS(`@keyframes shimmer` 仍可在 §5 设计稿中保留作对照)
 * - **左侧主区 + 右侧状态文本**:`flex items-center justify-center` 居中
 * - **不做 API 调用 / 不持状态**:纯展示组件,由父组件 DraftingZone
 *   控制挂载时长(默认 1500ms)
 *
 * 不在本组件范围:挂载时长 / 取消 / 失败重试(由父组件决定)。
 */
export interface DraftingSkeletonProps {
  /** 右上角提示文案;默认"正在创建需求…" */
  hint?: string
}

export function DraftingSkeleton({
  hint = '正在创建需求…',
}: DraftingSkeletonProps) {
  return (
    <div
      data-testid="drafting-skeleton"
      role="status"
      aria-live="polite"
      aria-label={hint}
      className="flex items-center justify-center h-64 px-6"
    >
      <div
        data-testid="drafting-skeleton-lines"
        className="animate-pulse flex flex-col gap-3 w-full max-w-2xl"
      >
        <div
          data-testid="drafting-skeleton-line-title"
          className="h-8 bg-bg-subtle rounded w-1/3"
        />
        <div
          data-testid="drafting-skeleton-line-1"
          className="h-4 bg-bg-subtle rounded w-2/3"
        />
        <div
          data-testid="drafting-skeleton-line-2"
          className="h-4 bg-bg-subtle rounded w-1/2"
        />
      </div>
      <div
        data-testid="drafting-skeleton-hint"
        className="ml-4 text-text-2 text-sm whitespace-nowrap"
      >
        {hint}
      </div>
    </div>
  )
}