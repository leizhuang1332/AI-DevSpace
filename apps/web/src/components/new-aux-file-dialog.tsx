'use client'

import { useEffect, useId, useRef, useState } from 'react'
import type { UsageTag } from '@ai-devspace/shared'
import { AUX_USAGE_META } from '@/lib/aux-meta'

/**
 * 新建辅助文件对话框(issue 06)
 *
 * 视觉对照基线:参考 `new-requirement-modal.tsx` 的 backdrop + 居中表单风格;
 * 同时与 `docs/design/pages/19-final-drafting.html` 的视觉一致性。
 *
 * 行为:
 * - 受控:`open === false` → 完全不渲染 DOM(避免 backdrop 残留)
 * - 提交(Enter / "创建"按钮):回调 `onSubmit({ filename, usage_tag })`
 * - 关闭路径:backdrop click / ✕ button / Escape / 取消按钮 → 调 `onClose()`
 * - 校验:filename trim 后非空 + 至少一个 usage_tag(默认 api)
 * - 文件名强制以 `.md` 结尾(upload 上来的也以 .md 存储;新增同理);
 *   用户输入无扩展名时自动补 `.md`
 * - 键盘可达:打开 → 焦点移到 filename input
 *
 * 不在本组件范围:实际创建文件(交给 DraftingZone 处理)。
 */

export interface NewAuxFileDialogProps {
  open: boolean
  /**
   * 上传同名文件导致冲突时,在 modal 顶部提示用户提供文件名。
   * 组件只负责视觉展示,不做冲突检测 —— 冲突检测在父组件中比较 filename。
   */
  errorMessage?: string | null
  /**
   * 提交:携带 trim 后的 filename(必含 .md 扩展名)与用户选择的 usage_tag
   */
  onSubmit: (value: { filename: string; usage_tag: UsageTag }) => void
  /** 关闭对话框 */
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * 6 种受控 UsageTag 的有序列表(issue 01 验收 #1 / issue 06 验收 #2)。
 * - 按"信息密度 / 重要度"排序:API 草案 / 数据字典 / SOP / 调研 / UI 草图 / 其他
 * - 顺序与设计稿 `19-final-drafting.html` 保持一致
 */
const USAGE_TAGS: UsageTag[] = [
  'api',
  'data',
  'research',
  'sop',
  'ui',
  'other',
]

/**
 * `其他` 默认对新用户不友好;优先落到 `api` —— 后续用户大多从接口写起,
 * 也方便设计稿的暗色 highlight。改动影响验收 #2 默认 tag。
 */
const DEFAULT_USAGE_TAG: UsageTag = 'api'

// ===========================================================================
// 组件
// ===========================================================================

export function NewAuxFileDialog({
  open,
  errorMessage,
  onSubmit,
  onClose,
}: NewAuxFileDialogProps) {
  const [filename, setFilename] = useState<string>('')
  const [usageTag, setUsageTag] = useState<UsageTag>(DEFAULT_USAGE_TAG)
  const filenameInputRef = useRef<HTMLInputElement | null>(null)
  const headingId = useId()

  // 打开时 reset + 移到焦点
  useEffect(() => {
    if (!open) return
    setFilename('')
    setUsageTag(DEFAULT_USAGE_TAG)
    // 等 commit 后再聚焦
    const id = window.setTimeout(() => {
      filenameInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [open])

  // Escape 关闭(open 时挂)
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const trimmedFilename = filename.trim()
  // 自动补 .md 扩展名,但用户已写则不重复添加
  const finalFilename =
    trimmedFilename.toLowerCase().endsWith('.md')
      ? trimmedFilename
      : `${trimmedFilename}.md`

  const canSubmit = trimmedFilename.length > 0

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onSubmit({ filename: finalFilename, usage_tag: usageTag })
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      data-testid="new-aux-dialog-backdrop"
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(15,23,42,0.4)] backdrop-blur-sm p-6 animate-[fadeIn_0.2s_ease]"
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        data-testid="new-aux-dialog"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative z-[301] w-[480px] max-w-[90vw] bg-bg-elevated rounded-xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Head */}
        <div
          data-testid="new-aux-dialog-head"
          className="flex items-center justify-between px-5 py-4 border-b border-border"
        >
          <h2
            id={headingId}
            data-testid="new-aux-dialog-title"
            className="text-md font-semibold flex items-center gap-2"
          >
            <span aria-hidden>📄</span>
            新建辅助文件
          </h2>
          <button
            type="button"
            onClick={onClose}
            title="关闭 (ESC)"
            aria-label="关闭"
            data-testid="new-aux-dialog-close"
            className="w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm flex items-center justify-center hover:bg-bg-elevated hover:text-text-1 focus:outline-none focus:ring-2 focus:ring-brand-50"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          data-testid="new-aux-dialog-body"
          className="px-5 py-5 flex flex-col gap-4"
        >
          {errorMessage && (
            <div
              data-testid="new-aux-dialog-error"
              role="alert"
              className="px-3 py-2 bg-warning-50 text-warning rounded-md text-xs"
            >
              {errorMessage}
            </div>
          )}

          {/* Filename */}
          <div>
            <label
              htmlFor="new-aux-filename"
              className="block text-sm font-medium text-text-1 mb-1.5"
            >
              文件名 <span className="text-error">*</span>
            </label>
            <input
              id="new-aux-filename"
              ref={filenameInputRef}
              type="text"
              data-testid="new-aux-dialog-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="如：refund-api.md"
              spellCheck={false}
              className="w-full px-3 h-9 bg-bg-subtle border border-border-strong rounded-md text-sm text-text-1 font-mono focus:outline-none focus:border-brand focus:bg-bg-elevated focus:shadow-[0_0_0_3px_var(--brand-50)]"
            />
            <div
              data-testid="new-aux-dialog-filename-preview"
              className="text-xs text-text-3 mt-1"
            >
              将保存为:<span className="font-mono">{finalFilename || '—'}</span>
            </div>
          </div>

          {/* Usage tag radio group */}
          <div>
            <label className="block text-sm font-medium text-text-1 mb-1.5">
              用途标签 <span className="text-error">*</span>
            </label>
            <div
              role="radiogroup"
              aria-label="用途标签"
              data-testid="new-aux-dialog-tags"
              className="grid grid-cols-3 gap-1.5"
            >
              {USAGE_TAGS.map((tag) => {
                const meta = AUX_USAGE_META[tag]
                const selected = tag === usageTag
                return (
                  <button
                    key={tag}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`new-aux-dialog-tag-${tag}`}
                    data-usage-tag={tag}
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => setUsageTag(tag)}
                    className={[
                      'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium border',
                      'transition-colors duration-100',
                      'focus:outline-none focus:ring-2 focus:ring-brand-50',
                      selected
                        ? 'border-brand bg-brand-50 text-brand-700'
                        : 'border-border-strong bg-bg text-text-2 hover:bg-bg-subtle hover:text-text-1',
                    ].join(' ')}
                  >
                    <span aria-hidden>{meta.icon}</span>
                    <span>{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Foot */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-bg-subtle">
          <span className="text-xs text-text-3">ESC 关闭 · 文件将立即出现在列表中</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="new-aux-dialog-cancel"
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium text-text-2 hover:text-text-1 focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              data-testid="new-aux-dialog-submit"
              className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-brand-50"
            >
              ✓ 创建
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
