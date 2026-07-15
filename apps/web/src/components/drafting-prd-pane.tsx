'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { generatePrdSkeleton } from '@ai-devspace/shared'
import type { AuxFile, DraftingData } from '@/lib/drafting'
import { formatRelativeTime } from '@/lib/format'
import { useMarkdownPreviewToggle } from '@/lib/use-markdown-preview-toggle'
import { PrdAnchorBar } from './prd-anchor-bar'
import { MarkdownPreview } from './markdown-preview'

/**
 * DRAFTING 工位的 PRD 顶置面板(issue 02 · 已扩展 issue 03 锚点条 / issue 07 预览 /
 * issue 08 启动按钮下沉到 RepoBar)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 08 形态 — PRD 卡片不再含底部动作):
 * ┌──────────────────────────────────────────────────┐
 * │ PRD · 主文档              已保存 · x 秒前          │
 * ├──────────────────────────────────────────────────┤
 * │ 标题 input                                       │
 * │ PRD Markdown                                     │
 * │ ┌─ anchor-bar ─────────────────────────────────┐ │
 * │ │ 大纲 ▾ H1 退款 ... H2 背景 ... H2 目标 ...     │ │
 * │ ├─ ed-toolbar ─────────────────────────────────┤ │
 * │ │ B I H1 · 👁预览 · xxxx chars                  │ │
 * │ ├──────────────────────────────────────────────┤ │
 * │ │ # PRD Markdown 编辑区 (textarea / 预览)        │ │
 * │ └──────────────────────────────────────────────┘ │
 * └──────────────────────────────────────────────────┘
 *
 * 设计要点(issue 08 之后):
 * - **受控组件**:title / prdMarkdown 由父组件(DraftingZone)持有,本组件接收
 *   props 并通过 onChange 回调回写。父组件需要这两个值来计算 launch validity
 *   并在 RepoBar 上渲染启动按钮。
 * - 骨架自动填充:data.empty + prdMarkdown 为空 → mount 时一次性调用
 *   onPrdMarkdownChange(generatePrdSkeleton(title)) 回写父 state(保留"作者从
 *   空白开始"的语义,同时让新需求一键看到骨架)
 * - 自动保存:setInterval 周期写入(本期 mock:仅更新 UI 时间戳)
 * - 启动校验:虽然 validity 由父组件用 `validateLaunch` 计算,但本组件也会保留
 *   `data-empty` 等渲染分支需要的 state;具体 launch action 已迁到 RepoBar
 * - PRD 锚点条(issue 03):mount 在 PRD Markdown 编辑器之上;点击回调 →
 *   prdTextareaRef 把 selectionStart/End 移到目标行,并按行号推算 scrollTop
 *
 * 不在本组件范围:
 * - 启动按钮(issue 08)→ 已迁到 RepoBar 的 "▶ 进入 ANALYZING"
 * - 仓库软警告(issue 08)→ RepoBar
 * - 预览模式(issue 07)→ 本组件渲染
 */
export interface DraftingPrdPaneProps {
  data: DraftingData
  /** 受控:title 值(由父组件持有,本组件回写) */
  title: string
  /** 受控:prdMarkdown 值(由父组件持有,本组件回写) */
  prdMarkdown: string
  /** title 受控 onChange */
  onTitleChange: (next: string) => void
  /** prdMarkdown 受控 onChange */
  onPrdMarkdownChange: (next: string) => void
  /**
   * 命令式句柄 —— 父组件(DraftingZone)在 launch ANALYZING 之前调用
   * `handle.current?.saveNow()` 触发一次"立即落盘",保证下游工位拿到最新内容。
   *
   * 设计理由:本组件内部维护 lastSavedAt(用于 "已保存 · x 秒前" 显示),
   * 父组件不持有该 state;通过 ref 暴露"立刻保存一次"的能力,而非
   * 把 lastSavedAt 上提,避免无关的 state 上升。
   */
  handle?: React.MutableRefObject<DraftingPrdPaneHandle | null>
  /**
   * 点击预览中解析成功的辅助文件链接 → 打开/切换抽屉
   * (issue 07 验收 #2 #7;Drawer 单文件语义天然保证 "switch drawer")
   */
  onAuxLinkClick?: (target: AuxFile) => void
}

/** 父组件可通过 ref 调用的命令式句柄(issue 02/08 兼容) */
export interface DraftingPrdPaneHandle {
  /** 立即触发一次保存(更新 lastSavedAt 时间戳) */
  saveNow: () => void
}

export function DraftingPrdPane({
  data,
  title,
  prdMarkdown,
  onTitleChange,
  onPrdMarkdownChange,
  handle,
  onAuxLinkClick,
}: DraftingPrdPaneProps) {
  // -------------------------------------------------------------------------
  // 受控状态 —— 父组件持有,本组件只读取并触发 onChange
  // -------------------------------------------------------------------------
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(data.lastSavedAt)

  // -------------------------------------------------------------------------
  // 预览模式开关(issue 07)
  // - true  → MarkdownPreview 渲染(标题 / 段落 / 列表 / 代码块 / 链接)
  // - false → 原始 textarea 编辑器(issue 02/03 行为)
  // - 状态由 useMarkdownPreviewToggle 集中管,与 aux-drawer 共用同一 hook
  //   避免两份相同 toggle 逻辑漂移
  // -------------------------------------------------------------------------
  const previewToggle = useMarkdownPreviewToggle({
    testId: 'drafting-prd-toggle-preview',
  })
  const isPreview = previewToggle.isPreview

  // -------------------------------------------------------------------------
  // PRD textarea ref —— issue 03 锚点条点击时用于滚动定位 / 移动光标
  // -------------------------------------------------------------------------
  const prdTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  /**
   * 处理锚点条点击:把光标定位到目标行(line)开头的字符偏移,并按 textarea
   * 行高滚动 scrollTop,使目标行进入可视区。
   *
   * - selectionStart/selectionEnd 设为 charOffset → 用户立即看到光标
   * - scrollTop 推到 "第 line 行的行顶位置" — 不足以暴露到行底(留 buffer)
   *
   * 计算行顶字符偏移:把 markdown 按 \n 拆分,前 line 行(0-based 不含目标行)
   * 的总字符数就是目标行起始位置(line 0 的 #标题 总是 charOffset=0)。
   */
  const handleJumpToLine = useCallback(
    (line: number) => {
      const ta = prdTextareaRef.current
      if (!ta) return
      const lines = prdMarkdown.split(/\r?\n/)
      const safeLine = Math.max(0, Math.min(line, lines.length - 1))
      let charOffset = 0
      for (let i = 0; i < safeLine; i++) charOffset += lines[i].length + 1
      ta.focus({ preventScroll: true })
      ta.setSelectionRange(charOffset, charOffset)
      // 按行号 × 单行像素推算 scrollTop(行高取 textarea 计算样式,失败回退 20)
      const lineHeight =
        parseFloat(getComputedStyle(ta).lineHeight) ||
        ta.scrollHeight / Math.max(lines.length, 1)
      ta.scrollTop = Math.max(0, safeLine * lineHeight - lineHeight * 2)
    },
    [prdMarkdown],
  )

  // -------------------------------------------------------------------------
  // 骨架自动填充 —— 仅在首次 mount 时触发,且要求 empty + PRD 为空
  // (有保存内容的数据直接使用,绝不覆盖;空数据触发 generatePrdSkeleton)
  // 走 onPrdMarkdownChange 回写父 state,避免本组件再额外持一份"内部副本"
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (data.empty && !data.prdMarkdown && !prdMarkdown) {
      onPrdMarkdownChange(generatePrdSkeleton(data.title || title))
    }
    // 仅在 mount 时执行一次;后续 title 变化不再次填充
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // 自动保存(每 N ms;本期只更新 UI 时间戳,mock 写)
  // -------------------------------------------------------------------------
  const saveDraft = useCallback(() => {
    setLastSavedAt(new Date().toISOString())
  }, [])

  useEffect(() => {
    const intervalMs = data.autosaveIntervalMs
    if (intervalMs <= 0) return
    const id = window.setInterval(() => {
      // 仅在表单有内容时才自动保存;全空时静默不写(验收:clearing all content
      // suppresses the autosave tick)
      if (title.trim() || prdMarkdown.trim()) {
        saveDraft()
      }
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [data.autosaveIntervalMs, title, prdMarkdown, saveDraft])

  // 父组件触发的"立刻保存一次"通道 —— 通过 ref 句柄暴露。
  // 父组件在 launch ANALYZING 之前调用 handle.current?.saveNow() 即可。
  useEffect(() => {
    if (!handle) return
    const api: DraftingPrdPaneHandle = {
      saveNow: () => {
        // 与 interval 触发的 saveDraft 等价(更新 lastSavedAt 时间戳)
        saveDraftRef.current()
      },
    }
    handle.current = api
    return () => {
      // 卸载时清空,避免 stale ref 指向不存在的组件
      if (handle.current === api) {
        handle.current = null
      }
    }
  }, [handle])

  // saveDraft 的 ref —— 避免 useEffect 依赖变化导致 stale closure
  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  return (
    <section
      data-testid="drafting-prd-pane"
      data-requirement-id={data.requirementId}
      data-empty={data.empty ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg"
    >
      {/* PRD 卡片 */}
      <div
        data-testid="drafting-prd-card"
        className="flex flex-col flex-1 bg-bg-elevated border border-border rounded-xl shadow-md overflow-hidden"
      >
        {/* 卡片头 */}
        <header
          data-testid="drafting-prd-head"
          className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0"
        >
          <div className="flex items-center gap-2">
            <span
              data-testid="drafting-prd-badge"
              className="inline-block bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded leading-tight tracking-wider"
            >
              PRD
            </span>
            <span className="text-md font-bold">主文档</span>
            <span className="text-xs text-text-3 font-normal">
              — ANALYZING 首要消费对象 · 必填 · 不可删
            </span>
          </div>
          {lastSavedAt && (
            <span
              data-testid="drafting-autosaved"
              data-saved-at={lastSavedAt}
              className="text-xs text-text-3 font-mono"
            >
              已保存 · {formatRelativeTime(lastSavedAt)}
            </span>
          )}
        </header>

        {/* 卡片体:title + PRD 编辑器 */}
        <div
          data-testid="drafting-prd-body"
          className="flex-1 overflow-auto p-5 flex flex-col gap-4 min-h-0"
        >
          {/* 标题 */}
          <div data-testid="drafting-field" data-field-label="标题">
            <label className="block text-sm font-semibold text-text-2 mb-2">
              标题{' '}
              <span className="text-text-3 font-normal">
                (独立字段,与 PRD Markdown 分离)
              </span>
            </label>
            <input
              type="text"
              data-testid="drafting-title"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="一句话描述这个需求(如:退款功能优化)"
              className="w-full h-9 px-3 border border-border-strong rounded-md text-md bg-bg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-50"
            />
          </div>

          {/* PRD Markdown */}
          <div
            data-testid="drafting-field"
            data-field-label="PRD Markdown"
            className="flex-1 flex flex-col min-h-0"
          >
            <label className="block text-sm font-semibold text-text-2 mb-2">
              PRD Markdown
            </label>
            {/* PRD 锚点条 (issue 03) —— 挂载在编辑器之上,无 H1/H2 时不渲染 */}
            <PrdAnchorBar markdown={prdMarkdown} onJumpTo={handleJumpToLine} />
            <div
              data-testid="drafting-editor"
              data-preview-mode={previewToggle.modeAttr}
              className="border border-border-strong rounded-md rounded-tl-none rounded-tr-none overflow-hidden flex flex-col flex-1 min-h-0"
            >
              <div
                data-testid="drafting-editor-toolbar"
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
                    data-testid="drafting-markdown-chars"
                    data-chars={prdMarkdown.length}
                  >
                    {prdMarkdown.length} chars
                  </span>
                </span>
              </div>
              {isPreview ? (
                <div
                  data-testid="drafting-prd-preview"
                  className="flex-1 overflow-auto p-4 bg-bg-elevated"
                >
                  <MarkdownPreview
                    markdown={prdMarkdown}
                    currentFile="PRD.md"
                    auxFiles={data.auxFiles}
                    onAuxLinkClick={onAuxLinkClick}
                  />
                </div>
              ) : (
                <textarea
                  data-testid="drafting-prd"
                  ref={prdTextareaRef}
                  value={prdMarkdown}
                  onChange={(e) => onPrdMarkdownChange(e.target.value)}
                  placeholder={`# 需求标题\n\n## 背景\n...\n\n## 目标\n...\n\n## 验收标准\n- [ ] ...\n\n## 非目标\n...`}
                  className="w-full flex-1 min-h-[260px] border-none p-3 font-mono text-sm leading-relaxed text-text-1 bg-bg-elevated resize-none focus:outline-none"
                />
              )}
            </div>
          </div>
        </div>

        {/* issue 08:卡片脚移除;启动按钮已迁到 RepoBar */}
      </div>
    </section>
  )
}