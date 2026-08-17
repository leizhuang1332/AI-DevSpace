'use client'

/**
 * BlockerModal —— 删除前的 blocker 列表(issue 03 / ADR-0036 D2)
 *
 * 当 `useDeleteBoardCard` 抛出 `{ code: 'E_CARD_HAS_BLOCKERS', blockers }` 时,
 * BoardSection / BoardCardDetailPage 弹本组件展示子任务 / 依赖方列表,
 * 用户点条目跳转去处理(删子任务 / 拆依赖),处理完回到 board 重新发起删除。
 *
 * 设计要点:
 * - 列表项可点击 → router.push 进对应详情页(同 Tab)
 * - 子任务列表 + 依赖方列表分别渲染(沿用后端响应字段)
 * - 单一关闭按钮「我知道了」(caller 决定:点击 = 关闭 Modal,
 *   但**不**自动 retry delete —— 用户处理完 blocker 后需手动重试)
 *
 * 跳转目标若 404(罕见:用户从另一 Tab 删了那张 blocker 卡)→ 由详情页内部
 *   loading / 404 状态兜底,无需 BlockerModal 关心。
 */

import { useRouter } from 'next/navigation'
import type { BoardCardBlockers } from '@ai-devspace/shared'
import { shortCardId } from '@/lib/board'

export interface BlockerModalProps {
  open: boolean
  /** 后端 409 body.blockers —— 沿用 ADR-0036 D2 字段名 subtasks / dependents */
  blockers: BoardCardBlockers
  /** 删除目标卡片的 id(展示用);如果删的是 board 菜单上的卡,这里就是那张卡 */
  deletingCardId: string
  /** 跳转需要的 requirementId;同一 req 内跳转 */
  requirementId: string
  onClose: () => void
}

export function BlockerModal({
  open,
  blockers,
  deletingCardId,
  requirementId,
  onClose,
}: BlockerModalProps) {
  const router = useRouter()

  if (!open) return null

  const totalCount = blockers.subtasks.length + blockers.dependents.length
  const jumpTo = (cardId: string): void => {
    router.push(
      `/requirements/${encodeURIComponent(requirementId)}/board/${encodeURIComponent(cardId)}`,
    )
  }

  return (
    <div
      data-testid="blocker-modal"
      role="dialog"
      aria-modal="true"
      aria-label="无法删除任务"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        data-testid="blocker-modal-panel"
        className="bg-bg-elevated border border-border-strong rounded-lg shadow-xl w-[480px] max-w-[92vw] max-h-[90vh] overflow-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-5 py-3 border-b border-border flex items-center gap-2">
          <span aria-hidden className="text-lg">⚠️</span>
          <h2 className="text-md font-semibold text-text-1">
            无法删除任务 · 共 {totalCount} 个 blocker
          </h2>
        </header>
        <div className="px-5 py-4 flex flex-col gap-4 text-sm text-text-1">
          <p className="text-text-2">
            卡片{' '}
            <code
              data-testid="blocker-modal-deleting-id"
              className="px-1.5 py-0.5 rounded bg-bg-subtle text-xs font-mono"
            >
              {shortCardId(deletingCardId)}
            </code>{' '}
            被以下 {totalCount} 个 blocker 引用,请先处理再删除:
          </p>

          {blockers.subtasks.length > 0 && (
            <section data-testid="blocker-modal-subtasks">
              <h3 className="text-xs text-text-3 uppercase tracking-wide font-semibold mb-2">
                子任务 ({blockers.subtasks.length})
              </h3>
              <ul className="bg-bg-subtle border border-border rounded-md divide-y divide-border">
                {blockers.subtasks.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-testid="blocker-modal-subtask-item"
                      data-card-id={s.id}
                      onClick={() => jumpTo(s.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-50"
                    >
                      <span className="font-mono text-xs text-text-3">
                        {shortCardId(s.id)}
                      </span>
                      <span className="flex-1 text-sm text-text-1 truncate">
                        {s.title}
                      </span>
                      <span className="text-xs text-brand-700">前往处理 →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {blockers.dependents.length > 0 && (
            <section data-testid="blocker-modal-dependents">
              <h3 className="text-xs text-text-3 uppercase tracking-wide font-semibold mb-2">
                依赖方 ({blockers.dependents.length})
              </h3>
              <ul className="bg-bg-subtle border border-border rounded-md divide-y divide-border">
                {blockers.dependents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      data-testid="blocker-modal-dependent-item"
                      data-card-id={d.id}
                      onClick={() => jumpTo(d.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-brand-50"
                    >
                      <span className="font-mono text-xs text-text-3">
                        {shortCardId(d.id)}
                      </span>
                      <span className="flex-1 text-sm text-text-1 truncate">
                        {d.title}
                      </span>
                      <span className="text-xs text-brand-700">前往处理 →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="blocker-modal-close"
            onClick={onClose}
            className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
          >
            我知道了
          </button>
        </footer>
      </div>
    </div>
  )
}