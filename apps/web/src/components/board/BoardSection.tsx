'use client'

/**
 * board section 主组件(5 列看板)— issue 07 / ADR-0027 D3
 *
 * 视觉对照基线:`docs/design/pages/board-color-options.html` scheme-a。
 *
 * 布局:
 * - BoardToolbar(顶部)
 * - 5 列 grid(STATUS_COLUMN_ORDER 顺序):backlog / todo / in_progress / in_review / done
 * - NewTaskModal 受控(列头 `+` / toolbar `[+ 新任务]` 触发)
 *
 * 数据流:
 * - SSR 注水 `initialCards` → `useBoardCards(requirementId, filter, initialData)`
 * - filter 切换 → queryKey 变 → 重拉(或客户端过滤)
 * - manual 创建 → mutation → invalidate → 列重拉 → N 计数更新
 *
 * 守门(ADR-0023 zero-touch):不触发 Run;卡片点击 no-op(详情页留 ticket 08)。
 */

import { useState } from 'react'
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
  const [filter, setFilter] = useState<BoardFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDefaultStatus, setModalDefaultStatus] =
    useState<TaskCardStatusT>('backlog')

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
      />

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
    </main>
  )
}
