'use client'

/**
 * DocumentReaderPane 组件 — ANALYZING 工位主区左侧文档对照阅读器
 *   (ADR-0017 D1 / D2 · ticket 02)
 *
 * 视觉对照基线:docs/adr/0017-analyzing-main-document-reader.md §"D2 · 左栏"
 *
 * 职责:
 * - 顶部 Tab 栏:PRD + 每个 AuxFile 一个 Tab;每个 Tab 显示"🔗 N 处引用"
 *   (0 处引用显示中性"·"不带数字)
 * - 主体阅读区:当前 Tab 的 Markdown 全文渲染(沿用 <MarkdownPreview>)
 *   - PRD Tab:渲染 `requirement.md` 全文;`![](assets/...)` 由 MarkdownPreview
 *     自然处理(已有 ticket 02 实现)
 *   - AuxFile Tab:渲染对应 AuxFile 的 body
 * - 空态:`prdMarkdown === '' && auxFiles.length === 0` → 引导去 DRAFTING
 * - a11y:role="tablist" / role="tab" / role="tabpanel";键盘 ← → 切换 Tab
 *
 * 设计要点:
 * - 客户端组件:维护 `activeTabId` state(纯前端,不触发网络)
 * - 复用 <MarkdownPreview>:与 DRAFTING 阅读器一致渲染
 * - `activeSourceRef` / `onSourceRefClick` 字段本期不消费(ticket 03 接入);
 *   保留接口位以避免后续 ticket 改动签名
 * - Tab 切换保持 SSR 注入数据不变,只换 active state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AssetMeta, AuxFile } from '@ai-devspace/shared'
import type { SourceRef } from '@/lib/analyzing'
import { MarkdownPreview } from './markdown-preview'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** 引用计数:每个文档被多少产物通过 source_refs 引用(ADR-0017 D2 Tab 标签) */
export interface DocumentReaderCitationCounts {
  /** PRD 在所有 chunk.source_refs 中被引用的总次数(kind === 'prd') */
  prd: number
  /** auxId → 该 AuxFile 被引用的次数 */
  aux: Record<string, number>
  /** Asset 在所有 chunk.source_refs 中被引用的总次数(kind === 'asset') */
  asset: number
}

export interface DocumentReaderPaneProps {
  /** PRD Markdown 全文(SSR 注入 `requirement.md`) */
  prdMarkdown: string
  /** 辅助文件列表(SSR 注入,已按 usage_tag 排序) */
  auxFiles: AuxFile[]
  /** PRD 引用的 Asset 列表(SSR 注入,图片渲染用) */
  assetList: AssetMeta[]
  /** 引用计数(每个文档被多少产物引用) */
  citationCounts: DocumentReaderCitationCounts
  /** 当前激活的 source_ref(ticket 03 接入;本期不消费,保留接口位) */
  activeSourceRef?: SourceRef | null
  /** source_ref 点击回调(ticket 03 接入;本期不消费,保留接口位) */
  onSourceRefClick?: (ref: SourceRef | null) => void
}

// ---------------------------------------------------------------------------
// Tab 标识常量
// ---------------------------------------------------------------------------

/** PRD Tab 的固定 id(用作 activeTabId 初始值 + 切换判定) */
export const PRD_TAB_ID = 'prd'

// ---------------------------------------------------------------------------
// Tab 标签格式化
// ---------------------------------------------------------------------------

/**
 * 拼接 Tab 标签:
 * - PRD:"PRD · 🔗 {n}" 或 "PRD ·"(n === 0)
 * - AuxFile:"{filename} · 🔗 {n}" 或 "{filename} ·"(n === 0)
 *
 * 0 处引用显示中性"·"不带 🔗 数字(避免空数据时的"🔗 0"视觉噪音;
 * 见 ADR-0017 D2 Tab 标签形态)
 */
function formatTabLabel(
  kind: 'prd' | 'aux',
  filename: string,
  citationCount: number,
): string {
  const suffix = citationCount > 0 ? ` · 🔗 ${citationCount}` : ' ·'
  return `${filename}${suffix}`
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function DocumentReaderPane({
  prdMarkdown,
  auxFiles,
  assetList,
  citationCounts,
  // 本期不消费(留接口位给 ticket 03);前置下划线 + eslint-disable 标记未用。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  activeSourceRef: _activeSourceRef,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onSourceRefClick: _onSourceRefClick,
}: DocumentReaderPaneProps) {
  // -------------------------------------------------------------------------
  // 内部 state:activeTabId(纯客户端,默认 PRD)
  // -------------------------------------------------------------------------
  const [activeTabId, setActiveTabId] = useState<string>(PRD_TAB_ID)

  // -------------------------------------------------------------------------
  // Tab 列表派生(顺序:PRD + auxFiles 顺序)
  // auxFiles 在 SSR loader 已按 usage_tag 6 类 + filename 字典序排序,
  // 此处不再二次排序 —— 保持 SSR 注入顺序。
  // -------------------------------------------------------------------------
  const tabs = useMemo<Array<{ id: string; kind: 'prd' | 'aux'; label: string }>>(
    () => [
      {
        id: PRD_TAB_ID,
        kind: 'prd',
        label: formatTabLabel('prd', 'PRD', citationCounts.prd),
      },
      ...auxFiles.map((a) => ({
        id: a.id,
        kind: 'aux' as const,
        label: formatTabLabel('aux', a.filename, citationCounts.aux[a.id] ?? 0),
      })),
    ],
    [auxFiles, citationCounts.prd, citationCounts.aux],
  )

  // -------------------------------------------------------------------------
  // 容错:activeTabId 指向已不存在的 aux(例如 auxFiles 缩减后 SSR 重渲染)
  // → 静默回退到 PRD Tab,避免主区显示空白。
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (activeTabId === PRD_TAB_ID) return
    const exists = auxFiles.some((a) => a.id === activeTabId)
    if (!exists) {
      setActiveTabId(PRD_TAB_ID)
    }
  }, [activeTabId, auxFiles])

  // -------------------------------------------------------------------------
  // 当前激活 Tab 的元数据(用于 body 渲染)
  // -------------------------------------------------------------------------
  const activeAux = useMemo(() => {
    if (activeTabId === PRD_TAB_ID) return null
    return auxFiles.find((a) => a.id === activeTabId) ?? null
  }, [activeTabId, auxFiles])

  // -------------------------------------------------------------------------
  // 空态判定
  // -------------------------------------------------------------------------
  const isEmpty = prdMarkdown === '' && auxFiles.length === 0

  // -------------------------------------------------------------------------
  // 键盘 ← → 切换 Tab(在 tablist 容器上捕获 keydown)
  // -------------------------------------------------------------------------
  const tablistRef = useRef<HTMLDivElement>(null)
  const focusTabById = useCallback(
    (id: string) => {
      const el = tablistRef.current?.querySelector<HTMLButtonElement>(
        `[data-tab-id="${CSS.escape(id)}"]`,
      )
      el?.focus()
    },
    [],
  )

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tabs.length === 0) return
      const currentIdx = tabs.findIndex((t) => t.id === activeTabId)
      if (currentIdx < 0) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        const nextIdx = (currentIdx + 1) % tabs.length
        const nextTab = tabs[nextIdx]
        setActiveTabId(nextTab.id)
        focusTabById(nextTab.id)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        const prevIdx = (currentIdx - 1 + tabs.length) % tabs.length
        const prevTab = tabs[prevIdx]
        setActiveTabId(prevTab.id)
        focusTabById(prevTab.id)
      }
    },
    [tabs, activeTabId, focusTabById],
  )

  // -------------------------------------------------------------------------
  // 当前 body:MarkdownPreview + 适配 currentFile
  //   - PRD 渲染:`currentFile='requirement.md'`,让 link 解析时语义正确
  //   - AuxFile 渲染:`currentFile=<aux.filename>`,沿用 Drafting aux 预览语义
  // -------------------------------------------------------------------------
  const body = useMemo(() => {
    if (isEmpty) return null
    if (activeTabId === PRD_TAB_ID) {
      return (
        <MarkdownPreview
          markdown={prdMarkdown}
          currentFile="requirement.md"
          auxFiles={auxFiles}
          assets={assetList}
        />
      )
    }
    if (!activeAux) return null
    return (
      <MarkdownPreview
        markdown={activeAux.body}
        currentFile={activeAux.filename}
        auxFiles={auxFiles}
      />
    )
  }, [isEmpty, activeTabId, prdMarkdown, auxFiles, assetList, activeAux])

  return (
    <div
      data-testid="document-reader-pane"
      data-active-tab-id={activeTabId}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden h-full flex flex-col"
    >
      {/* 顶部 Tab 栏 */}
      <div
        ref={tablistRef}
        data-testid="doc-reader-tabs"
        role="tablist"
        aria-label="文档对照阅读器"
        onKeyDown={handleTabKeyDown}
        className="flex items-center gap-1 px-3 py-2 border-b border-border bg-bg-subtle overflow-x-auto flex-shrink-0"
      >
        {tabs.map((t) => {
          const isActive = t.id === activeTabId
          return (
            <button
              key={t.id}
              type="button"
              data-testid="doc-reader-tab"
              data-tab-id={t.id}
              data-tab-kind={t.kind}
              data-active={isActive ? 'true' : 'false'}
              role="tab"
              id={`doc-reader-tab-${t.id}`}
              aria-selected={isActive ? 'true' : 'false'}
              aria-controls="doc-reader-body"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTabId(t.id)}
              className={
                isActive
                  ? 'px-3 h-7 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border whitespace-nowrap'
                  : 'px-3 h-7 rounded-md text-sm font-medium bg-transparent text-text-2 hover:text-text-1 hover:bg-bg-elevated whitespace-nowrap border border-transparent'
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 主体阅读区 */}
      <div
        id="doc-reader-body"
        data-testid="doc-reader-body"
        role="tabpanel"
        aria-labelledby={`doc-reader-tab-${activeTabId}`}
        className="flex-1 overflow-auto px-5 py-4 min-h-0"
      >
        {isEmpty ? (
          <div
            data-testid="doc-reader-empty"
            className="flex flex-col items-center justify-center h-full text-center gap-2 text-text-3"
          >
            <div className="text-3xl">📭</div>
            <div className="text-sm">
              暂无需求文档与辅助材料,请去 DRAFTING 工位创建
            </div>
          </div>
        ) : (
          body
        )}
      </div>
    </div>
  )
}