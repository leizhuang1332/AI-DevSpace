'use client'

/**
 * DocumentReaderPane 组件 — ANALYZING 工位主区左侧文档对照阅读器
 *   (ADR-0017 D2 · ticket 02 / 05)
 *
 * 视觉对照基线:docs/adr/0017-analyzing-main-document-reader.md §"D2 · 左栏"
 *
 * 职责(ADR-0017 D2):
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
 * - **Tab 顺序** = [PRD, aux1, aux2 ...](aux 在 SSR loader 已按 usage_tag 6 类 + filename
 *   字典序排序,见 `analyzing.server.ts`;此处不再二次排序)
 * - **引用计数** `citationCounts` 由父组件从 chunks.source_refs 派生(见
 *   `countCitationsByDoc`),Tab 标签直接显示;无 source_ref 的产物不算入
 * - **Tab 切换不发网络** —— 所有文档已在 SSR 注入 props(`prdMarkdown` /
 *   `auxFiles` body / `assetList`),`useState` 切 `activeTabId` 即可,
 *   即便窄视口形态(ticket 05)也保持零网络
 * - 联动 pulse(ticket 03):`pulseRef` 由父组件设置 → 自动切 Tab + 滚 + 1.5s 高亮
 * - `activeSourceRef` / `onSourceRefClick` 字段本期不消费(ticket 03 接入);
 *   保留接口位以避免后续 ticket 改动签名
 *
 * Known limitations(ADR-0017 §"风险缓解" · 落地于 ticket 05 JSDoc):
 * - **lineRange 漂移**:AI 输出的 source_ref.lineRange 与最新 PRD 行号不一致时
 *   (用户在 DRAFTING 改完 PRD 后未重扫)→ UI 高亮会错位。`quote?` 字段虽存原文
 *   片段做 sanity check(见 `data-quote-mismatch`),但 UI 不重排版;留 v2 修
 * - **Asset 高亮基于 assetId 名匹配**:`citationRefs.asset[]` 按 assetId
 *   (`assetId === AssetMeta.name`)比对;若 user 在 DRAFTING rename Asset
 *   文件,高亮会失效(留 v2 接入 Asset 重命名监听)
 * - **反向联动未实装**:点左栏高亮 span → 不滚动右栏卡片(本期 D4 v2 候选);
 *   见 ADR-0017 D4 "本期不实现"
 * - **Synthetic chunk 不持久化**:用户在 ProductList "+ 新增" 路径合成的
 *   synthetic chunk 仅落到客户端 chunksBySessionId(本期不写 chunks.jsonl),
 *   刷新页面后丢失;UI 卡片已挂 ⚠️ 角标提示(详见 ticket 04 + ADR-0017 D6)
 */

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import type { AssetMeta, AuxFile } from '@ai-devspace/shared'
import {
  buildCitationSpans,
  countAssetCitations,
  type CitationRefsByDoc,
  type SourceRef,
} from '@/lib/analyzing'
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
  /**
   * 按文档分桶的原始 source_ref(ticket 03):阅读器据此渲染画线高亮 span。
   * 不传 → 无高亮(与 ticket 02 行为一致)。
   */
  citationRefs?: CitationRefsByDoc
  /**
   * 联动 pulse(ticket 03 · ADR-0017 D4):点击右栏产物 → 父组件设置
   * `{ tabId, lineRange }`。DocumentReaderPane 据此:tabId ≠ 当前 → 切 Tab;
   * 滚到对应行 + 高亮 `animate-pulse-brand` 1.5s 后移除。null → 无 pulse。
   *
   * ticket 07 扩展(ADR-0018 D3):反向联动"点左栏 span → 滚右栏 product 卡片 +
   * pulse" 在 AnalyzingZone 复用同一 `pulseRef` 状态机;DocumentReaderPane 只
   * 消费 `{ tabId, lineRange }` 分支,`{ productId }` 分支由 ProductList 消费
   * (用 `if ('tabId' in pulseRef)` 守卫过滤)。
   */
  pulseRef?:
    | { tabId: string; lineRange: readonly [number, number] }
    | { productId: string }
    | null
  /** 当前激活的 source_ref(ticket 03 接入;保留接口位) */
  activeSourceRef?: SourceRef | null
  /** source_ref 点击回调(保留接口位,本期高亮点击不联动右栏) */
  onSourceRefClick?: (ref: SourceRef | null) => void
  /**
   * ticket 07(ADR-0018 D1/D2):父组件透传一个 ref,DocumentReaderPane 把它绑到
   * 根容器 div 上。ticket 09 撤回 CitationOverlay 后,本 ref **当前无外部消费者**
   * —— 反向联动 handleSourceRefClick 只消费 productListRef(ticket 09 §3)。
   * 接口位保留:不传 → 不绑 ref(向后兼容旧用法);后续 v2 若重启 SVG / 引入
   * 其他需要左栏 DOM 的特性,可重新消费此 ref。
   *
   * TODO(follow-up ticket):`docPaneRef` 在 ticket 09 后已是死代码,可一并清理
   * (声明 + 此 prop + DocumentReaderPane 内 `<div ref={containerRef}>`)。
   */
  containerRef?: Ref<HTMLDivElement>
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
  citationRefs,
  pulseRef,
  activeSourceRef: _activeSourceRef,
  onSourceRefClick,
  containerRef,
}: DocumentReaderPaneProps) {
  // -------------------------------------------------------------------------
  // 内部 state:activeTabId(纯客户端,默认 PRD)
  // -------------------------------------------------------------------------
  const [activeTabId, setActiveTabId] = useState<string>(PRD_TAB_ID)

  // -------------------------------------------------------------------------
  // pulse 行区间(ticket 03):点击右栏产物触发;1.5s 后清空
  // -------------------------------------------------------------------------
  const [pulseLine, setPulseLine] = useState<readonly [number, number] | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pulseTimerRef = useRef<number | null>(null)

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
  // 画线高亮 span(ticket 03):当前 Tab 文档全文 + 该文档 refs → 去重 span
  // - PRD Tab → citationRefs.prd;AuxFile Tab → citationRefs.aux[activeTabId]
  // - Asset 角标:PRD 内联图片按 citationRefs.asset 计数(aux body 一般无图,传亦无害)
  // -------------------------------------------------------------------------
  const activeDocText =
    activeTabId === PRD_TAB_ID ? prdMarkdown : (activeAux?.body ?? '')
  const activeRefs = useMemo(() => {
    if (!citationRefs) return []
    return activeTabId === PRD_TAB_ID
      ? citationRefs.prd
      : (citationRefs.aux[activeTabId] ?? [])
  }, [citationRefs, activeTabId])
  const highlights = useMemo(
    () => buildCitationSpans(activeDocText, activeRefs),
    [activeDocText, activeRefs],
  )
  const assetCitations = useMemo(
    () => countAssetCitations(citationRefs?.asset ?? []),
    [citationRefs],
  )

  // -------------------------------------------------------------------------
  // pulse 联动(ticket 03 · ADR-0017 D4):
  // - pulseRef.tabId ≠ 当前 → 切 Tab
  // - 设 pulseLine → 对应 <mark> 加 animate-pulse-brand
  // - 滚到该行对应元素(近似:citation-highlight 的 data-line-start 匹配)
  // - 1.5s 后清 pulseLine
  // - ticket 07 扩展:pulseRef 类型扩展为 `{ productId } | { tabId, lineRange }`;
  //   本组件只消费 `{ tabId, lineRange }` 分支(`{ productId }` 由 ProductList 处理)
  // 依赖 pulseRef 对象身份:父组件每次点击生成新对象(即使同 lineRange)→ effect 重跑
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!pulseRef) return
    // 类型守卫:ticket 07 新增的 `{ productId }` 分支由 ProductList 消费,
    // DocumentReaderPane 只处理 `{ tabId, lineRange }`(行级联动)
    if (!('tabId' in pulseRef)) return
    if (pulseRef.tabId !== activeTabId) {
      setActiveTabId(pulseRef.tabId)
    }
    setPulseLine(pulseRef.lineRange)
    // 滚动定位延到 DOM 更新后(切 Tab / 高亮渲染完成)
    const scrollId = window.setTimeout(() => {
      const el = bodyRef.current?.querySelector<HTMLElement>(
        `[data-testid="citation-highlight"][data-line-start="${pulseRef.lineRange[0]}"]`,
      )
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 0)
    if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
    pulseTimerRef.current = window.setTimeout(() => setPulseLine(null), 1500)
    return () => window.clearTimeout(scrollId)
    // activeTabId 故意不入依赖:切 Tab 由本 effect 触发,不应二次重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulseRef])

  // 卸载时清 pulse 计时器
  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
    }
  }, [])

  // -------------------------------------------------------------------------
  // 空态判定
  // -------------------------------------------------------------------------
  const isEmpty = prdMarkdown === '' && auxFiles.length === 0

  // -------------------------------------------------------------------------
  // 反向联动(ticket 07 · ADR-0018 D3 · ADR-0017 D4 v2 补齐):
  // - 点 <mark> → 找到对应的 SourceRef(在当前 activeRefs 中 lineRange 匹配的第一条)
  //   → 调 onSourceRefClick(ref)
  // - 多个 ref 共享同一 lineRange(多产物引用同一段)→ 取第一条(ADR-0018 D3
  //   "1:1 映射"的简化:多引用场景下第一条即代表该 span)
  // - 用事件委托挂在 bodyRef 上,避免改 MarkdownPreview 内部结构
  // - 不阻止默认行为:mark 自身是 `<mark>`,无 href,无副作用
  // -------------------------------------------------------------------------
  const handleBodyClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onSourceRefClick) return
      const target = e.target as HTMLElement | null
      const mark = target?.closest<HTMLElement>(
        '[data-testid="citation-highlight"]',
      )
      if (!mark) return
      const start = mark.dataset.lineStart
      const end = mark.dataset.lineEnd
      if (start === undefined || end === undefined) return
      const startNum = Number(start)
      const endNum = Number(end)
      if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return
      const ref = activeRefs.find(
        (r) =>
          r.lineRange[0] === startNum &&
          r.lineRange[1] === endNum,
      )
      if (ref) onSourceRefClick(ref)
    },
    [onSourceRefClick, activeRefs],
  )

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
          highlights={highlights}
          pulseLineRange={pulseLine}
          assetCitations={assetCitations}
        />
      )
    }
    if (!activeAux) return null
    return (
      <MarkdownPreview
        markdown={activeAux.body}
        currentFile={activeAux.filename}
        auxFiles={auxFiles}
        highlights={highlights}
        pulseLineRange={pulseLine}
      />
    )
  }, [
    isEmpty,
    activeTabId,
    prdMarkdown,
    auxFiles,
    assetList,
    activeAux,
    highlights,
    pulseLine,
    assetCitations,
  ])

  return (
    <div
      data-testid="document-reader-pane"
      data-active-tab-id={activeTabId}
      ref={containerRef}
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
        ref={bodyRef}
        data-testid="doc-reader-body"
        role="tabpanel"
        aria-labelledby={`doc-reader-tab-${activeTabId}`}
        onClick={handleBodyClick}
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