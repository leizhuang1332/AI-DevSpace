'use client'

import { useCallback, useState } from 'react'

/**
 * 共享"Markdown 预览模式"开关 hook(issue 07)
 *
 * 抽离自 `drafting-prd-pane.tsx` 与 `aux-drawer.tsx` 中两份 byte-identical 的
 * "👁 预览 / ✏ 编辑"切换状态 + 按钮样式 + 切换回调。原本两处各自维护 `isPreview`
 * state 与 `setIsPreview((v) => !v)` 逻辑,本期抽到这里集中管:
 *
 *   const { isPreview, toggle, buttonProps, modeAttr } = useMarkdownPreviewToggle()
 *   …
 *   <button {...buttonProps} />
 *   <div data-preview-mode={modeAttr}> … </div>
 *   {isPreview ? <MarkdownPreview … /> : <textarea … />}
 *
 * 设计要点:
 * - 返回 `buttonProps` 而非 button 元素本身 —— 调用方决定放在哪个 toolbar
 *   (PRD 编辑器工具条 vs 抽屉编辑器工具条)、挂哪些 testid / aria-label
 * - 返回 `modeAttr` 字符串 `"true"|"false"` —— 直接塞到 `data-preview-mode`,
 *   与该 attr 在 PRD/抽屉里的用法对齐
 * - 不在 hook 内绑定 onAuxLinkClick 等回调 —— MarkdownPreview 由调用方自取
 *
 * 不在本 hook 范围:
 * - MarkdownPreview 渲染本身(由调用方控制)
 * - 状态重置规则(切文件不重置开关):由调用方决定 useState 是否要跟随 id 重置
 */

export interface UseMarkdownPreviewToggleResult {
  /** 当前是否处于预览模式 */
  isPreview: boolean
  /** 切换预览模式的回调 —— 直接绑到 button.onClick */
  toggle: () => void
  /** 复制到 toggle button 上的 props(testid / aria-pressed / onClick / className) */
  buttonProps: {
    type: 'button'
    'data-testid': string
    'data-active': 'true' | 'false'
    'aria-pressed': boolean
    onClick: () => void
    className: string
  }
  /** 复制到 wrapper 容器上的 `data-preview-mode` 值 */
  modeAttr: 'true' | 'false'
  /** 复制到按钮内的可见文本 —— 切换后内容会跟着翻面 */
  label: string
}

export interface UseMarkdownPreviewToggleOptions {
  /**
   * data-testid —— 调用方传入,以保证与原 PRD/抽屉 testid 命名一致
   * (默认 'markdown-preview-toggle',但实际场景多被 'drafting-prd-toggle-preview'
   *  / 'aux-drawer-toggle-preview' 替换)
   */
  testId?: string
  /** 初始是否预览(默认 false) */
  initial?: boolean
}

export function useMarkdownPreviewToggle(
  options: UseMarkdownPreviewToggleOptions = {},
): UseMarkdownPreviewToggleResult {
  const { testId = 'markdown-preview-toggle', initial = false } = options
  const [isPreview, setIsPreview] = useState<boolean>(initial)
  const toggle = useCallback(() => setIsPreview((v) => !v), [])

  const className = [
    'inline-flex items-center gap-1 h-[22px] px-2 rounded text-xs font-medium border',
    isPreview
      ? 'bg-brand text-white border-brand'
      : 'bg-bg-elevated text-text-2 border-border-strong hover:text-text-1',
  ].join(' ')

  return {
    isPreview,
    toggle,
    buttonProps: {
      type: 'button',
      'data-testid': testId,
      'data-active': isPreview ? 'true' : 'false',
      'aria-pressed': isPreview,
      onClick: toggle,
      className,
    },
    modeAttr: isPreview ? 'true' : 'false',
    label: isPreview ? '✏ 编辑' : '👁 预览',
  }
}