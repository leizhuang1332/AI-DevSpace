'use client'

/**
 * board — SplitFromPrdModal(issue 08 / ADR-0027 D4)
 *
 * 触发点:BoardToolbar `[+ 从 PRD 拆]` 按钮(issue 07 disabled,本期接通)。
 *
 * 表单:
 * - 粒度 radio:粗 / 中 / 细(默认 中)
 * - 期望卡片数 number(默认 5)+「推荐」按钮(设 5)
 * - 上下文 checkbox(PRD / 关联仓库)
 *
 * 提交 → useStartPrdSplit → POST /split-from-prd → 201 {run_id} → onSuccess(runId)
 * (轮询 + 建议卡片组按钮在 PrdSplitResultBanner)
 *
 * 守门(ADR-0023 zero-touch):不触达 Provider;Run 走父 analyzing transcript。
 */

import { useState, useEffect } from 'react'
import type { PrdSplitGranularityT } from '@ai-devspace/shared'
import { useStartPrdSplit } from '@/lib/board-detail-hooks'

export interface SplitFromPrdModalProps {
  requirementId: string
  open: boolean
  onClose: () => void
  /** Run 启动成功(run_id)→ BoardSection 显示 banner 轮询 */
  onSuccess: (runId: string) => void
}

const GRANULARITY_OPTIONS: Array<{ value: PrdSplitGranularityT; label: string }> = [
  { value: '粗', label: '粗(少卡片,大模块)' },
  { value: '中', label: '中(中等粒度)' },
  { value: '细', label: '细(多卡片,单功能点)' },
]

const CONTEXT_OPTIONS = [
  { value: 'prd', label: 'PRD(requirement.md)' },
  { value: 'repos', label: '关联仓库' },
] as const

export function SplitFromPrdModal({
  requirementId,
  open,
  onClose,
  onSuccess,
}: SplitFromPrdModalProps) {
  const startMutation = useStartPrdSplit(requirementId)
  const [granularity, setGranularity] = useState<PrdSplitGranularityT>('中')
  const [expectedCount, setExpectedCount] = useState(5)
  const [useContext, setUseContext] = useState<string[]>(['prd'])

  // 每次打开重置表单
  useEffect(() => {
    if (open) {
      setGranularity('中')
      setExpectedCount(5)
      setUseContext(['prd'])
    }
  }, [open])

  if (!open) return null

  const canSubmit = !startMutation.isPending && expectedCount >= 1 && expectedCount <= 50

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    startMutation.mutate(
      {
        granularity,
        expected_count: expectedCount,
        use_context: useContext,
      },
      {
        onSuccess: (res) => {
          onSuccess(res.run_id)
        },
      },
    )
  }

  const toggleContext = (value: string) => {
    setUseContext((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  return (
    <div
      data-testid="board-split-from-prd-modal"
      data-open={open ? 'true' : 'false'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        data-testid="board-split-from-prd-modal-panel"
        className="bg-bg-elevated border border-border rounded-lg shadow-lg w-full max-w-[480px] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={handleSubmit} className="flex flex-col p-5 gap-4">
          <header className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-1">从 PRD 拆为卡片</h2>
            <button
              type="button"
              data-testid="board-split-from-prd-close"
              onClick={onClose}
              aria-label="关闭"
              className="text-text-3 hover:text-text-1 text-lg leading-none"
            >
              ✕
            </button>
          </header>

          {/* 粒度 */}
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-2">拆分粒度</span>
            <div className="flex gap-2">
              {GRANULARITY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  data-testid={`board-split-granularity-${opt.value}`}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm cursor-pointer border ${
                    granularity === opt.value
                      ? 'bg-brand-50 text-brand-600 font-medium border-brand'
                      : 'bg-bg-elevated text-text-2 border-border'
                  }`}
                >
                  <input
                    type="radio"
                    name="granularity"
                    value={opt.value}
                    checked={granularity === opt.value}
                    onChange={() => setGranularity(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 期望卡片数 */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-2">期望卡片数</span>
              <button
                type="button"
                data-testid="board-split-recommend"
                onClick={() => setExpectedCount(5)}
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                推荐
              </button>
            </div>
            <input
              type="number"
              data-testid="board-split-expected-count"
              value={expectedCount}
              min={1}
              max={50}
              onChange={(e) => setExpectedCount(Number(e.target.value))}
              className="px-3 py-2 text-sm border border-border-strong rounded-md bg-bg text-text-1 focus:outline-none focus:border-brand w-24"
            />
          </div>

          {/* 上下文 */}
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-2">限定上下文</span>
            <div className="flex flex-col gap-2">
              {CONTEXT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  data-testid={`board-split-context-${opt.value}`}
                  className="flex items-center gap-2 text-sm text-text-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={useContext.includes(opt.value)}
                    onChange={() => toggleContext(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* 错误提示 */}
          {startMutation.isError && (
            <div className="text-sm text-error bg-error/10 px-3 py-2 rounded-md">
              拆分启动失败:{String(startMutation.error ?? '未知错误')}
            </div>
          )}

          {/* 操作 */}
          <footer className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              data-testid="board-split-cancel"
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
            >
              取消
            </button>
            <button
              type="submit"
              data-testid="board-split-submit"
              disabled={!canSubmit}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-brand text-white border border-brand hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {startMutation.isPending ? '启动中…' : '开始拆分 →'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
