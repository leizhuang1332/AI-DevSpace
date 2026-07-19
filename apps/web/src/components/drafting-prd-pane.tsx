'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { generatePrdSkeleton } from '@ai-devspace/shared'
import type { AuxFile, DraftingData } from '@/lib/drafting'
import { formatRelativeTime } from '@/lib/format'
import { uploadAndReplace } from '@/lib/requirement-upload'
import { useMarkdownPreviewToggle } from '@/lib/use-markdown-preview-toggle'
import { PrdAnchorBar } from './prd-anchor-bar'
import { MarkdownPreview } from './markdown-preview'

/**
 * DRAFTING 工位的 PRD 顶置面板(issue 02 · 已扩展 issue 03 锚点条 / issue 07 预览 /
 * issue 08 启动按钮下沉到 RepoBar · issue 04 ticket 标题只读化)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 04 形态 — 标题只读 hero,不可编辑):
 * ┌──────────────────────────────────────────────────┐
 * │ PRD · 主文档              已保存 · x 秒前          │
 * ├──────────────────────────────────────────────────┤
 * │ [只读 hero] 大字号 标题 / 灰色副标题 "你在写这个需求"│
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
 * 设计要点(issue 08 + 04 之后):
 * - **标题只读**:标题由 NewRequirementModal 在新建需求时一次性写入
 *   `meta.yaml.title`,列表页 / 面包屑 / 本组件 hero 都读它。用户在 DRAFTING
 *   里改不动也无意义(改了与列表页脱节),所以本期不暴露编辑入口。
 * - **受控组件**:prdMarkdown 由父组件(DraftingZone)持有,本组件接收
 *   props 并通过 onChange 回调回写。父组件用 prdMarkdown 计算 launch validity
 *   并在 RepoBar 上渲染启动按钮。
 * - 骨架自动填充:data.empty + prdMarkdown 为空 → mount 时一次性调用
 *   onPrdMarkdownChange(generatePrdSkeleton(data.title)) 回写父 state(保留
 *   "作者从空白开始"的语义,同时让新需求一键看到骨架)
 * - 自动保存:setInterval 周期写入(本期 mock:仅更新 UI 时间戳)
 * - 启动校验:虽然 validity 由父组件用 `validateLaunch` 计算,但本组件也会保留
 *   `data-empty` 等渲染分支需要的 state;具体 launch action 已迁到 RepoBar
 * - PRD 锚点条(issue 03):mount 在 PRD Markdown 编辑器之上;点击回调 →
 *   prdTextareaRef 把 selectionStart/End 移到目标行,并按行号推算 scrollTop
 *
 * 不在本组件范围:
 * - 标题编辑(issue 04 ticket)→ 仅 hero 只读展示
 * - 启动按钮(issue 08)→ 已迁到 RepoBar 的 "▶ 进入 ANALYZING"
 * - 仓库软警告(issue 08)→ RepoBar
 * - 预览模式(issue 07)→ 本组件渲染
 */
export interface DraftingPrdPaneProps {
  data: DraftingData
  /** 受控:prdMarkdown 值(由父组件持有,本组件回写) */
  prdMarkdown: string
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

/**
 * ticket 03 (ADR-0015 D3 / D8) —— "上传新版本"流程的状态机。
 *
 * - `idle`         —— 默认态;用户可点按钮选文件
 * - `uploading`    —— 文件已选,正在闸门 + 服务端解析 + 写盘(按钮 disabled 防重复)
 * - `success`      —— 写盘成功 → 已用 `onPrdMarkdownChange` 覆盖父 state → 短暂高亮提示
 * - `error`        —— 闸门 / 服务端失败 → 顶部红条保留现有 prdMarkdown(不写盘)
 *
 * 红条文案由 `uploadAndReplace()` 返回,失败自动保留 prdMarkdown,符合 ADR-0015 D8 W4。
 */
type UploadStatus =
  | { kind: 'idle' }
  | { kind: 'uploading' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }

export function DraftingPrdPane({
  data,
  prdMarkdown,
  onPrdMarkdownChange,
  handle,
  onAuxLinkClick,
}: DraftingPrdPaneProps) {
  // -------------------------------------------------------------------------
  // 受控状态 —— 父组件持有,本组件只读取并触发 onChange
  // -------------------------------------------------------------------------
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(data.lastSavedAt)

  // -------------------------------------------------------------------------
  // ticket 03 —— 上传新版本的状态机 + 隐藏 input ref
  // -------------------------------------------------------------------------
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({ kind: 'idle' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /**
   * ticket 03 —— 用户选完 .md / .txt / .docx 后:
   * 1) 调 `uploadAndReplace(reqId, file)`(前端闸门 + 服务端解析 + 写盘 + 落 assets/)
   * 2) 成功 → `onPrdMarkdownChange(data.markdown)` 让父组件替换本地 state,
   *    立即渲染新内容(无 modal / 无 diff / 无确认 —— ADR-0015 D8 W4)
   * 3) 失败 → 保留现有 `prdMarkdown`,只更新 uploadStatus 显示顶部红条
   *
   * 把 input 的 value 清空,允许用户重选同一文件再次触发上传(否则浏览器会忽略同名文件)。
   */
  const handleUploadFile = useCallback(
    async (file: File) => {
      setUploadStatus({ kind: 'uploading' })
      const result = await uploadAndReplace(data.requirementId, file)
      if (result.ok) {
        onPrdMarkdownChange(result.data.markdown)
        // 同步触发 saveDraftRef 让 lastSavedAt 时间戳更新,沿用 issue 02 自动保存语义
        saveDraftRef.current()
        setUploadStatus({
          kind: 'success',
          message: `已替换为新版本(共 ${result.data.markdown.length} 字)`,
        })
      } else {
        setUploadStatus({ kind: 'error', message: result.message })
      }
      // 清空 input value,允许同名文件再次上传
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [data.requirementId, onPrdMarkdownChange],
  )

  const handleUploadButtonClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleUploadInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        void handleUploadFile(file)
      }
    },
    [handleUploadFile],
  )

  const dismissUploadError = useCallback(() => {
    setUploadStatus({ kind: 'idle' })
  }, [])

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
      // issue 04:data.title 在新建需求时由 NewRequirementModal 写入,
      // 不再依赖组件内部 title state;空标题 fallback 由 generatePrdSkeleton 处理
      onPrdMarkdownChange(generatePrdSkeleton(data.title))
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
      // 仅在 PRD 有内容时才自动保存;PRD 全空时静默不写
      // (验收:clearing all content suppresses the autosave tick)
      if (prdMarkdown.trim()) {
        saveDraft()
      }
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [data.autosaveIntervalMs, prdMarkdown, saveDraft])

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
          <div className="flex items-center gap-3">
            {lastSavedAt && (
              <span
                data-testid="drafting-autosaved"
                data-saved-at={lastSavedAt}
                className="text-xs text-text-3 font-mono"
              >
                已保存 · {formatRelativeTime(lastSavedAt)}
              </span>
            )}
          </div>
        </header>

        {/* ticket 03 —— 顶部红条(闸门失败 / 服务端解析失败 / 服务端 404 等)
            ADR-0015 D6:文案"⚠️ 无法解析此文件...";保留 prdMarkdown(不写盘)。 */}
        {uploadStatus.kind === 'error' && (
          <div
            data-testid="drafting-prd-upload-error"
            role="alert"
            className="flex items-start gap-2 px-5 py-2.5 bg-[#fef2f2] border-b border-[#fecaca] text-sm text-[#991b1b] flex-shrink-0"
          >
            <span aria-hidden="true">⚠️</span>
            <span className="flex-1">{uploadStatus.message}</span>
            <button
              type="button"
              data-testid="drafting-prd-upload-error-dismiss"
              onClick={dismissUploadError}
              aria-label="关闭错误提示"
              className="text-[#991b1b] hover:text-[#7f1d1d] text-base leading-none"
            >
              ✕
            </button>
          </div>
        )}
        {/* ticket 03 —— 成功 toast(短暂显示,提示"已覆盖为新版本") */}
        {uploadStatus.kind === 'success' && (
          <div
            data-testid="drafting-prd-upload-success"
            className="flex items-center gap-2 px-5 py-2 bg-[#f0fdf4] border-b border-[#bbf7d0] text-sm text-[#166534] flex-shrink-0"
          >
            <span aria-hidden="true">✅</span>
            <span className="flex-1">{uploadStatus.message}</span>
            <button
              type="button"
              data-testid="drafting-prd-upload-success-dismiss"
              onClick={dismissUploadError}
              aria-label="关闭成功提示"
              className="text-[#166534] hover:text-[#14532d] text-base leading-none"
            >
              ✕
            </button>
          </div>
        )}

        {/* 卡片体:title + PRD 编辑器 */}
        <div
          data-testid="drafting-prd-body"
          className="flex-1 overflow-auto p-5 flex flex-col gap-4 min-h-0"
        >
          {/* 标题只读 hero(issue 04 ticket)
              - 标题由 NewRequirementModal 在新建需求时一次性写入 meta.yaml.title
              - 列表页 / 面包屑 / 本 hero 都读 data.title,用户在 DRAFTING 不再编辑
              - ticket 明确要求 data-testid="drafting-title" 不存在(原 input 语义),
                这里改用 getByText(data.title) 来断言显示 */}
          <div data-testid="drafting-title-hero" data-requirement-id={data.requirementId}>
            <h1 className="text-2xl font-bold text-text-1 leading-tight">
              {data.title || '未命名需求'}
            </h1>
            <p className="text-sm text-text-3 mt-1">你在写这个需求</p>
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
                  {/* ticket 03 —— "上传新版本"按钮(DRAFTING 覆盖,W4 强度:无 modal / 无 diff / 无确认)
                      位置:紧贴预览切换按钮旁(ticket 03 字面要求 "在 previewToggle.buttonProps 旁"),
                      与预览按钮共用 toolbar 右侧栏,用户能一眼看到。 */}
                  <button
                    type="button"
                    data-testid="drafting-prd-upload"
                    data-uploading={uploadStatus.kind === 'uploading' ? 'true' : 'false'}
                    onClick={handleUploadButtonClick}
                    disabled={uploadStatus.kind === 'uploading'}
                    title="上传新版本 PRD(.md / .txt / .docx,直接覆盖)"
                    aria-label="上传新版本"
                    className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded text-xs font-medium bg-bg-elevated text-text-2 border border-border-strong hover:text-text-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadStatus.kind === 'uploading' ? '上传中…' : '📤 上传新版本'}
                  </button>
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
                {/* 隐藏的文件 input —— ticket 03 验收:只接 .md / .txt / .docx */}
                <input
                  ref={fileInputRef}
                  data-testid="drafting-prd-upload-input"
                  type="file"
                  accept=".md,.txt,.docx"
                  onChange={handleUploadInputChange}
                  className="hidden"
                />
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