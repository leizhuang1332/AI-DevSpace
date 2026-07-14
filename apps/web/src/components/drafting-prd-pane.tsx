'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  generatePrdSkeleton,
  validateLaunch,
  type DraftingData,
} from '@/lib/drafting'
import { formatRelativeTime } from '@/lib/format'
import { PrdAnchorBar } from './prd-anchor-bar'

/**
 * DRAFTING 工位的 PRD 顶置面板(issue 02 · 已扩展 issue 03 锚点条)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 02 + issue 03 扩展):
 * ┌──────────────────────────────────────────────────┐
 * │ PRD · 主文档              已保存 · x 秒前          │
 * ├──────────────────────────────────────────────────┤
 * │ 标题 input                                       │
 * │ PRD Markdown                                     │
 * │ ┌─ anchor-bar ─────────────────────────────────┐ │
 * │ │ 大纲 ▾ H1 退款 ... H2 背景 ... H2 目标 ...     │ │
 * │ ├─ ed-toolbar ─────────────────────────────────┤ │
 * │ │ B I H1 · xxxx chars                          │ │
 * │ ├──────────────────────────────────────────────┤ │
 * │ │ # PRD Markdown 编辑区 (textarea)             │ │
 * │ └──────────────────────────────────────────────┘ │
 * ├──────────────────────────────────────────────────┤
 * │                            [▶ 进入 ANALYZING]    │
 * └──────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - 受控组件:title / prdMarkdown 各自 useState,互不耦合(允许 PRD H1 与 title 不同)
 * - 骨架自动填充:data.empty + prdMarkdown 空 → mount 时一次性 setPrdMarkdown(generatePrdSkeleton)
 *   (保留"作者从空白开始"的语义,同时让新需求一键看到骨架)
 * - 自动保存:setInterval 周期写入(本期 mock:仅更新 UI 时间戳)
 * - 启动校验:用 packages/shared 的 validateLaunch(title + prdMarkdown 双 trim)
 *   不读仓库/辅助文件 —— 那些是 issue 08(仓库软警告)+ 上层 execution policy 的事
 * - PRD 锚点条(issue 03):mount 在 PRD Markdown 编辑器之上;点击回调 →
 *   prdTextareaRef 把 selectionStart/End 移到目标行,并按行号推算 scrollTop
 * - 唯一动作:[▶ 进入 ANALYZING] router.push 到 /requirements/<id>/analyzing/
 *   不改 Requirement status、不启动 Agent、不产生其他副作用(决策 15 不写状态机)
 *
 * 不在 issue 02/03 范围(后续 ticket 引入):预览模式 / 仓库勾选条 / 辅助卡片 / Drawer。
 */
export interface DraftingPrdPaneProps {
  data: DraftingData
}

export function DraftingPrdPane({ data }: DraftingPrdPaneProps) {
  const router = useRouter()

  // -------------------------------------------------------------------------
  // 受控状态
  // -------------------------------------------------------------------------
  const [title, setTitle] = useState(data.title)
  const [prdMarkdown, setPrdMarkdown] = useState(data.prdMarkdown)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(data.lastSavedAt)

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
  const handleJumpToLine = useCallback((line: number) => {
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
      parseFloat(getComputedStyle(ta).lineHeight) || ta.scrollHeight / Math.max(lines.length, 1)
    ta.scrollTop = Math.max(0, safeLine * lineHeight - lineHeight * 2)
  }, [prdMarkdown])

  // -------------------------------------------------------------------------
  // 骨架自动填充 —— 仅在首次 mount 时触发,且要求 empty + PRD 为空
  // (有保存内容的数据直接使用,绝不覆盖;空数据触发 generatePrdSkeleton)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (data.empty && !data.prdMarkdown && !prdMarkdown) {
      setPrdMarkdown(generatePrdSkeleton(data.title))
    }
    // 仅在 mount 时执行一次;后续 title 变化不再次填充
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // -------------------------------------------------------------------------
  // 派生:启动校验 —— 使用 shared 包的 validateLaunch(纯函数,issue 01 验收)
  // -------------------------------------------------------------------------
  const validity = useMemo(
    () => validateLaunch({ title, prdMarkdown }),
    [title, prdMarkdown],
  )

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

  // -------------------------------------------------------------------------
  // 底部动作:[▶ 进入 ANALYZING]
  // -------------------------------------------------------------------------
  const handleLaunch = useCallback(() => {
    if (!validity.canLaunch) return
    // 启动前最后写入一次,保证 ANALYZING 进入时落盘内容最新(本期 mock 仅 UI)
    saveDraft()
    router.push(`/requirements/${data.requirementId}/analyzing/`)
  }, [validity.canLaunch, saveDraft, router, data.requirementId])

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  return (
    <section
      data-testid="drafting-prd-pane"
      data-requirement-id={data.requirementId}
      data-empty={data.empty ? 'true' : 'false'}
      data-launch-valid={validity.canLaunch ? 'true' : 'false'}
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
              onChange={(e) => setTitle(e.target.value)}
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
                <span className="ml-auto font-mono text-xs">
                  <span
                    data-testid="drafting-markdown-chars"
                    data-chars={prdMarkdown.length}
                  >
                    {prdMarkdown.length} chars
                  </span>
                </span>
              </div>
              <textarea
                data-testid="drafting-prd"
                ref={prdTextareaRef}
                value={prdMarkdown}
                onChange={(e) => setPrdMarkdown(e.target.value)}
                placeholder={`# 需求标题\n\n## 背景\n...\n\n## 目标\n...\n\n## 验收标准\n- [ ] ...\n\n## 非目标\n...`}
                className="w-full flex-1 min-h-[260px] border-none p-3 font-mono text-sm leading-relaxed text-text-1 bg-bg-elevated resize-none focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* 卡片脚:单一动作 */}
        <footer
          data-testid="drafting-prd-foot"
          className="flex items-center justify-end gap-3 px-5 py-3 border-t border-border bg-bg-elevated flex-shrink-0"
        >
          {!validity.canLaunch && (
            <span
              data-testid="drafting-launch-disabled-hint"
              className="text-xs text-text-3"
            >
              {title.trim() ? '请填写 PRD Markdown' : '请填写标题与 PRD Markdown'}
            </span>
          )}
          <button
            type="button"
            data-testid="drafting-action-launch"
            data-variant="primary"
            disabled={!validity.canLaunch}
            onClick={handleLaunch}
            className={[
              'inline-flex items-center gap-1.5 rounded-md text-sm font-medium',
              'h-10 px-5 bg-brand text-white hover:bg-brand-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            ].join(' ')}
          >
            ▶ 进入 ANALYZING
          </button>
        </footer>
      </div>
    </section>
  )
}