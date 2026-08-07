'use client'

/**
 * board — PrdSplitReviewModal(issue 08 / ADR-0027 D4)
 *
 * PrdSplitResultBanner [载入到看板] → 打开本 modal。
 *
 * 行为:
 * - usePrdSplitRunDetail 拉 cards[](succeeded Run 的候选卡片)
 * - 每条候选:checkbox + title + content 预览 + priority 下拉(默认 suggested_priority)
 * - [全部确认] → 遍历勾选项 useLandPrdSplitCard(POST /board/cards source=prd_split)
 *   → onLanded(n)(BoardSection invalidate board 列表 + 关 modal)
 *
 * 守门(ADR-0023 zero-touch):land 走现有 POST /board/cards,不触达 Provider。
 */

import { useState } from 'react'
import type { TaskCardPriorityT } from '@ai-devspace/shared'
import { usePrdSplitRunDetail, useLandPrdSplitCard } from '@/lib/board-detail-hooks'

export interface PrdSplitReviewModalProps {
  requirementId: string
  runId: string
  open: boolean
  onClose: () => void
  /** 落盘成功 N 条 → BoardSection 刷新看板 */
  onLanded: (count: number) => void
}

const PRIORITY_OPTIONS: Array<TaskCardPriorityT | 'none'> = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
]

export function PrdSplitReviewModal({
  requirementId,
  runId,
  open,
  onClose,
  onLanded,
}: PrdSplitReviewModalProps) {
  const { detail } = usePrdSplitRunDetail(requirementId, runId, open)
  const landMutation = useLandPrdSplitCard(requirementId)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [priorityOverrides, setPriorityOverrides] = useState<
    Record<number, TaskCardPriorityT | 'none'>
  >({})

  if (!open) return null

  const cards = detail?.cards ?? []

  // 默认全选(用户可取消个别)
  const effectiveSelected =
    selected.size > 0
      ? selected
      : new Set(cards.map((_, idx) => idx))

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      // 当前是默认全选(selected 空)→ 先铺满再排除这一项
      let next = new Set(prev)
      if (prev.size === 0) {
        next = new Set(cards.map((_, i) => i))
      }
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleConfirmAll = async () => {
    const indices = Array.from(effectiveSelected).sort((a, b) => a - b)
    let count = 0
    for (const idx of indices) {
      const proposal = cards[idx]
      if (!proposal) continue
      const priorityOverride = priorityOverrides[idx]
      try {
        await landMutation.mutateAsync({
          title: proposal.title,
          content: proposal.content,
          priority:
            priorityOverride === 'none' || priorityOverride === undefined
              ? (proposal.suggested_priority ?? null)
              : priorityOverride,
          labels: proposal.labels,
        })
        count++
      } catch {
        // 单条失败不中断,继续落剩余
      }
    }
    onLanded(count)
  }

  return (
    <div
      data-testid="board-split-review-modal"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        data-testid="board-split-review-modal-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[640px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-1">
              候选卡片组({cards.length} 条)
            </h2>
            <button
              type="button"
              data-testid="board-split-review-close"
              onClick={onClose}
              aria-label="关闭"
              className="text-text-3 hover:text-text-1 text-lg leading-none"
            >
              ✕
            </button>
          </header>

          {cards.length === 0 ? (
            <div className="text-sm text-text-3 py-8 text-center">
              没有候选卡片(Run 未产生 cards.yaml)
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-auto">
              {cards.map((proposal, idx) => {
                const checked = effectiveSelected.has(idx)
                const priorityVal =
                  priorityOverrides[idx] ??
                  (proposal.suggested_priority ?? 'none')
                return (
                  <div
                    key={`${proposal.tool_use_id}-${idx}`}
                    data-testid="board-split-review-card"
                    data-ordinal={proposal.ordinal}
                    className={`flex flex-col gap-2 p-3 border rounded-md ${
                      checked ? 'border-brand/40 bg-brand-50/30' : 'border-border bg-bg-elevated'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelect(idx)}
                        data-testid={`board-split-review-check-${idx}`}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-1">
                          {proposal.title}
                        </div>
                        {proposal.content && (
                          <div className="text-xs text-text-2 mt-1 line-clamp-2">
                            {proposal.content.slice(0, 120)}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] text-text-3 uppercase">
                            suggested
                          </span>
                          <select
                            data-testid={`board-split-review-priority-${idx}`}
                            value={priorityVal}
                            onChange={(e) =>
                              setPriorityOverrides((prev) => ({
                                ...prev,
                                [idx]: e.target.value as TaskCardPriorityT | 'none',
                              }))
                            }
                            className="px-1.5 py-0.5 text-xs border border-border-strong rounded-sm bg-bg text-text-1"
                          >
                            {PRIORITY_OPTIONS.map((p) => (
                              <option key={p} value={p}>
                                {p === 'none' ? '无' : p}
                              </option>
                            ))}
                          </select>
                          {proposal.labels.length > 0 && (
                            <span className="text-[10px] text-text-3">
                              {proposal.labels.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 操作 */}
          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="board-split-review-cancel"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="board-split-review-confirm-all"
              onClick={() => void handleConfirmAll()}
              disabled={cards.length === 0 || landMutation.isPending}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {landMutation.isPending ? '落盘中…' : `全部确认(${effectiveSelected.size})`}
            </button>
          </footer>
        </div>
      </div>
    </div>
  )
}
