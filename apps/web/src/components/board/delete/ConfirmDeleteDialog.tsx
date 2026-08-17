'use client'

/**
 * ConfirmDeleteDialog —— 物理删除二次确认(issue 03 / ADR-0036 D3)
 *
 * 触发链路:
 *   board 卡片菜单「删除任务」→ BoardSection.setConfirming(cardId) → 弹本组件
 *   用户输入 DELETE 字样(大小写敏感)→ onConfirm() 触发 mutation
 *   - 成功 → caller 关闭 dialog
 *   - 失败(E_CARD_HAS_BLOCKERS 等)→ 显示错误;409 通常走 BlockerModal 替代
 *
 * 设计要点(对照 ADR-0036 D3):
 * - 输入框 placeholder `输入 DELETE 确认`;未输入 → 确认按钮 disabled
 * - 输入其他字符 → 红框 + 错误文案(大小写敏感,防止 delete / Delete 走偏)
 * - 输入 `DELETE`(全大写,精确匹配)→ 确认按钮可点
 * - Esc:任意非 submitting 状态关闭
 * - Enter:仅 idle + 输入匹配时提交(防空)
 * - state: idle / submitting / error(回 idle + 错误占位)
 *
 * 范式参照:`components/analysis-history-drawer.tsx` `AnalysisDeleteRunDialog`
 * (同款 layout · warning + 错误占位 + 底部按钮);差异 = 加 input 校验。
 */

import { useCallback, useEffect, useState } from 'react'

export interface ConfirmDeleteDialogProps {
  /** 受控开关 */
  open: boolean
  /** 卡片完整标题,显示在警告区 */
  cardTitle: string
  /** 卡片 ULID 短哈希(末 4),用于展示「即将删除卡片 <id>」 */
  cardIdShort: string
  /**
   * Caller 提供的 mutation;resolve 表示成功(dialog 由 caller 关闭,unmount);
   * reject 表示失败(显示 error,不关闭)。
   */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

const REQUIRED_INPUT = 'DELETE'

export function ConfirmDeleteDialog({
  open,
  cardTitle,
  cardIdShort,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<'idle' | 'submitting'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // 重新打开 → 重置 input/phase/error
  useEffect(() => {
    if (open) {
      setInput('')
      setPhase('idle')
      setErrorMsg(null)
    }
  }, [open])

  const inputMatches = input === REQUIRED_INPUT

  const handleConfirm = useCallback(async (): Promise<void> => {
    if (!inputMatches || phase === 'submitting') return
    setPhase('submitting')
    setErrorMsg(null)
    try {
      await onConfirm()
      // 成功 → 由 caller 关闭 dialog(unmount);本地 input 自然随 unmount 清掉
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setPhase('idle')
    }
  }, [inputMatches, phase, onConfirm])

  // Esc / Enter 监听
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && phase !== 'submitting') {
        onCancel()
      } else if (e.key === 'Enter' && inputMatches && phase === 'idle') {
        void handleConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phase, inputMatches, onCancel, handleConfirm])

  if (!open) return null

  return (
    <div
      data-testid="confirm-delete-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="永久删除任务"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'submitting') onCancel()
      }}
    >
      <div
        data-testid="confirm-delete-dialog-content"
        className="bg-bg-elevated border border-border-strong rounded-lg shadow-xl w-[460px] max-w-[92vw] flex flex-col"
      >
        <header className="px-5 py-3 border-b border-border flex items-center gap-2">
          <span aria-hidden className="text-lg">⚠️</span>
          <h2 className="text-md font-semibold text-text-1">永久删除任务?</h2>
        </header>
        <div className="px-5 py-4 flex flex-col gap-3 text-sm text-text-1">
          <p>
            此操作不可恢复。任务{' '}
            <code
              data-testid="confirm-delete-dialog-id"
              className="px-1.5 py-0.5 rounded bg-bg-subtle text-xs font-mono"
            >
              {cardIdShort}
            </code>{' '}
            + 协作 transcript 将被一起删除。
          </p>
          <div
            data-testid="confirm-delete-dialog-warning"
            className="text-xs bg-warn/10 border border-warn/40 text-warn-700 rounded-md px-3 py-2 leading-relaxed"
          >
            ⚠ 卡片 <strong>{cardTitle}</strong> 永久消失。
            如有 blocker(子任务 / 依赖方),删除会被拒绝并显示列表。
          </div>
          <label className="text-xs text-text-3">
            输入 <code className="px-1 bg-bg-subtle font-mono">{REQUIRED_INPUT}</code> 以确认
            <input
              type="text"
              data-testid="confirm-delete-dialog-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入 DELETE 确认"
              autoFocus
              disabled={phase === 'submitting'}
              aria-invalid={input.length > 0 && !inputMatches}
              className="mt-1 w-full h-9 px-3 border border-border rounded-md text-sm font-mono outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 aria-[invalid=true]:border-error aria-[invalid=true]:ring-error/30"
            />
          </label>
          {input.length > 0 && !inputMatches && (
            <div
              data-testid="confirm-delete-dialog-input-error"
              className="text-xs text-error"
            >
              大小写敏感:必须输入 <code>{REQUIRED_INPUT}</code>(全大写)
            </div>
          )}
          {errorMsg && (
            <div
              data-testid="confirm-delete-dialog-error"
              role="alert"
              className="text-xs text-error bg-error/10 border border-error/40 rounded-md px-3 py-2"
            >
              删除失败:{errorMsg}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-delete-dialog-cancel"
            onClick={onCancel}
            disabled={phase === 'submitting'}
            className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="confirm-delete-dialog-confirm"
            onClick={handleConfirm}
            disabled={!inputMatches || phase === 'submitting'}
            className="h-8 px-3 rounded-md text-sm font-medium bg-error text-white hover:bg-error/90 disabled:opacity-50"
          >
            {phase === 'submitting' ? '删除中…' : '确认删除'}
          </button>
        </footer>
      </div>
    </div>
  )
}