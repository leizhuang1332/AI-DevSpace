'use client'

/**
 * board section 主组件(5 列看板)— issue 07 / 08 / 03 / ADR-0027 D3 + D4 + D5 + ADR-0036
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
 * - **ConfirmDeleteDialog**(issue 03 / ADR-0036):菜单「删除任务」→ 输入 DELETE 二次确认
 * - **BlockerModal**(issue 03 / ADR-0036 D2):删除命中 blocker(子任务 / 依赖方)→ 列表 + 跳转
 *
 * 数据流:
 * - SSR 注水 `initialCards` → `useBoardCards(requirementId, filter, initialData)`
 * - filter 切换 → queryKey 变 → 重拉(或客户端过滤)
 * - manual 创建 → mutation → invalidate → 列重拉 → N 计数更新
 * - **卡片点击**(issue 08):router.push 进 `/requirements/[id]/board/[cardId]`
 * - **物理删除**(issue 03):菜单 → ConfirmDeleteDialog → useDeleteBoardCard.mutate;
 *   成功 invalidate + Toast;失败路由(409 blocker → BlockerModal,其他 → Toast)
 *
 * 拖拽(issue 19 / ADR-0035):BoardSection 包 `<DndContext>` + `<DragOverlay>`,
 * `handleDragEnd` 拆两种:
 * - over 是 column → 跨列拖 = `useMoveCardToColumn`(先 status 后 order_index)
 * - over 是 card → 列内重排 = `useReorderCard`(只改 order_index,乐观)
 *
 * 守门(ADR-0023 zero-touch):不触发 Run;PRD 拆走 /split-from-prd(agent 端 Run,
 * web 端轮询 + 落地候选走 POST /board/cards)。
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  BoardCardBlockers,
  TaskCard,
  TaskCardStatusT,
} from '@ai-devspace/shared'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  useBoardCards,
  useDeleteBoardCard,
  useMoveCardToColumn,
  useReorderCard,
  type DeleteBoardCardError,
} from '@/lib/board-hooks'
import { useToast } from '@/lib/use-toast'
import {
  shortCardId,
  STATUS_COLUMN_ORDER,
  type BoardFilter,
  type BoardCardListData,
} from '@/lib/board'
import {
  computeOrderIndex,
  computeOrderIndexForEmptyColumn,
  computeOrderIndexForHead,
  computeOrderIndexForTail,
  sortByOrderIndex,
} from '@ai-devspace/shared'
import { BoardToolbar } from './BoardToolbar'
import { BoardColumn } from './Column'
import { BoardCard } from './Card'
import { NewTaskModal } from './NewTaskModal'
import { SplitFromPrdModal } from './detail/SplitFromPrdModal'
import { PrdSplitResultBanner } from './detail/PrdSplitResultBanner'
import { PrdSplitReviewModal } from './detail/PrdSplitReviewModal'
import { EmptyState } from '../empty-state'
import { StatusConstraintModal } from './detail/StatusConstraintModal'
import { ConfirmDeleteDialog } from './delete/ConfirmDeleteDialog'
import { BlockerModal } from './delete/BlockerModal'
import { ToastHost } from '../toast-host'

export interface BoardSectionProps {
  requirementId: string
  /** SSR 注水的活跃卡全集(filter='all' 时复用) */
  initialCards: TaskCard[]
  initialTotal: number
}

/**
 * 计算「跨列拖到 column」(over.data.current.type === 'column')的目标 order_index。
 *
 * 列里有非 null 卡 → 取 sort 后的最大值 + 1(列尾追加,沿用 `computeOrderIndexForTail`)。
 * 列里全是 null 卡(或空列) → 视为空列 = 1(`computeOrderIndexForEmptyColumn`)。
 *
 * 历史:旧版 `BoardSection.tsx:179` 用 `sorted[last].order_index ?? 0` 兜底 null,
 * 当列里所有卡 `order_index` 都是 null(典型:`NewTaskModal` 创建不传 order_index +
 * sortByOrderIndex 把 null 排到尾部)时,`?? 0` → `computeOrderIndexForTail(0)` 抛
 * `RangeError("last (0) must be > 0")`,前端控制台崩溃,拖拽 fail。
 *
 * 修复:用「过滤非 null」替代 `?? 0`,让 all-null 列退化为 empty column(1)。
 * `issue 19 / ADR-0035 D2 + D5` —— handleDragEnd 的「跨列拖到 column」分支调用。
 *
 * @param allCards       当前活跃卡全集(同 requirement)
 * @param toStatus       目标列 status
 * @param excludeCardId  被拖卡的 id(从目标列候选中排除)
 */
export function computeTargetOrderIndexForColumnDrop(
  allCards: TaskCard[],
  toStatus: TaskCardStatusT,
  excludeCardId: string,
): number {
  const targetColumn = allCards.filter(
    (c) => c.status === toStatus && c.id !== excludeCardId,
  )
  const sorted = sortByOrderIndex(targetColumn)
  const nonNullCards = sorted.filter((c) => c.order_index !== null)
  if (nonNullCards.length === 0) {
    return computeOrderIndexForEmptyColumn()
  }
  return computeOrderIndexForTail(
    nonNullCards[nonNullCards.length - 1]!.order_index as number,
  )
}

/**
 * 跨列拖命中 ADR-0025 父子互锁冲突时,弹 Modal 让用户选 A/B/C。
 * - A 强制 override → 再 PATCH(override=true) 走 log
 * - B 父降级 → 本期未实现,弹禁选灰按钮占位(细节待 v1.0.x 下一轮 grill)
 * - C 取消 → 关闭 Modal,卡回原列(无操作)
 */
interface PendingConflictState {
  cardId: string
  toStatus: TaskCardStatusT
  toOrderIndex: number
  parentStatus: string
  conflicts: unknown[]
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
  // 拖拽(issue 19 / ADR-0035)
  const [activeDragCardId, setActiveDragCardId] = useState<string | null>(null)
  const [pendingConflict, setPendingConflict] = useState<PendingConflictState | null>(null)
  // 删除(issue 03 / ADR-0036)
  const [confirmingDelete, setConfirmingDelete] = useState<{
    cardId: string
    cardTitle: string
  } | null>(null)
  const [blockersModal, setBlockersModal] = useState<{
    cardId: string
    blockers: BoardCardBlockers
  } | null>(null)

  const initialData: BoardCardListData | undefined =
    filter === 'all'
      ? { requirementId, cards: initialCards, total: initialTotal }
      : undefined

  const { cards, isLoading, isError } = useBoardCards(
    requirementId,
    filter,
    initialData,
  )
  // deleteMutation(issue 03 / ADR-0036)替换 archiveMutation —— board UI 不再有
  // 软删入口;后端 archive 路径保留(snapshot / CLI),前端不再持有 hook。
  const deleteMutation = useDeleteBoardCard(requirementId)
  const moveMutation = useMoveCardToColumn(requirementId)
  const reorderMutation = useReorderCard(requirementId)
  const { items: toasts, push: pushToast, dismiss: dismissToast } = useToast()

  // 拖拽 sensors:PointerSensor 5px 阈值(ADR-0035 D4)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleNewTask = () => {
    setModalDefaultStatus('backlog')
    setModalOpen(true)
  }

  const handleAddInColumn = (status: TaskCardStatusT) => {
    setModalDefaultStatus(status)
    setModalOpen(true)
  }

  /**
   * 菜单「删除任务」→ 打开 ConfirmDeleteDialog(ADR-0036 D3)。
   * 不直接调 mutation;真正删除由 ConfirmDeleteDialog 的 onConfirm 触发。
   */
  const handleDeleteRequest = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId)
    setConfirmingDelete({
      cardId,
      cardTitle: card?.title ?? cardId,
    })
  }

  /**
   * ConfirmDeleteDialog 提交回调。
   *
   * 错误路由(陷阱 3:useDeleteBoardCard 不 Toast,全部由 caller 决定):
   * - `E_CARD_HAS_BLOCKERS` + blockers 非空 → 关 ConfirmDialog,改弹 BlockerModal
   * - `E_CARD_NOT_FOUND` → silent(invalidate 让 UI 重刷,卡片已不存在)
   * - 其他 → pushToast('err')
   */
  const handleDeleteConfirm = async () => {
    if (!confirmingDelete) return
    const { cardId } = confirmingDelete
    try {
      await deleteMutation.mutateAsync(cardId)
      setConfirmingDelete(null)
      pushToast(`已删除 ${shortCardId(cardId)}`, 'info')
    } catch (err) {
      const e = err as DeleteBoardCardError
      setConfirmingDelete(null)
      if (e?.code === 'E_CARD_HAS_BLOCKERS' && e.blockers) {
        setBlockersModal({ cardId, blockers: e.blockers })
      } else if (e?.code === 'E_CARD_NOT_FOUND') {
        // silent:已删,invalidate 已在 hook 内做
      } else {
        pushToast(e?.message ?? '删除失败', 'err')
      }
    }
  }

  const handleDeleteCancel = () => {
    setConfirmingDelete(null)
  }

  const handleBlockersClose = () => {
    setBlockersModal(null)
  }

  // 卡片点击 → 进详情页(issue 08 / ADR-0027 D5)
  const handleCardClick = (cardId: string) => {
    router.push(
      `/requirements/${encodeURIComponent(requirementId)}/board/${encodeURIComponent(cardId)}`,
    )
  }

  // 拖拽开始(仅记录 active card id,DragOverlay 渲染它)
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragCardId(String(event.active.id))
  }

  // 拖拽结束(ADR-0035 D1 + D5)
  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragCardId(null)
    const { active, over } = event
    if (!over) return
    const activeCard = cards.find((c) => c.id === active.id)
    if (!activeCard) return

    const overData = over.data.current as
      | { type: 'card'; status: TaskCardStatusT }
      | { type: 'column'; status: TaskCardStatusT }
      | undefined

    // 跨列拖(over 是 column) vs 列内重排(over 是 card)
    if (overData?.type === 'column') {
      const toStatus = overData.status
      // 跨列拖目标 order_index 计算抽成模块作用域纯函数,便于单测 null 列兜底
      const toOrderIndex = computeTargetOrderIndexForColumnDrop(
        cards,
        toStatus,
        String(active.id),
      )
      if (toStatus === activeCard.status) {
        // 实际是同列(没有 over card 情况)—— 走 ReorderCard
        reorderMutation.mutate({
          cardId: activeCard.id,
          toStatus,
          newOrderIndex: toOrderIndex,
        })
        return
      }
      // 跨列:走 MoveCardToColumn(走 Guard,冲突时返 conflicts)
      moveMutation.mutate(
        {
          cardId: activeCard.id,
          toStatus,
          toOrderIndex,
        },
        {
          onSuccess: (data) => {
            if (!data.ok) {
              // 冲突 → 弹 Modal
              setPendingConflict({
                cardId: activeCard.id,
                toStatus,
                toOrderIndex,
                parentStatus: data.parent_status,
                conflicts: data.conflicts,
              })
            }
          },
        },
      )
      return
    }

    // over 是 card → 列内重排(同列或跨列)
    const overCard = cards.find((c) => c.id === over.id)
    if (!overCard) return
    const toStatus = overCard.status
    const columnWithoutActive = cards
      .filter((c) => c.status === toStatus && c.id !== activeCard.id)
    const sorted = sortByOrderIndex(columnWithoutActive)
    const overIndex = sorted.findIndex((c) => c.id === overCard.id)
    const prev = overIndex > 0 ? sorted[overIndex - 1]!.order_index : null
    const next = sorted[overIndex]!.order_index

    // overIndex 为 0 → 列头拖入;target = prev/2
    // overIndex > 0 → prev (overIndex-1) 与 next (overIndex) 之间
    let newOrderIndex: number
    if (prev === null) {
      newOrderIndex =
        next !== null
          ? computeOrderIndexForHead(next)
          : computeOrderIndexForEmptyColumn()
    } else {
      newOrderIndex = computeOrderIndex(
        prev,
        next ?? computeOrderIndexForTail(prev),
      )
    }

    // 如果跨列(over card 所在列 != active card 所在列)→ 改 status + order_index
    if (toStatus !== activeCard.status) {
      moveMutation.mutate(
        {
          cardId: activeCard.id,
          toStatus,
          toOrderIndex: newOrderIndex,
        },
        {
          onSuccess: (data) => {
            if (!data.ok) {
              setPendingConflict({
                cardId: activeCard.id,
                toStatus,
                toOrderIndex: newOrderIndex,
                parentStatus: data.parent_status,
                conflicts: data.conflicts,
              })
            }
          },
        },
      )
      return
    }
    // 同列重排
    reorderMutation.mutate({
      cardId: activeCard.id,
      toStatus,
      newOrderIndex,
    })
  }

  // 冲突 modal:A 强制 override → 走 moveMutation override=true;B 父降级 → 灰;
  // C 取消 → setPendingConflict(null),卡回原列(已在原列,UI 不需动)
  const handleConflictForceSwitch = () => {
    if (!pendingConflict) return
    const { cardId, toStatus, toOrderIndex } = pendingConflict
    moveMutation.mutate(
      { cardId, toStatus, toOrderIndex, override: true },
      {
        onSuccess: (data) => {
          if (data.ok) setPendingConflict(null)
        },
      },
    )
  }
  const handleConflictCancel = () => {
    setPendingConflict(null)
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
  const byStatus = useMemo<Record<TaskCardStatusT, TaskCard[]>>(() => {
    const out: Record<TaskCardStatusT, TaskCard[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    }
    for (const card of cards) {
      out[card.status].push(card)
    }
    return out
  }, [cards])

  const isEmpty = cards.length === 0 && filter === 'all'
  const activeDragCard = activeDragCardId
    ? cards.find((c) => c.id === activeDragCardId) ?? null
    : null

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
            subtitle="点击右上角 [+ 新任务] 创建第一张任务卡片，或用 [+ 从 PRD 拆] 从 PRD 智能拆解(即将上线)。"
            cta={{
              label: '+ 新任务',
              onClick: handleNewTask,
            }}
          />
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragCardId(null)}
        >
          <div data-testid="board-grid" className="flex-1 overflow-auto p-3">
            <div
              className="grid gap-3 min-w-[1100px]"
              style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}
            >
              {STATUS_COLUMN_ORDER.map((status) => (
                <BoardColumn
                  key={status}
                  status={status}
                  cards={byStatus[status]}
                  onCardClick={handleCardClick}
                  onCardDelete={handleDeleteRequest}
                  onAddCard={handleAddInColumn}
                  activeDragCardId={activeDragCardId}
                  activeDragFromStatus={activeDragCard?.status ?? null}
                />
              ))}
            </div>
          </div>
          <DragOverlay>
            {activeDragCard ? (
              <BoardCard card={activeDragCard} draggable={false} />
            ) : null}
          </DragOverlay>
        </DndContext>
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

      {/* 父子互锁冲突(issue 19 / ADR-0035 D6):复用 detail 页 StatusConstraintModal */}
      {pendingConflict && (
        <StatusConstraintModal
          open
          pendingStatus={pendingConflict.toStatus}
          parentStatus={pendingConflict.parentStatus}
          conflicts={pendingConflict.conflicts as Parameters<typeof StatusConstraintModal>[0]['conflicts']}
          onForceSwitch={handleConflictForceSwitch}
          onAdjustChildren={handleConflictCancel}
          onCancel={handleConflictCancel}
        />
      )}

      {/* 物理删除二次确认 + blocker 列表(issue 03 / ADR-0036 D2 + D3) */}
      <ConfirmDeleteDialog
        open={confirmingDelete !== null}
        cardTitle={confirmingDelete?.cardTitle ?? ''}
        cardIdShort={confirmingDelete ? shortCardId(confirmingDelete.cardId) : ''}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
      <BlockerModal
        open={blockersModal !== null}
        blockers={blockersModal?.blockers ?? { subtasks: [], dependents: [] }}
        deletingCardId={blockersModal?.cardId ?? ''}
        requirementId={requirementId}
        onClose={handleBlockersClose}
      />

      {/* Toast 容器(全局,需求级状态) */}
      <ToastHost items={toasts} onDismiss={dismissToast} />
    </main>
  )
}
