'use client'

/**
 * board section 主组件(5 列看板)— issue 07 / 08 / ADR-0027 D3 + D4 + D5
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` scheme-a。
 *
 * 布局:
 * - BoardToolbar(顶部)
 * - 5 列 grid(STATUS_COLUMN_ORDER 顺序):backlog / todo / in_progress / in_review / done
 * - NewTaskModal 受控(列头 `+` / toolbar `[+ 新任务]` 触发)
 * - SplitFromPrdModal 受控(toolbar `[+ 从 PRD 拆]` 触发,issue 08)
 * - PrdSplitResultBanner(Run 轮询 succeeded →「建议卡片组 N 条 [载入到看板]」)
 * - PrdSplitReviewModal(载入候选 → 逐条 POST /board/cards source=prd_split)
 *
 * 数据流:
 * - SSR 注水 `initialCards` → `useBoardCards(requirementId, filter, initialData)`
 * - filter 切换 → queryKey 变 → 重拉(或客户端过滤)
 * - manual 创建 → mutation → invalidate → 列重拉 → N 计数更新
 * - **卡片点击**(issue 08):router.push 进 `/requirements/[id]/board/[cardId]`
 *
 * 守门(ADR-0023 zero-touch):不触发 Run;PRD 拆走 /split-from-prd(agent 端 Run,
 * web 端轮询 + 落地候选走 POST /board/cards)。
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { TaskCard, TaskCardStatusT } from '@ai-devspace/shared'
import { useBoardCards, useArchiveBoardCard } from '@/lib/board-hooks'
import {
  STATUS_COLUMN_ORDER,
  type BoardFilter,
  type BoardCardListData,
} from '@/lib/board'
import { BoardToolbar } from './BoardToolbar'
import { BoardColumn } from './Column'
import { NewTaskModal } from './NewTaskModal'
import { SplitFromPrdModal } from './detail/SplitFromPrdModal'
import { PrdSplitResultBanner } from './detail/PrdSplitResultBanner'
import { PrdSplitReviewModal } from './detail/PrdSplitReviewModal'
import { EmptyState } from '../empty-state'

export interface BoardSectionProps {
  requirementId: string
  /** SSR 注水的活跃卡全集(filter='all' 时复用) */
  initialCards: TaskCard[]
  initialTotal: number
}

export function BoardSection({
  requirementId,
  initialCards,
  initialTotal,
}: BoardSectionProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<BoardFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDefaultStatus, setModalDefaultStatus] =
    useState<TaskCardStatusT>('backlog')
  // PRD 拆 modal / banner / review 状态(issue 08)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [activeSplitRunId, setActiveSplitRunId] = useState<string | null>(null)
  const [reviewModalOpen, setReviewModalOpen] = useState(false)

  const initialData: BoardCardListData | undefined =
    filter === 'all'
      ? { requirementId, cards: initialCards, total: initialTotal }
      : undefined

  const { cards, isLoading, isError } = useBoardCards(
    requirementId,
    filter,
    initialData,
  )
  const archiveMutation = useArchiveBoardCard(requirementId)

  const handleNewTask = () => {
    setModalDefaultStatus('backlog')
    setModalOpen(true)
  }

  const handleAddInColumn = (status: TaskCardStatusT) => {
    setModalDefaultStatus(status)
    setModalOpen(true)
  }

  const handleArchive = (cardId: string) => {
    archiveMutation.mutate(cardId)
  }

  // 卡片点击 → 进详情页(issue 08 / ADR-0027 D5)
  const handleCardClick = (cardId: string) => {
    router.push(
      `/requirements/${encodeURIComponent(requirementId)}/board/${encodeURIComponent(cardId)}`,
    )
  }

  // PRD 拆 Run 启动成功 → 切 banner 轮询
  const handleSplitSuccess = (runId: string) => {
    setActiveSplitRunId(runId)
    setSplitModalOpen(false)
  }

  // banner [载入到看板] → 打开 review modal
  const handleReview = () => {
    setReviewModalOpen(true)
  }

  // review 全部落盘 → 刷新看板(invalidate 已在 hook 内做)+ 关 modal + 清 banner
  const handleLanded = (_count: number) => {
    setReviewModalOpen(false)
    setActiveSplitRunId(null)
  }

  // 按 status 分组到 5 列
  const byStatus: Record<TaskCardStatusT, TaskCard[]> = {
    backlog: [],
    todo: [],
    in_progress: [],
    in_review: [],
    done: [],
  }
  for (const card of cards) {
    byStatus[card.status].push(card)
  }

  const isEmpty = cards.length === 0 && filter === 'all'

  return (
    <main
      data-testid="board-section"
      data-requirement-id={requirementId}
      data-filter={filter}
      data-loading={isLoading ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg-subtle"
    >
      <BoardToolbar
        requirementId={requirementId}
        filter={filter}
        onFilterChange={setFilter}
        onNewTask={handleNewTask}
        onSplitFromPrd={() => setSplitModalOpen(true)}
      />

      {/* PRD 拆 Run 成功 banner(issue 08) */}
      {activeSplitRunId && (
        <div className="px-4 pt-3">
          <PrdSplitResultBanner
            requirementId={requirementId}
            runId={activeSplitRunId}
            onReview={handleReview}
            onDismiss={() => setActiveSplitRunId(null)}
          />
        </div>
      )}

      {isError ? (
        <div
          data-testid="board-section-error"
          className="flex-1 flex items-center justify-center p-8"
        >
          <EmptyState
            icon="⚠️"
            title="加载看板失败"
            subtitle="Agent 服务不可达或返回错误。请确认 agent(7777)在运行后刷新。"
          />
        </div>
      ) : isEmpty ? (
        <div
          data-testid="board-section-empty"
          className="flex-1 flex items-center justify-center p-8"
        >
          <EmptyState
            icon="📋"
            title="看板还没有卡片"
            subtitle="点击右上角 [+ 新任务] 创建第一张任务卡片,或用 [+ 从 PRD 拆] 从 PRD 智能拆解(即将上线)。"
            cta={{
              label: '+ 新任务',
              onClick: handleNewTask,
            }}
          />
        </div>
      ) : (
        <div
          data-testid="board-grid"
          className="flex-1 overflow-auto p-3"
        >
          <div className="grid gap-3 min-w-[1100px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            {STATUS_COLUMN_ORDER.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                cards={byStatus[status]}
                onCardClick={handleCardClick}
                onCardArchive={handleArchive}
                onAddCard={handleAddInColumn}
              />
            ))}
          </div>
        </div>
      )}

      <NewTaskModal
        requirementId={requirementId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultStatus={modalDefaultStatus}
      />

      <SplitFromPrdModal
        requirementId={requirementId}
        open={splitModalOpen}
        onClose={() => setSplitModalOpen(false)}
        onSuccess={handleSplitSuccess}
      />

      <PrdSplitReviewModal
        requirementId={requirementId}
        runId={activeSplitRunId ?? ''}
        open={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        onLanded={handleLanded}
      />
    </main>
  )
}
