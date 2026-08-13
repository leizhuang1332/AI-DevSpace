'use client'

/**
 * board 卡片详情页顶层装配(issue 08 / ADR-0027 D5 + ADR-0028 D5)
 *
 * 布局:左主区 CardDetail(2/3)+ 右栏 toggle 双态(1/3)
 * - 右栏默认态 = CardSideProperty(属性表 + [在对话中打开])
 * - 右栏展开态 = CardTranscriptPanel(消息流 + 输入框)
 *
 * toggle 状态机(ADR-0027 D5.3):
 * - state = 'property' | 'transcript'(默认 property)
 * - **不持久化**:不写 localStorage;每次进入详情页从 property 开始
 *   (沿用 ADR-0022 D4.4 + 决策 24「克制,在场」)
 * - 切换不改变 URL(URL 始终 /board/[cardId]/)
 *
 * StatusConstraintModal 集成流:
 * - handleStatusChange → useUpdateCardStatus mutate {override:false}
 * - res.ok === false → setModalState {conflicts, parentStatus, pendingStatus}
 * - 选项 A:再 PATCH {override:true} → 落盘 + 写 overrides.log
 * - 选项 B:router.push 回 board(让用户调整子卡)
 * - 选项 C:关 modal
 *
 * 守门(ADR-0023 zero-touch):不触达 Provider;transcript 仅描述 / 不挂 Run。
 */

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type {
  RequirementSummary,
  TaskCard,
  TaskCardStatusT,
  TaskCardTranscript,
} from '@ai-devspace/shared'
import {
  useBoardCardDetail,
  useBoardCardsForDetail,
  useParentRequirement,
  useUpdateCardStatus,
  useCardTranscript,
} from '@/lib/board-detail-hooks'
import { useArchiveBoardCard } from '@/lib/board-hooks'
import { CardDetail } from './CardDetail'
import { CardSideProperty } from './CardSideProperty'
import { CardTranscriptPanel } from './CardTranscriptPanel'
import {
  StatusConstraintModal,
  type ConstraintConflictItem,
} from './StatusConstraintModal'

export interface BoardCardDetailPageProps {
  requirementId: string
  cardId: string
  initialCard?: TaskCard | null
  initialCards?: TaskCard[]
  initialTranscript?: TaskCardTranscript | null
  initialParentSummary?: RequirementSummary | null
  /** 旧 transcript.yaml 是否存在(传给 CardTranscriptPanel 折叠 banner) */
  hasLegacyTranscript?: boolean
}

interface ModalState {
  open: boolean
  conflicts: ConstraintConflictItem[]
  parentStatus: string
  pendingStatus: TaskCardStatusT
}

export function BoardCardDetailPage({
  requirementId,
  cardId,
  initialCard,
  initialCards,
  initialTranscript,
  initialParentSummary,
  hasLegacyTranscript = false,
}: BoardCardDetailPageProps) {
  const router = useRouter()

  // toggle 状态(不持久化)
  const [rightPanel, setRightPanel] = useState<'property' | 'transcript'>(
    'property',
  )
  // status constraint modal 状态
  const [modal, setModal] = useState<ModalState>({
    open: false,
    conflicts: [],
    parentStatus: '',
    pendingStatus: 'backlog',
  })

  // 数据 hooks
  const { card } = useBoardCardDetail(requirementId, cardId, initialCard)
  const { cards } = useBoardCardsForDetail(requirementId, initialCards)
  const { summary } = useParentRequirement(
    requirementId,
    initialParentSummary,
  )
  // 老 transcript.yaml 仍可读(物理不删,ADR-0029 D12 决策),但 chat 路径走
  // SDK session。CardTranscriptPanel 内部接管新 chat 流;transcript 仅作为
  // legacy banner 判定线索(hasLegacyTranscript 由父组件提供)。
  useCardTranscript(requirementId, cardId, initialTranscript)
  const statusMutation = useUpdateCardStatus(requirementId)
  const archiveMutation = useArchiveBoardCard(requirementId)

  // status 变更流(Guard → 可能弹 Modal)
  const handleStatusChange = useCallback(
    (newStatus: TaskCardStatusT) => {
      statusMutation.mutate(
        { cardId, status: newStatus, override: false },
        {
          onSuccess: (res) => {
            if (!res.ok) {
              // 冲突 → 弹 Modal
              setModal({
                open: true,
                conflicts: (res.conflicts as ConstraintConflictItem[]) ?? [],
                parentStatus: res.parent_status ?? '',
                pendingStatus: newStatus,
              })
            }
            // ok:true 已落盘,hook 自动 invalidate;无需额外动作
          },
        },
      )
    },
    [cardId, statusMutation],
  )

  // 选项 A:强制切换(override=true)
  const handleForceSwitch = useCallback(() => {
    statusMutation.mutate(
      { cardId, status: modal.pendingStatus, override: true },
      {
        onSuccess: () => {
          setModal((m) => ({ ...m, open: false }))
        },
      },
    )
  }, [cardId, modal.pendingStatus, statusMutation])

  // 选项 B:跳回 board 调整子卡
  const handleAdjustChildren = useCallback(() => {
    setModal((m) => ({ ...m, open: false }))
    router.push(`/requirements/${encodeURIComponent(requirementId)}/board/`)
  }, [router, requirementId])

  // 选项 C:取消
  const handleCancel = useCallback(() => {
    setModal((m) => ({ ...m, open: false }))
  }, [])

  // 发送 transcript 消息 —— 由 CardTranscriptPanel 内部用 SDK session 流接管
  // (issue 07 / ADR-0029 D9 + D10)。此处不再有顶层 sendMutation。

  // archive
  const handleArchive = useCallback(() => {
    archiveMutation.mutate(cardId)
  }, [archiveMutation, cardId])

  if (!card) {
    return (
      <div
        data-testid="board-card-detail-loading"
        className="flex-1 flex items-center justify-center text-text-3 p-8"
      >
        加载卡片中…
      </div>
    )
  }

  return (
    <main
      data-testid="board-card-detail-page"
      data-card-id={cardId}
      data-right-panel={rightPanel}
      className="flex flex-col h-full overflow-hidden bg-bg-subtle"
    >
      {/* breadcrumb 行 */}
      <div
        data-testid="board-card-detail-crumb"
        className="px-4 py-2.5 text-sm text-text-3 border-b border-border bg-bg-elevated flex items-center gap-2"
      >
        <button
          type="button"
          onClick={() =>
            router.push(
              `/requirements/${encodeURIComponent(requirementId)}/board/`,
            )
          }
          className="text-text-3 hover:text-text-1"
        >
          {summary?.title ?? requirementId}
        </button>
        <span className="text-text-3">/</span>
        <span className="text-text-2">Board</span>
        <span className="text-text-3">/</span>
        <span className="text-text-1 font-medium truncate">{card.title}</span>
        {rightPanel === 'transcript' && (
          <span className="ml-2 text-brand text-xs font-medium">↳ 💬 对话已开启</span>
        )}
      </div>

      {/* 左主区 + 右栏 toggle 双态 */}
      <div
        className="flex-1 overflow-hidden grid gap-3 p-3"
        style={{ gridTemplateColumns: '2fr 1fr' }}
      >
        {/* 左主区 */}
        <div className="overflow-auto bg-bg-elevated border border-border rounded-lg">
          <CardDetail
            card={card}
            cards={cards}
            parentSummary={summary}
            onStatusChange={handleStatusChange}
            onArchive={handleArchive}
          />
        </div>

        {/* 右栏 toggle —— flex 容器让 CardSideProperty / CardTranscriptPanel 各自管自己滚动
            (避免 transcript 长消息时整个面板一起滚,导致输入框被推出视口) */}
        <div
          data-testid="board-card-detail-right"
          className="flex flex-col h-full overflow-hidden bg-bg-elevated border border-border rounded-lg"
        >
          {rightPanel === 'property' ? (
            <CardSideProperty
              card={card}
              cards={cards}
              onToggleTranscript={() => setRightPanel('transcript')}
              onStatusChange={handleStatusChange}
            />
          ) : (
            <CardTranscriptPanel
              card={card}
              requirementId={requirementId}
              onClose={() => setRightPanel('property')}
              hasLegacyTranscript={hasLegacyTranscript}
            />
          )}
        </div>
      </div>

      {/* StatusConstraintModal */}
      <StatusConstraintModal
        open={modal.open}
        conflicts={modal.conflicts}
        parentStatus={modal.parentStatus}
        pendingStatus={modal.pendingStatus}
        onForceSwitch={handleForceSwitch}
        onAdjustChildren={handleAdjustChildren}
        onCancel={handleCancel}
      />
    </main>
  )
}
