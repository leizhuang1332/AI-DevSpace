'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AuxFile } from '@ai-devspace/shared'
import { AUX_USAGE_META } from '@/lib/aux-meta'
import { formatRelativeTime } from '@/lib/format'
import { useMarkdownPreviewToggle } from '@/lib/use-markdown-preview-toggle'
import { MarkdownPreview } from './markdown-preview'

/**
 * 辅助文件抽屉(issue 05)
 *
 * 视觉对照基线:`docs/design/pages/19c-2b-drawer.html` 的 `.backdrop` + `.drawer` 区域;
 * 同时与 `19-final-drafting.html` 的对应实装形态保持一致。
 *
 * 布局:
 * ┌──────────────────────────────────────────────────────────────┐
 * │  ← ─────────────────── 半透明遮罩 ────────────────────── → │  ← backdrop(translucent)
 * │  ┌────────────── 占 60% 宽度 · max 880px / min 520px ─────┐│
 * │  │ 🗂 面包屑: 需求 / 退款功能优化 / 辅助文件 / filename   ││  ← drawer head
 * │  │                                  已保存 · x 秒前 [✕ 关闭]││
 * │  ├────────────────────────────────────────────────────────┤│
 * │  │ 📐 filename                                             ││  ← drawer pane head
 * │  │ 辅助文件 · Markdown · 184 chars · ↻ 已转 MD   [👁 预览] ││
 * │  ├────────────────────────────────────────────────────────┤│
 * │  │ B I H1 · xxxx chars                                    ││  ← editor toolbar
 * │  ├────────────────────────────────────────────────────────┤│
 * │  │ # markdown 内容 …                                       ││  ← markdown textarea
 * │  └────────────────────────────────────────────────────────┘│
 * │                                                             │
 * └─────────────────────────────────────────────────────────────┘
 *
 * 行为契约:
 * - 受控打开:`openAuxId === null` 时完全不渲染 DOM(不留隐藏节点)
 * - 唯一抽屉:同时只能打开一个 aux file — 切换文件由外部改 `openAuxId` 驱动
 * - 关闭路径(backdrop click / ✕ button / Escape):统一 `onClose()`
 * - 编辑 → `onBodyChange(id, newBody)`(由父组件维护 auxBodies,跨抽屉生命周期持久)
 * - 自动保存:与 PRD 编辑器同 30s 周期(issue 02 验收 #4);仅在内容非空时 tick
 * - 焦点管理:打开 → 焦点移到关闭按钮(键盘可达 + 可立即 Escape);
 *   关闭 → 焦点还原到打开抽屉前的元素(防止焦点丢失)
 * - aria-label:既给 dialog 显式 `aria-label`,又 `aria-labelledby` 指向
 *   可见的 filename heading(双保险:屏幕阅读器总能拿到文件名)
 *
 * 不在本组件范围:
 * - 抽屉的内容由父组件(DraftingZone)驱动(`openAuxId` + `auxBodies`)
 * - 抽屉的最大/最小宽度边界由 inline style 显式控制(避免外部样式不稳定)
 * - "上传替换"按钮(后续 ticket 引入,本期仅留占位)
 */

export interface AuxDrawerProps {
  /** 当前打开的 aux 文件 id;null = 抽屉完全关闭 */
  openAuxId: string | null
  /** 完整的辅助文件列表;用于 id → AuxFile 解析;找不到则抽屉不渲染 */
  auxFiles: AuxFile[]
  /**
   * 每文件已编辑内容(跨抽屉生命周期持久);父组件负责写入。
   * - 形如 `{ [fileId]: body }`
   * - 缺省时回退到该文件的 `AuxFile.body`
   * - 切换文件时,父组件不需要清空:drawer 自动从 map 里取新文件的内容
   *
   * 名称约定:与父组件(DraftingZone)的 `auxBodies` 同一对象,只是
   * 站在组件边界看是 incoming prop。换名字反而割裂追踪。
   */
  auxBodies: Record<string, string>
  /** 关闭回调(backdrop / ✕ / Escape 触发时调用) */
  onClose: () => void
  /** 编辑回调 — 携带文件 id 与最新文本;父组件把它写回 auxBodies */
  onBodyChange: (auxId: string, newBody: string) => void
  /** 自动保存周期(毫秒);与 PRD 一致,默认 30s */
  autosaveIntervalMs: number
  /**
   * 点击预览中解析成功的辅助文件链接 → 切换抽屉到目标文件(issue 07)
   * 单抽屉语义由父组件的 openAuxId 单一值保证 — 传同 id = no-op,
   * 传新 id = 切换(验收 #7)。
   */
  onAuxLinkClick?: (target: AuxFile) => void
}

// ---------------------------------------------------------------------------
// 视觉常量(对应 .backdrop / .drawer)
// ---------------------------------------------------------------------------

/** 占 workbench 宽度的比例 — 验收 #2 规定 "约 60%" */
const DRAWER_WIDTH_PCT = '60%'
/** 最小宽度:屏幕极窄时也至少保留 520px(设计稿 `.drawer { min-width: 520px }`) */
const DRAWER_MIN_WIDTH_PX = 520
/** 最大宽度:避免抽屉在大屏过度覆盖 PRD(设计稿 `.drawer { max-width: 880px }`) */
const DRAWER_MAX_WIDTH_PX = 880

// ===========================================================================
// 组件
// ===========================================================================

export function AuxDrawer({
  openAuxId,
  auxFiles,
  auxBodies,
  onClose,
  onBodyChange,
  autosaveIntervalMs,
  onAuxLinkClick,
}: AuxDrawerProps) {
  // -------------------------------------------------------------------------
  // 受控:openAuxId → 当前文件
  // -------------------------------------------------------------------------

  /** 当前打开的 AuxFile;openAuxId === null 或找不到对应文件 → 返回 null */
  const currentFile = useMemo(() => {
    if (!openAuxId) return null
    return auxFiles.find((f) => f.id === openAuxId) ?? null
  }, [openAuxId, auxFiles])

  /** 当前显示文本:auxBodies 优先,否则 fallback 到 auxFile.body */
  const initialBody = useMemo(() => {
    if (!currentFile) return ''
    if (Object.prototype.hasOwnProperty.call(auxBodies, currentFile.id)) {
      return auxBodies[currentFile.id] ?? ''
    }
    return currentFile.body
  }, [currentFile, auxBodies])

  // -------------------------------------------------------------------------
  // 受控:textarea 内容 — 切文件时重置 body state
  //
  // 这里有意保持 textarea 是 uncontrolled-from-outside 的:
  // - 父组件持有 `auxBodies` 跨抽屉生命周期持久的权威值
  // - 子组件的 `body` state 在文件 id 改变时一次性同步
  // - 同文件内编辑时,onChange 走 `onBodyChange(id, body)` 通知父组件同步持久
  //   (复用了 hasOwnProperty 判断,只在父组件主动写过该文件时才走持久层)
  //
  // eslint-disable 必要:initialBody 会随 auxFiles 引用变化而变,
  // 但我们只想在 id 改变时重置一次(后续编辑不该被 initialBody 反向覆盖)。
  // -------------------------------------------------------------------------

  const [body, setBody] = useState<string>('')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const currentFileIdRef = useRef<string | null>(null)

  // -------------------------------------------------------------------------
  // 预览模式(issue 07)
  // - true  → MarkdownPreview 渲染(标题 / 段落 / 列表 / 代码块 / 链接)
  // - false → 原始 textarea 编辑器(issue 05 行为)
  // - 状态由 useMarkdownPreviewToggle 集中管(与 PRD 顶置共享同一 hook)
  // - 切换文件时不重置预览开关:hook 持有自身的 useState,不绑定 currentFile,
  //   文件切换触发的 re-render 不会重置 isPreview
  // -------------------------------------------------------------------------
  const previewToggle = useMarkdownPreviewToggle({
    testId: 'aux-drawer-toggle-preview',
  })
  const isPreview = previewToggle.isPreview

  useEffect(() => {
    const nextId = currentFile?.id ?? null
    if (nextId !== currentFileIdRef.current) {
      currentFileIdRef.current = nextId
      setBody(initialBody)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFile?.id])

  // -------------------------------------------------------------------------
  // 焦点管理(issue 05 验收 #5 dialog 语义 的可访问性补强)
  // - 抽屉打开 → 焦点移到关闭按钮(键盘 Tab 的第一站,可立即 Escape)
  // - 抽屉关闭 → 焦点还原到打开前的元素(避免焦点丢到 <body>)
  //
  // 用 useLayoutEffect 而不是 useEffect:DOM 引用(refs)在 commit 阶段已
  // 绑定好,useLayoutEffect 在 paint 之前同步触发,避免 setTimeout 异步
  // 抖动(测试也更好写)。
  // -------------------------------------------------------------------------
  const closeBtnRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  // 拆成两个 effect:focus 与 focus-restore 必须分开,因为前者依赖
  // mount 后的 commit 时机,后者依赖卸载时机。
  useEffect(() => {
    // mount 时记录之前的焦点元素(用于关闭后还原)
    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null
  }, [])

  useEffect(() => {
    if (currentFile) {
      // open → 把焦点打到关闭按钮
      closeBtnRef.current?.focus()
    } else {
      // close → 还原到打开前的焦点
      const prev = previouslyFocusedRef.current
      if (prev && typeof prev.focus === 'function') {
        prev.focus({ preventScroll: true })
      }
    }
  }, [currentFile])

  // -------------------------------------------------------------------------
  // Escape 全局监听(只 draw 打开时挂)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!currentFile) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentFile, onClose])

  // -------------------------------------------------------------------------
  // 自动保存 — 与 PRD 同周期(30s mock);仅在内容非空时 tick
  // -------------------------------------------------------------------------
  const saveBody = useCallback(() => {
    setLastSavedAt(new Date().toISOString())
  }, [])

  useEffect(() => {
    if (!currentFile) return
    if (autosaveIntervalMs <= 0) return
    const id = window.setInterval(() => {
      // 仅在 textarea 有内容时 tick(对齐 PRD 编辑器的抑制策略,
      // 验收:clearing all content suppresses the autosave tick)
      if (body.trim()) saveBody()
    }, autosaveIntervalMs)
    return () => window.clearInterval(id)
  }, [currentFile, autosaveIntervalMs, body, saveBody])

  // -------------------------------------------------------------------------
  // 编辑事件 → 通知外部 + 本地 state
  // -------------------------------------------------------------------------
  const handleBodyChange = useCallback(
    (newBody: string) => {
      setBody(newBody)
      if (currentFile) onBodyChange(currentFile.id, newBody)
    },
    [currentFile, onBodyChange],
  )

  // -------------------------------------------------------------------------
  // 关闭路径
  // -------------------------------------------------------------------------
  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleBackdropClick = useCallback(() => {
    // backdrop 与 drawer 是 sibling;用户点 backdrop 即视为关闭
    handleClose()
  }, [handleClose])

  // -------------------------------------------------------------------------
  // 渲染条件
  // -------------------------------------------------------------------------
  if (!currentFile) return null

  const file = currentFile
  const icon = AUX_USAGE_META[file.usage_tag].icon
  // aria-label:"编辑辅助文件 {filename}" —— 兜底,确保屏幕阅读器
  // 即使 aria-labelledby 失败也能拿到语义
  const dialogLabel = `编辑辅助文件 ${file.filename}`
  // id for aria-labelledby —— 取稳定 hash 形式(file id 已是稳定串)
  const headingId = `aux-drawer-heading-${file.id}`

  return (
    <>
      {/* 半透明遮罩 — 点击关闭;放在 drawer 之前以确保 DOM 顺序中 backdrop 先 paint */}
      <div
        data-testid="aux-drawer-backdrop"
        onClick={handleBackdropClick}
        className="fixed inset-0 bg-[rgba(15,23,42,0.4)] backdrop-blur-sm z-[200] animate-[fadeIn_0.2s_ease]"
      />

      {/* 抽屉本体 —— 固定右侧 */}
      <aside
        data-testid="aux-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={dialogLabel}
        aria-labelledby={headingId}
        style={{
          width: DRAWER_WIDTH_PCT,
          minWidth: DRAWER_MIN_WIDTH_PX,
          maxWidth: DRAWER_MAX_WIDTH_PX,
        }}
        className={[
          'fixed top-0 right-0 bottom-0 z-[201]',
          'bg-bg border-l border-border',
          'flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.1)]',
          'animate-[slideInRight_0.28s_cubic-bezier(0.22,1,0.36,1)]',
        ].join(' ')}
      >
        {/* ===== drawer head ===== */}
        <header
          data-testid="aux-drawer-head"
          className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-bg-elevated flex-shrink-0"
        >
          {/* 面包屑 + saved 状态 */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span aria-hidden className="text-sm">
              {icon}
            </span>
            <span
              id={headingId}
              data-testid="aux-drawer-head-filename"
              className="font-semibold text-md text-text-1 truncate"
            >
              {file.filename}
            </span>
            {lastSavedAt && (
              <span
                data-testid="aux-drawer-autosaved"
                data-saved-at={lastSavedAt}
                className="text-xs text-text-3 font-mono ml-2"
              >
                已保存 · {formatRelativeTime(lastSavedAt)}
              </span>
            )}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            data-testid="aux-drawer-close"
            aria-label="关闭辅助文件抽屉"
            onClick={handleClose}
            className={[
              'inline-flex items-center justify-center h-7 px-3 rounded-md',
              'bg-bg-subtle text-text-2 text-xs font-medium border border-border-strong',
              'hover:bg-bg-elevated hover:text-text-1',
              'focus:outline-none focus:ring-2 focus:ring-brand-50',
            ].join(' ')}
          >
            ✕ 关闭
          </button>
        </header>

        {/* ===== drawer body ===== */}
        <div
          data-testid="aux-drawer-body"
          className="flex-1 flex flex-col p-5 overflow-hidden min-h-0"
        >
          <div
            data-testid="aux-drawer-pane"
            className="bg-bg-elevated border border-border rounded-xl shadow-md flex-1 flex flex-col overflow-hidden min-h-0"
          >
            {/* pane head — icon / filename / meta 行 */}
            <div
              data-testid="aux-drawer-pane-head"
              className="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  data-testid="aux-drawer-icon"
                  aria-hidden
                  className="text-xl"
                >
                  {icon}
                </span>
                <div className="min-w-0">
                  <div
                    data-testid="aux-drawer-filename"
                    className="font-bold text-md text-text-1 truncate"
                  >
                    {file.filename}
                  </div>
                  <div
                    data-testid="aux-drawer-meta"
                    className="text-xs text-text-3 mt-0.5"
                  >
                    辅助文件 ·{' '}
                    <span data-testid="aux-drawer-source-format">
                      {file.source_format}
                    </span>{' '}
                    · {body.length} chars
                    {file.converted_to_md && (
                      <>
                        {' · '}
                        <span className="text-success">↻ 已转 MD</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              {/* 后续 ticket 接入"上传替换"按钮;本期预留 actions slot */}
              <div
                data-testid="aux-drawer-actions"
                className="flex items-center gap-1.5"
              >
                {/* placeholder for upload / preview actions (later ticket) */}
              </div>
            </div>

            {/* ===== editor ===== */}
            <div
              data-testid="aux-drawer-editor-wrap"
              data-preview-mode={previewToggle.modeAttr}
              className="flex-1 flex flex-col min-h-0"
            >
              {/* editor toolbar — 与 PRD 编辑器一致的格式符号 */}
              <div
                data-testid="aux-drawer-editor-toolbar"
                className="flex items-center gap-3 px-3 py-1.5 bg-bg-subtle border-b border-border text-sm text-text-3 flex-shrink-0"
              >
                <b>B</b>
                <b>
                  <i>I</i>
                </b>
                <b>H1</b>
                <b>&lt;/&gt;</b>
                <span>· 列表</span>
                <span className="ml-auto font-mono text-xs flex items-center gap-3">
                  {/* issue 07:👁 预览 / ✏ 编辑 切换按钮(共享 useMarkdownPreviewToggle) */}
                  <button {...previewToggle.buttonProps}>
                    {previewToggle.label}
                  </button>
                  <span
                    data-testid="aux-drawer-editor-chars"
                    data-chars={body.length}
                  >
                    {body.length} chars
                  </span>
                </span>
              </div>
              {isPreview ? (
                <div
                  data-testid="aux-drawer-preview"
                  className="flex-1 overflow-auto p-4 bg-bg-elevated"
                >
                  <MarkdownPreview
                    markdown={body}
                    currentFile={file.filename}
                    auxFiles={auxFiles}
                    onAuxLinkClick={onAuxLinkClick}
                  />
                </div>
              ) : (
                <textarea
                  data-testid="aux-drawer-editor"
                  aria-label={`编辑 ${file.filename} 内容`}
                  value={body}
                  onChange={(e) => handleBodyChange(e.target.value)}
                  spellCheck={false}
                  placeholder={`# ${file.filename}\n\n<!-- 在这里编辑该辅助文件内容 -->`}
                  className="w-full flex-1 min-h-[260px] border-none p-3 font-mono text-sm leading-relaxed text-text-1 bg-bg-elevated resize-none focus:outline-none"
                />
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
