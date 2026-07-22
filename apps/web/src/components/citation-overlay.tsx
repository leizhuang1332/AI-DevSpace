'use client'

/**
 * CitationOverlay — ANALYZING 工位主区跨列 SVG 画线层(ADR-0018 D1/D2/D4)
 *   ticket 07 · issue: `.scratch/analyzing-doc-reader/issues/07-svg-cross-column-citation-lines.md`
 *
 * 视觉对照基线:docs/adr/0018-analyzing-svg-cross-column-lines.md §"工位主区布局"
 *
 * 职责:
 * - 主区内绝对定位 SVG overlay 层(覆盖 DocumentReaderPane + ProductList)
 * - 从 chunks 派生 `source_refs` 列表 → 每条 line 对应一个 `<path>`
 *   (右栏 product 卡片中心 → 左栏当前 active tab 文档的 `<mark>` 中心)
 * - 端点用 `getBoundingClientRect()` + SVG viewBox 坐标系转换 + clamp 到视口边界
 * - 监听 scroll / resize / MutationObserver,rAF throttle 合并高频事件
 * - SSR 期 `return null`(避免 hydration mismatch);窄视口不渲染
 *
 * 设计要点(ADR-0018 D1):
 * - **零依赖**:原生 SVG,不引入 leader-line / react-flow
 * - `pointer-events: none`:线条不挡 click,事件穿透到下层卡片/span
 * - `z-index: 10`:在 product 卡片 box-shadow 之上,但不挡 click
 * - 颜色统一 `hsl(var(--brand-100))`(本仓库只有 --brand-100 / --brand-500,
 *   取最接近 brand-300 的亮色变体)+ `stroke-opacity="0.6"`
 *
 * 位置 API(ADR-0018 D2):
 * - `productListRef` 容器内查 `[data-product-id="<chunkId>"]`(ProductList 加)
 * - `documentBodyRef` 容器内查 `[data-testid="citation-highlight"]`(markdown-preview
 *   已有),按 `data-line-start` / `data-line-end` 索引成 Map
 * - `activeTabId` 决定 doc 上下文:ref.kind==='prd' → 查 bodyRef(PRD tab 时);
 *   ref.kind==='aux' → 查 bodyRef(AuxFile tab 时)
 * - asset ref 没有 lineRange → **不画线**(自然跳过)
 *
 * SSR / 窄视口容错(ADR-0018 D4):
 * - `mounted === false` → 返回 `null`(SSR + 首屏 hydration 前)
 * - `isDesktop === false` → 返回 `null`(窄视口下隐藏,避免视觉错乱)
 *
 * 数据流:
 * `AnalyzingChunk.source_refs`(ADR-0017 D3)
 *   → CitationOverlay 派生 `lines`(每条 = {productId, ref})
 *   → 每条 line = SVG `<path>`(贝塞尔曲线)
 *   → narration chunk 不带 source_refs(契约,见 `analyzing.ts` source_refs? 注释)
 *     → 自然 0 条 path
 *
 * 已知限制(ADR-0018 §负面 / 代价):
 * - `getBoundingClientRect` 高频调用 → rAF throttle + scroll `passive: true`
 * - 视觉密度风险:10 产物 × 1.5 source_ref ≈ 15 条线;本期不做密度阈值,留 v2
 * - 浏览器旧版本不支持 `ResizeObserver`:项目 ES2020+,主流浏览器都支持;
 *   vitest jsdom 桩见 `apps/web/vitest.setup.ts`
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AnalyzingChunk, SourceRef } from '@/lib/analyzing'
import { PRD_TAB_ID } from './document-reader-pane'

const DEFAULT_TAB_ID = PRD_TAB_ID

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CitationOverlayProps {
  /** 当前 active 会话的 chunks(派生 source_refs 的唯一数据源) */
  chunks: readonly AnalyzingChunk[]
  /** 右栏 ProductList 容器 ref(用于查 `[data-product-id]` 卡片) */
  productListRef: RefObject<HTMLElement | null>
  /** 左栏 DocumentReaderPane 容器 ref(内部 querySelector 找 doc-reader-body;
   *  也读 `data-active-tab-id` 决定 source_ref 端点上下文) */
  documentBodyRef: RefObject<HTMLElement | null>
  /** 是否桌面视口;窄视口下不渲染(ticket 05 + ADR-0018 D4) */
  isDesktop?: boolean
}

// ---------------------------------------------------------------------------
// 内部类型
// ---------------------------------------------------------------------------

/** 一条待画线的几何参数(viewBox 坐标系,已 clamp) */
interface LineGeometry {
  /** React key 稳定值:`productId|kind|auxId|lineRangeStart|lineRangeEnd` */
  key: string
  /** 源点 X(product 卡片中心) */
  x1: number
  /** 源点 Y */
  y1: number
  /** 终点 X(mark 中心) */
  x2: number
  /** 终点 Y */
  y2: number
}

/** chunks → line 列表(每条 = {productId, ref},narration 已天然过滤) */
interface LineDescriptor {
  productId: string
  ref: SourceRef
}

// ---------------------------------------------------------------------------
// 派生:chunks → lines
// ---------------------------------------------------------------------------

/**
 * 把 chunks 展平成 `{productId, ref}[]`。
 *
 * 契约:
 * - narration chunk 在 `AnalyzingChunk` 类型上不带 source_refs(loader 侧已保证)
 *   → 天然不进入本函数输出
 * - 合成 chunk(ADR-0017 D6)若带 source_refs → 正常进入
 * - ref.kind === 'asset' 没有 lineRange → 仍进入;SVG 渲染时跳过
 *   (避免静默丢弃导致"卡片有 🔗 但没线"的视觉偏差)
 */
function deriveLines(chunks: readonly AnalyzingChunk[]): LineDescriptor[] {
  const out: LineDescriptor[] = []
  for (const c of chunks) {
    if (c.kind === 'narration') continue
    const refs = c.source_refs
    if (!refs || refs.length === 0) continue
    for (const ref of refs) {
      out.push({ productId: c.id, ref })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 派生:line → path d 字符串
// ---------------------------------------------------------------------------

/**
 * 计算贝塞尔曲线 path d(S 形)。
 *
 * 控制点策略:
 * - cp1 = (midX, y1); cp2 = (midX, y2)
 *   → 水平居中的对称 S 曲线,从 product 一侧优雅地弯到 mark 一侧
 * - 适合左右两栏布局(product 在右、mark 在左);若方向反转,
 *   仍可保持形状(只是看起来不是 S 而是 C)。
 */
function buildPathD(g: LineGeometry): string {
  const midX = (g.x1 + g.x2) / 2
  return `M ${g.x1} ${g.y1} C ${midX} ${g.y1}, ${midX} ${g.y2}, ${g.x2} ${g.y2}`
}

// ---------------------------------------------------------------------------
// 工具:clamp 到 [0, max]
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

// ---------------------------------------------------------------------------
// 工具:把 product / mark 元素坐标转 SVG viewBox 坐标
// ---------------------------------------------------------------------------

/**
 * 把元素中心坐标转到 SVG viewBox 坐标系(减 svg 自身的 left/top),
 * 然后 clamp 到 viewBox 边界(避免线条飞出)。
 */
function centerInViewBox(
  el: HTMLElement,
  svgRect: DOMRect,
): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2 - svgRect.left
  const cy = r.top + r.height / 2 - svgRect.top
  return {
    x: clamp(cx, 0, svgRect.width),
    y: clamp(cy, 0, svgRect.height),
  }
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function CitationOverlay({
  chunks,
  productListRef,
  documentBodyRef,
  isDesktop,
}: CitationOverlayProps) {
  // -------------------------------------------------------------------------
  // SSR / 窄视口守卫
  // -------------------------------------------------------------------------
  // SSR 期返回 null,避免 hydration mismatch(ADR-0018 D4);
  // 首屏 mount 后 mounted=true,再渲染 SVG。
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // -------------------------------------------------------------------------
  // SVG 容器 ref + 重算节流
  // -------------------------------------------------------------------------
  const svgRef = useRef<SVGSVGElement>(null)
  const [paths, setPaths] = useState<LineGeometry[]>([])
  const rafIdRef = useRef<number | null>(null)

  /**
   * 当前 active tab id(从 documentBodyRef 容器的 `data-active-tab-id` 属性读)。
   *
   * 不通过 props 接收的原因:
   * - DocumentReaderPane 内部维护 activeTabId state,父组件不持有
   * - 父组件把 ref 透传给 DocumentReaderPane,DocumentReaderPane 在 root div 上
   *   写 `data-active-tab-id={activeTabId}`(已有)
   * - CitationOverlay 用 MutationObserver 监听该 attribute,变化时 setState
   * - 避免父组件额外维护 activeTabId state 的双向同步
   */
  const [activeTabId, setActiveTabId] = useState<string>(DEFAULT_TAB_ID)
  useEffect(() => {
    if (!mounted) return
    const el = documentBodyRef.current
    if (!el) return
    setActiveTabId(el.dataset.activeTabId ?? DEFAULT_TAB_ID)
  }, [mounted, documentBodyRef])

  /** 取消任何待执行的 rAF */
  const cancelPending = (): void => {
    if (rafIdRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
  }

  // 派生:chunks → lines(memoized,narration 已过滤)
  const lines = useMemo(() => deriveLines(chunks), [chunks])

  /**
   * 重算所有 path 几何:扫描 product 卡片 + 当前 active tab 的 mark spans,
   * 用 getBoundingClientRect + svg viewBox 坐标转换 + clamp。
   * 任何一步拿不到必要 DOM,直接清空 paths(无副作用)。
   */
  const recompute = (): void => {
    const svg = svgRef.current
    const productListEl = productListRef.current
    const docBodyEl = documentBodyRef.current
    if (!svg || !productListEl || !docBodyEl) {
      setPaths([])
      return
    }
    const svgRect = svg.getBoundingClientRect()
    // 0×0 视口(父容器尚未布局)→ 跳过,避免产生 NaN
    if (svgRect.width === 0 || svgRect.height === 0) {
      setPaths([])
      return
    }

    // 当前 active tab 文档内的 mark spans(可能 0..N 个)
    // 注意:DocumentReaderPane 每次切 Tab 都会重渲染 markdown-preview,
    // 导致 mark spans 短暂为空;MutationObserver 会随后触发 recompute。
    const markEls = docBodyEl.querySelectorAll<HTMLElement>(
      '[data-testid="citation-highlight"]',
    )
    const markMap = new Map<string, HTMLElement>()
    markEls.forEach((m) => {
      const start = m.dataset.lineStart
      const end = m.dataset.lineEnd
      if (start !== undefined && end !== undefined) {
        markMap.set(`${start}:${end}`, m)
      }
    })

    const next: LineGeometry[] = []
    for (const line of lines) {
      const ref = line.ref
      // asset ref 无 lineRange → 不画线(契约:无锚点)
      if (ref.kind === 'asset') continue
      // 验证 ref.kind 与 activeTabId 一致:
      // - activeTabId === PRD_TAB_ID('prd')→ 只处理 prd ref
      // - activeTabId === 某个 auxId → 只处理 aux ref 且 auxId 匹配
      // 不一致 → 当前 active tab 没有此 source_ref 的 mark → 不画线
      if (ref.kind === 'prd' && activeTabId !== PRD_TAB_ID) continue
      if (ref.kind === 'aux' && activeTabId !== ref.auxId) continue

      const productEl = productListEl.querySelector<HTMLElement>(
        `[data-product-id="${CSS.escape(line.productId)}"]`,
      )
      if (!productEl) continue
      const markEl = markMap.get(`${ref.lineRange[0]}:${ref.lineRange[1]}`)
      if (!markEl) continue

      const src = centerInViewBox(productEl, svgRect)
      const dst = centerInViewBox(markEl, svgRect)
      next.push({
        key: `${line.productId}|${ref.kind}|${ref.kind === 'aux' ? ref.auxId : ''}|${ref.lineRange[0]}:${ref.lineRange[1]}`,
        x1: src.x,
        y1: src.y,
        x2: dst.x,
        y2: dst.y,
      })
    }
    setPaths(next)
  }

  /**
   * rAF throttle 重排(scroll/resize 高频时合并到下一帧)。
   * 在已 pending 的情况下不再排队,直接复用本帧的重排。
   */
  const scheduleRecompute = (): void => {
    if (rafIdRef.current !== null) return
    if (typeof window === 'undefined') return
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null
      recompute()
    })
  }

  // -------------------------------------------------------------------------
  // 监听:resize + scroll + MutationObserver
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!mounted) return
    if (!isDesktop) return
    if (typeof window === 'undefined') return

    // 立即重算一次(挂载时 + chunks/activeTabId 变化时)
    scheduleRecompute()

    const handleResize = (): void => {
      scheduleRecompute()
    }
    window.addEventListener('resize', handleResize, { passive: true })

    // 左栏阅读区 body + 右栏产品列表 body 各自滚动独立监听(ADR-0018 D2)。
    // 主区外层已 overflow-hidden(ADR-0019 D1),不再是滚动容器 → 无需监听。
    const productListEl = productListRef.current
    const docBodyEl = documentBodyRef.current
    const handleScroll = (): void => {
      scheduleRecompute()
    }
    if (productListEl) {
      productListEl.addEventListener('scroll', handleScroll, { passive: true })
    }
    if (docBodyEl) {
      docBodyEl.addEventListener('scroll', handleScroll, { passive: true })
    }

    // MutationObserver:监听 product 卡片 / mark span 增删 + Tab 切换重渲染
    // (切 Tab 时 markdown-preview 重新挂载,marks 整体替换)
    const observers: MutationObserver[] = []
    const observe = (target: HTMLElement, isDocBody: boolean): void => {
      const mo = new MutationObserver((mutations) => {
        // 检测切 Tab:active tab 变化 → 同步 activeTabId state 后重算
        if (isDocBody) {
          for (const m of mutations) {
            if (
              m.type === 'attributes' &&
              m.attributeName === 'data-active-tab-id' &&
              target instanceof HTMLElement
            ) {
              setActiveTabId(target.dataset.activeTabId ?? DEFAULT_TAB_ID)
              break
            }
          }
        }
        scheduleRecompute()
      })
      mo.observe(target, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'data-line-start',
          'data-line-end',
          'data-product-id',
          'data-active-tab-id',
        ],
      })
      observers.push(mo)
    }
    if (productListEl) observe(productListEl, false)
    if (docBodyEl) observe(docBodyEl, true)

    return () => {
      cancelPending()
      window.removeEventListener('resize', handleResize)
      if (productListEl) {
        productListEl.removeEventListener('scroll', handleScroll)
      }
      if (docBodyEl) {
        docBodyEl.removeEventListener('scroll', handleScroll)
      }
      observers.forEach((mo) => mo.disconnect())
    }
    // 依赖:产品列表/body ref 内容变化(切 Tab 时 ref 会被 React 重指),
    // chunks 变化(派生 lines 变化)→ 重新挂监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isDesktop, activeTabId, lines.length])

  // -------------------------------------------------------------------------
  // chunks/lines 变化 → 主动重算一次(useEffect 监听 productIds)
  // -------------------------------------------------------------------------
  // 上面的 effect 已经监听了 mutation,但 product 列表本身由 React 重渲染,
  // data-product-id 属性变化会触发 attributeFilter 命中;若命中失败,
  // 仍在此处兜底强制重算一次。
  const lineSignature = useMemo(
    () =>
      lines
        .map((l) =>
          l.ref.kind === 'asset'
            ? `${l.productId}|asset|${l.ref.assetId}`
            : l.ref.kind === 'aux'
              ? `${l.productId}|aux|${l.ref.auxId}|${l.ref.lineRange[0]}:${l.ref.lineRange[1]}`
              : `${l.productId}|prd|${l.ref.lineRange[0]}:${l.ref.lineRange[1]}`,
        )
        .join(','),
    [lines],
  )
  useEffect(() => {
    if (!mounted || !isDesktop) return
    scheduleRecompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSignature, mounted, isDesktop, activeTabId])

  // -------------------------------------------------------------------------
  // SSR / 窄视口 → 返回 null
  // -------------------------------------------------------------------------
  if (!mounted) return null
  if (isDesktop === false) return null

  return (
    <svg
      ref={svgRef}
      data-testid="citation-overlay"
      data-active-tab-id={activeTabId}
      data-line-count={paths.length}
      width="100%"
      height="100%"
      preserveAspectRatio="none"
      className="absolute inset-0 z-10 pointer-events-none"
      aria-hidden="true"
    >
      {paths.map((p) => (
        <path
          key={p.key}
          data-testid="citation-overlay-line"
          d={buildPathD(p)}
          stroke="hsl(var(--brand-300))"
          strokeWidth={1.5}
          strokeOpacity={0.6}
          fill="none"
        />
      ))}
    </svg>
  )
}