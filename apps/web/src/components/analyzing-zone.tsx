'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deriveProducts,
  countCitationsByDoc,
  collectCitationRefs,
  ANALYSIS_SESSION_ANGLE_META,
  type AnalysisSession,
  type AnalysisSessionAngle,
  type AnalyzingChunk,
  type AnalyzingData,
  type AnalyzingProductGroup,
  type AnalyzingStats,
  type SourceRef,
} from '@/lib/analyzing'
import type { ProductChange } from '@/lib/products'
import { updateProduct } from '@/lib/products-actions'
import { useMediaQuery } from '@/lib/use-media-query'
// 注:ThinkingStream 组件本身已不再导入(ADR-0017 D1 · ticket 02):
// 左栏"思考流"UI 删,phase state machine 内部状态保留(供未来 StatusBar/插话)。
import { EmptyState } from './empty-state'
import { AnalysisSkillSelector } from './analysis-skill-selector'
import { SessionTabs } from './session-tabs'
import type { ThinkingPhase } from './thinking-stream'
import { ProductList, type CitationSourceOption } from './product-list'
import { TechBriefPanel } from './tech-brief-panel'
import { ToastHost } from './toast-host'
import type { ToastItem } from './toast'
import {
  DocumentReaderPane,
  PRD_TAB_ID,
} from './document-reader-pane'
import {
  startAnalysis,
  StartAnalysisError,
  type StartAnalysisSuccess,
} from '@/lib/analysis-start'

/**
 * 「开始分析」按钮流式状态(issue 01 · ADR-0021 改造):在父组件
 * AnalyzingZone 维护,传给按钮组件。
 *
 *   idle     → 「▶ 开始分析」可点击
 *   starting → POST 在路上;切"分析中…",disabled 防重
 *   running  → POST 201 已返,SSE 在推;disabled(等 analysis_done 事件复位)
 */
type StartAnalysisState = 'idle' | 'starting' | 'running'

/**
 * ANALYZING 工位组件(ADR-0011 §6 ANALYZING 布局 · issue 19)
 *
 * 视觉对照基线:
 * - [11e-stage-adaptive-analyzing.html](../../../../docs/design/pages/11e-stage-adaptive-analyzing.html)(原"观察屏")
 * - [11h-A-zone-multisession-tabs.html](../../../../docs/design/pages/11h-A-zone-multisession-tabs.html)(多会话 Tab,VS3 基线)
 *
 * 桌面布局(ADR-0017 D1 · ticket 02 —— 2:1 左右分栏,删 ThinkingStream;min-width ≥ 1024px):
 * ┌────────────────────────────────────────────────┐
 * │ Stage strip(ANALYZING 徽章 + 进度 + 状态)       │
 * ├────────────────────────────────────────────────┤
 * │ 准入仪表板(19a · ADR-0013 D4 · 全局共享)        │
 * ├────────────────────────────────────────────────┤
 * │ SessionTabs(19c · ADR-0013 D7 · 多会话 Tab)    │
 * ├──────────────── 2 份 ──────────────┬─── 1 份 ────┤
 * │ 📑 DocumentReaderPane               │ Summary     │
 * │ [PRD · 🔗 N][aux.md · 🔗 N]...     ├─────────────┤
 * │                                    │ ProductList │
 * │ <MarkdownPreview body>             │ 🎯 识别产物  │
 * ├────────────────────────────────────┴─────────────┤
 * └────────────────────────────────────────────────┘
 *
 * 窄视口布局(ticket 05 · max-width < 1024px —— 候选 A):
 * - 检测 `useMediaQuery('(min-width: 1024px)')` → false 时切到窄视口形态
 * - 主区顶部加 `<div role="tablist" data-testid="analyzing-narrow-tabs">` 两个 Tab:
 *   📑 文档 / 🎯 产物(默认 active = "产物",产物是用户主要看的)
 * - 选中"产物" → 隐藏 DocumentReaderPane,只渲染 Summary + ProductList(全宽)
 * - 选中"文档" → 渲染 DocumentReaderPane 全宽;Summary + ProductList 隐藏
 * - Tab 切换无动画(避免窄屏滚动性能问题)
 *
 * 联动行为(ticket 03 · 跨窄/桌面形态一致):
 * - 点右栏产物卡片:窄视口下自动切到"文档" Tab + 左栏切 AuxFile Tab + pulse 1.5s;
 *   桌面形态下不变(直接切左栏 Tab + pulse,窄 Tab 不动)
 *
 * 设计要点:
 * - 'use client':打字机 / SSE 订阅 / Tab 切换都是客户端交互
 * - props.data 由 server 注入(从 getAnalyzingData),组件只关心渲染 + 客户端状态
 * - **ADR-0017 D1**:主区改为 2:1 左右分栏;左栏 = `<DocumentReaderPane>`,右栏 = Summary + ProductList
 * - **ADR-0017 D1**:`<ThinkingStream>` 渲染出口删除;phase state machine 内部状态保留
 * - **ticket 05 窄视口**:见上方"窄视口布局"段;响应式断点统一走 CSS `min-width: 1024px`
 * - 打字机 20ms / 字(issue 19 验收 #2);chunk 间 200ms 间隔,模拟"思考停顿"
 * - SSE 订阅 `/api/requirement/<id>/events` —— 收到 `analysis_chunk` 事件追加到 chunks
 * - VS3 新增:
 *   - 渲染 SessionTabs(sessions / activeId / onSwitch / onCreate / onClose)
 *   - 切换 Tab 时主区 chunks 按 activeSessionId 重新加载;打字机独立工作
 *   - activeId 默认 = props.data.activeSessionId(cookie `last_session_id` 决定,见 server)
 *
 * 状态机(single source of truth,避免 batching 双状态同步问题):
 *   idle     — 还没开始打字
 *   typing   — 正在打 chunkIndex 这条(已显示 typedLen 个字符)
 *   pausing  — 当前 chunk 完成,等 200ms 后推进到下一条
 *   done     — 所有 chunks 都完成(phase 内部态;不再有 UI 弹窗)
 */
export interface AnalyzingZoneProps {
  data: AnalyzingData
}

const TYPEWRITER_INTERVAL_MS = 20
const INTER_CHUNK_PAUSE_MS = 200

/** 客户端 cookie 名:上次 active session id(SSR 通过 cookies() 注入 lastSessionId) */
const LAST_SESSION_COOKIE = 'last_session_id'
/** cookie 持久化周期:1 年(与既有 cookie 行为一致) */
const LAST_SESSION_COOKIE_MAX_AGE = 31_536_000

/**
 * 把 active session id 写到 cookie,供下次 SSR 兜底默认值。
 * 浏览器侧专属:服务端路径走过 `cookies()` 直接 set。
 */
function setLastSessionCookie(id: string): void {
  if (typeof document === 'undefined') return
  document.cookie = `${LAST_SESSION_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${LAST_SESSION_COOKIE_MAX_AGE}; samesite=lax`
}

/** SSE 端点路径(同 apps/agent/src/sse/requirementEventsRoute.ts) */
function sseUrl(requirementId: string): string {
  return `/api/requirement/${requirementId}/events`
}

/** 在派生产物三桶中按 id 查找单条产物(点击卡片联动左栏用) */
function findProductById(
  products: AnalyzingProductGroup,
  id: string,
): AnalyzingProductGroup['subproblems'][number] | null {
  for (const group of [products.subproblems, products.risks, products.options]) {
    const hit = group.find((it) => it.id === id)
    if (hit) return hit
  }
  return null
}

/**
 * 比较两个 SourceRef 是否指向同一出处(用于反向联动反查 productId)。
 *
 * 规则:
 * - kind 必须相同
 * - prd / aux:lineRange 起止完全相等
 * - aux:auxId 必须相等(同名 aux 不一定有相同行)
 * - asset:assetId 必须相等
 */
function isSameSourceRef(a: SourceRef, b: SourceRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'asset' && b.kind === 'asset') {
    return a.assetId === b.assetId
  }
  if (a.kind === 'aux' && b.kind === 'aux') {
    return (
      a.auxId === b.auxId &&
      a.lineRange[0] === b.lineRange[0] &&
      a.lineRange[1] === b.lineRange[1]
    )
  }
  if (a.kind === 'prd' && b.kind === 'prd') {
    return a.lineRange[0] === b.lineRange[0] && a.lineRange[1] === b.lineRange[1]
  }
  return false
}

export function AnalyzingZone({ data }: AnalyzingZoneProps) {
  // 二态分支(issue: ANALYZING 工位改造 · 直接进入主区)
  // - empty:  requirement.md 不存在 → 引导去 DRAFTING(老契约)
  // - active: requirement.md 存在 → 走主区;fs 上是否有 sessions 都直接进,
  //           主区组件对 chunks=[] / sessions=[] 已做容错(显示"暂无思考流"等)
  //
  // `data.empty === true` 是老契约兜底(老测试 spread emptyAnalyzing() 改
  // empty: false 但 phase 仍 'empty' 的兼容场景)
  if (data.empty) {
    return <EmptyAnalyzing data={data} />
  }
  return <AnalyzingContent data={data} />
}

// ============================================================================
// 空态(同 EXECUTING 模式:引导去 DRAFTING 写 PRD)
// ============================================================================

function EmptyAnalyzing({ data }: { data: AnalyzingData }) {
  return (
    <main
      data-testid="analyzing-zone"
      data-requirement-id={data.requirementId}
      data-empty="true"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="🔍"
          title="ANALYZING 工位暂无内容"
          subtitle="这个需求还没有可分析的内容。先去 DRAFTING 工位写需求文档,完成后系统会自动启动 AI 分析并显示在这里。"
          cta={{
            label: '→ 进入 DRAFTING 工位',
            href: `/requirements/${data.requirementId}/drafting`,
          }}
        />
      </div>
    </main>
  )
}

// ============================================================================
// 主内容:Stage + 准入仪表板 + SessionTabs + Summary + 打字机
// ============================================================================

function AnalyzingContent({ data }: { data: AnalyzingData }) {
  const [phase, setPhase] = useState<ThinkingPhase>({ kind: 'idle' })
  // issue 01 · ADR-0021:已删除旧"verdictOverride" + "接受风险"按钮
  // —— ANALYZING 工位不再表达"准入通过/待裁决/失败"verdict;
  // Analysis Run 的状态由 Run 自身 status (running / succeeded / failed) 表达,
  // 本 issue 仅引入 Analysis Skill 单选器,verdict 状态机待 ticket 02+ 改造。

  // -------------------------------------------------------------------------
  // 多会话状态(issue 19c VS3 · ADR-0013 D7)
  // - sessions:完整会话列表(本 slice 仅前端 mock;后端落盘推迟到 VS5)
  // - activeSessionId:当前 active 会话 id(初始来自 server)
  // - chunksBySessionId:每个会话的 chunks map(mock 简化版:所有会话共用 data.chunks)
  // -------------------------------------------------------------------------
  // ticket 05 · ADR-0020 D9:不做"空 sessions 自动塞 default"兜底 —— 让
  // `sessions.length === 0` 在 disk 空时真实可达。
  // ticket 08 (ADR-0020 D2/D9 修订 · 2026-07-28):按钮常驻,这条兜底约束
  // 的"否则按钮永不显示"前提已失效,但"不做默认兜底"契约保留 —— 它仍是
  // audit-2026-07-26 #1 的修复(避免 loader 合成默认会话骗 SSR 数据)。
  // Sessions 由用户主动创建(POST start / onCreate)或由 SSR 注入。
  const [sessions, setSessions] = useState<AnalysisSession[]>(data.sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(
    data.activeSessionId || sessions[0]?.id || '',
  )

  // -------------------------------------------------------------------------
  // chunks 客户端副本 — SSE 推送的新 chunk 会被追加到这里
  // 初始值用 server 注入的 data.chunks(对应当前 active 会话);reset 时回到起点
  //
  // VS3 多会话(MOCK 局限):为简化本 slice 的 UI 实现,所有会话初始化时共用
  // data.chunks 的副本(真实 D7 要求"每 session 是独立对话流 + 自己的 chunks
  // jsonl",本 slice 仅前端 mock,后端落盘推迟到 VS5 与 sessions 持久化一并接入)。
  // SSE 推送时仅追加到 active 会话;新建会话初始化为 []。
  //
  // ticket 05 · 读路径 fallback:有 sessions 时读对应 entry;无 sessions / 无匹配
  // entry 时直接用 `data.chunks` —— 这让"raw chunks 已存在但还未 mock 进任一会话"
  // 的状态(以及 ticket 03 fixture 化后的 `[makeLinkedData]` 测试)能继续渲染。
  // -------------------------------------------------------------------------
  const [chunksBySessionId, setChunksBySessionId] = useState<Record<string, AnalyzingChunk[]>>(
    () => {
      const map: Record<string, AnalyzingChunk[]> = {}
      for (const s of sessions) map[s.id] = data.chunks
      return map
    },
  )
  const chunks = chunksBySessionId[activeSessionId] ?? data.chunks
  const setChunks = useCallback(
    (updater: AnalyzingChunk[] | ((prev: AnalyzingChunk[]) => AnalyzingChunk[])) => {
      setChunksBySessionId((prev) => {
        const current = prev[activeSessionId] ?? data.chunks
        const next = typeof updater === 'function' ? updater(current) : updater
        return { ...prev, [activeSessionId]: next }
      })
    },
    [activeSessionId],
  )

  // -------------------------------------------------------------------------
  // 窄视口断点 + 窄视口 Tab(ticket 05 · ADR-0017 窄视口 UX · 候选 A)
  // - isDesktop = true ⇒ 主区仍走 2:1(走下面 <div data-testid="analyzing-grid">)
  // - isDesktop = false ⇒ 主区走窄视口 Tab:
  //     * narrowTab='products'(默认) ⇒ 只渲染 Summary + ProductList
  //     * narrowTab='doc'             ⇒ 只渲染 DocumentReaderPane 全宽
  //   顶部两个 Tab(📑 文档 / 🎯 产物)用于切换
  // - 联动行为:点右栏产物卡片 → 窄视口下自动 narrowTab='doc' + DocumentReader
  //   切 Tab + pulse(联动本身在 handleItemClick 已设 pulseRef;此处仅切 narrowTab)
  // -------------------------------------------------------------------------
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [narrowTab, setNarrowTab] = useState<'doc' | 'products'>('products')

  // -------------------------------------------------------------------------
  // 画线联动状态(ticket 03 · ADR-0017 D4)
  // - activeSourceRef:当前联动的 source_ref(点右栏卡片设置)
  // - pulseRef:传给左栏阅读器触发切 Tab + 滚 + pulse;1.5s 后清空
  // - toasts:无出处等提示
  //
  // ticket 07 扩展(ADR-0018 D3):pulseRef 类型 union 化,新增 `{ productId }` 分支
  // 用于反向联动"点左栏 span → 滚右栏 product 卡片 + pulse"。DocumentReaderPane
  // 用 `if ('tabId' in pulseRef)` 守卫过滤 `{ productId }`(行级联动由 DocumentReaderPane
  // 消费;产品卡片 pulse 由 ProductList 消费)。
  // -------------------------------------------------------------------------
  type PulseRefState =
    | { tabId: string; lineRange: readonly [number, number] }
    | { productId: string }
    | null
  const [activeSourceRef, setActiveSourceRef] = useState<SourceRef | null>(null)
  const [pulseRef, setPulseRef] = useState<PulseRefState>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const pulseTimerRef = useRef<number | null>(null)
  const toastSeqRef = useRef(0)

  const pushToast = useCallback(
    (message: string, tone: ToastItem['tone']) => {
      const id = `toast-${toastSeqRef.current++}`
      setToasts((prev) => [...prev, { id, message, tone, durationMs: 3000 }])
    },
    [],
  )
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // -------------------------------------------------------------------------
  // 「开始分析」状态机(issue 01 · ADR-0021 改造)
  // - startState: 'idle' | 'starting' | 'running'
  //   - idle     → 「▶ 开始分析」可点击
  //   - starting → POST 在路上;切"分析中…",disabled 防重
  //   - running  → POST 201 已返,SSE 在推;disabled(等 analysis_done 事件复位)
  //
  // 幂等守卫 `startState !== 'idle'` 直接 return,确保流式期间/并发点击
  // 不重复 POST;running → idle 由下方 SSE EventSource 监听
  // `'analysis_done'` 命名事件触发(agent 端 turn-done 时 publish)。
  // -------------------------------------------------------------------------
  const [startState, setStartState] = useState<StartAnalysisState>('idle')

  // 当前选中的 Skill(issue 01 · ADR-0021)
  // - 初始值 = SSR 注入的 selectedSkillName
  // - 用户点选 → AnalysisSkillSelector 乐观切 + PUT 写盘
  // - handleStart 读这里得到本次 run 用的 Skill 名(issue 01 PRD §9 待续:
  //   ticket 02+ 会把 skill_name 传给 start handler;本期为最小实现,先
  //   保留本地 state,作为未来调用方的入参源)
  const [currentSelectedSkill, setCurrentSelectedSkill] = useState<string>(
    data.selectedSkillName,
  )
  // 同步 SSR 注入值(切需求时 props.selectedSkillName 变化)
  if (currentSelectedSkill !== data.selectedSkillName && startState === 'idle') {
    setCurrentSelectedSkill(data.selectedSkillName)
  }

  const handleStart = useCallback(async () => {
    // ticket 08 幂等守卫:流式期间 disabled 是主防线,但 onClick 仍可能被
    // 键盘回车 / dev HMR 瞬态 disabled 丢失触发;提前 return 保安全。
    if (startState !== 'idle') return
    // 校验:无可用 Skill(issue 01 acceptance 8:不允许用非法 Skill 启动)
    if (data.availableSkills.length === 0 || currentSelectedSkill === '') {
      pushToast('暂无可用 Analysis Skill,无法开始分析', 'err')
      return
    }
    setStartState('starting')
    // 默认首个会话 = 架构(ticket 05 spec 默认;UI 层暂无角度选择 — 产品层
    // 后续 PR 由产品决定是否暴露角度选择)。label 派生自
    // ANALYSIS_SESSION_ANGLE_META,避免与 agent 端 default 重复字面量。
    const startAngle: AnalysisSessionAngle = 'architecture'
    const startLabel = ANALYSIS_SESSION_ANGLE_META[startAngle].label
    let success: StartAnalysisSuccess
    try {
      success = await startAnalysis(data.requirementId, {
        angle: startAngle,
        label: startLabel,
      })
    } catch (err) {
      // 失败路径:toast 提示 + 状态回滚到 idle,允许用户重试
      if (err instanceof StartAnalysisError) {
        if (err.code === 'prd_not_ready') {
          pushToast('PRD 未就绪,请先完成 DRAFTING 工位的需求文档', 'warn')
        } else {
          pushToast(`开始分析失败:${err.message}`, 'err')
        }
      } else {
        pushToast(
          `开始分析失败:${err instanceof Error ? err.message : String(err)}`,
          'err',
        )
      }
      setStartState('idle')
      return
    }

    // 成功路径:乐观追加 session + 切 active(button 因 showStartButton=true
    // 仍显示,但 disabled 因 startState='running')。SSE 推过来的 chunks 通过
    // 既有 EventSource 订阅进入 chunksBySessionId;turn-done 时 agent 端
    // publish `analysis_done` 事件,本组件下方监听 → setStartState('idle')。
    const newSession: AnalysisSession = {
      id: success.sessionId,
      label: startLabel,
      angle: startAngle,
      detectedCount: 0,
      isStreaming: true,
    }
    setSessions((prev) => {
      // 防御:防重 → 避免 startState=running 时用户再点(若偶尔冒出)
      if (prev.some((s) => s.id === newSession.id)) return prev
      return [...prev, newSession]
    })
    setChunksBySessionId((prev) => ({ ...prev, [newSession.id]: [] }))
    setActiveSessionId(newSession.id)
    setPhase({ kind: 'idle' })
    setLastSessionCookie(newSession.id)
    // 标记 running;按钮 disabled 至 SSE analysis_done 事件触发复位
    setStartState('running')
  }, [
    data.requirementId,
    data.availableSkills.length,
    currentSelectedSkill,
    pushToast,
    startState,
  ])

  // 主区滚动位置持久化已删(ADR-0019 D4):analyzing-main 改为 overflow-hidden 后
  // 外层不再滚动,mainScrollRef / scrollStorageKey / sessionStorage 全部为死代码。
  // ticket 09 撤回 CitationOverlay 后:
  //   docPaneRef / productListRef 仍保留,服务反向联动 handleSourceRefClick
  //   (点左栏 <mark> → 滚右栏 product 卡片 + pulse)。productListRef 还绑到
  //   ProductList 根容器,ProductList 内部 `<div data-testid="product-list"
  //   ref={containerRef}>` 用于 querySelector 找 `[data-product-id]` 滚到视野中央。
  const docPaneRef = useRef<HTMLDivElement>(null)
  const productListRef = useRef<HTMLDivElement>(null)

  // 当 props.data.chunks 变化(SSR re-render / 路由切换)时,重新同步 active 会话 chunks
  const lastSyncedDataRef = useRef(data.chunks)
  useEffect(() => {
    if (lastSyncedDataRef.current !== data.chunks) {
      lastSyncedDataRef.current = data.chunks
      setChunksBySessionId((prev) => ({ ...prev, [activeSessionId]: data.chunks }))
    }
  }, [data.chunks, activeSessionId, setChunks])

  // -------------------------------------------------------------------------
  // SSE 订阅(issue 19b D2 ② 插话后 AI 推送新 chunk · ticket 08 扩展
  // `analysis_done` 监听用于 startState 复位)
  // 用 EventSource 订阅 /api/requirement/<id>/events,监听 **命名事件**
  // 'analysis_chunk' / 'analysis_done'(服务端 publish 走 `event: <type>\ndata: ...`,
  // 命名事件不会触发 EventSource 默认的 'message' 监听)
  //
  // ticket 08:agent 端 turn-done 时 publish `analysis_done`(reqId/sessionId/turn),
  // 本监听仅在 payload.sessionId 与当前 activeSessionId 匹配时复位 startState —
  // 避免后台其它 session 完成时误复位"最近一次点击"造成的 running 状态。
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const es = new EventSource(sseUrl(data.requirementId))
    const onAnalysisChunk = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as { type?: string; chunk?: AnalyzingChunk }
        if (parsed.chunk) {
          setChunks((prev) => {
            // 去重:同一 chunk.id 不重复追加(SSE 可能重发)
            if (prev.some((c) => c.id === parsed.chunk!.id)) return prev
            return [...prev, parsed.chunk!]
          })
        }
      } catch {
        /* ignore malformed event */
      }
    }
    const onAnalysisDone = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as { sessionId?: string; turn?: 1 | 2 }
        // 仅复位与当前 active session 匹配的 done;否则后台 session 完成会
        // 误清掉"最近一次点击"造成的 running 状态
        if (!parsed.sessionId || parsed.sessionId !== activeSessionId) return
        setStartState('idle')
      } catch {
        /* ignore malformed event */
      }
    }
    es.addEventListener('analysis_chunk', onAnalysisChunk)
    es.addEventListener('analysis_done', onAnalysisDone)
    es.addEventListener('error', () => {
      /* browser will auto-reconnect; nothing to do */
    })
    return () => {
      es.removeEventListener('analysis_chunk', onAnalysisChunk)
      es.removeEventListener('analysis_done', onAnalysisDone)
      es.close()
    }
  }, [data.requirementId, setChunks, activeSessionId])

  const totalChunks = chunks.length
  const products = deriveProducts(chunks)
  const citationRefs = collectCitationRefs(chunks)
  // AddDialog "关联出处" 下拉的候选文档(ADR-0017 D6):PRD(非空时)+ 全部 AuxFile
  const citationSources: CitationSourceOption[] = [
    ...(data.prdMarkdown.trim().length > 0
      ? [{ value: 'prd', label: 'PRD 需求文档', kind: 'prd' as const }]
      : []),
    ...data.auxFiles.map((aux) => ({
      value: aux.id,
      label: aux.filename,
      kind: 'aux' as const,
      auxId: aux.id,
    })),
  ]
  // AdmissionDashboard / 五维卡 / verdict 派生已删除(issue 01 · ADR-0021)
  // —— ANALYZING 工位不再表达"准入通过/待裁决/失败"verdict。
  // 旧的 `derivedAdmission` / `currentAdmission` 已被 Analysis Skill 单选器替代。
  // 若 ticket 02+ 仍需要从 chunks 派生 verdict,再以 useMemo 形式按需复活。

  // -------------------------------------------------------------------------
  // 点击右栏产物卡片 → 联动左栏(ticket 03 · ADR-0017 D4)
  // - 取首个 source_ref;无 → toast "未关联原文出处"
  // - prd → tabId='prd';aux → tabId=auxId;asset(无 lineRange)→ 仅记 activeSourceRef
  // - 设 pulseRef 触发左栏切 Tab + 滚 + pulse;1.5s 后清 pulseRef
  // -------------------------------------------------------------------------
  const handleItemClick = useCallback(
    (itemId: string) => {
      const item = findProductById(products, itemId)
      const ref = item?.source_refs?.[0]
      if (!ref) {
        pushToast('⚠️ 该产物未关联原文出处', 'warn')
        return
      }
      setActiveSourceRef(ref)
      if (ref.kind === 'asset') {
        // asset 无行范围:切到 PRD(资产内联在 PRD)但不做行级 pulse
        // 窄视口下也切到文档阅读器(让用户看到 asset 高亮)
        if (!isDesktop) setNarrowTab('doc')
        return
      }
      const tabId = ref.kind === 'aux' ? ref.auxId : PRD_TAB_ID
      // 用新对象触发左栏 effect(即使 lineRange 相同也重跑)
      setPulseRef({ tabId, lineRange: ref.lineRange })
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = window.setTimeout(() => setPulseRef(null), 1500)
      // ticket 05 · 联动在窄视口下自动切到"文档" Tab(让用户看到 pulse 高亮)
      if (!isDesktop) setNarrowTab('doc')
    },
    [products, pushToast, isDesktop],
  )

  // -------------------------------------------------------------------------
  // 反向联动(ticket 07 · ADR-0018 D3 · ADR-0017 D4 v2 补齐)
  // - DocumentReaderPane 通过 onSourceRefClick(ref) 通知父组件
  // - 父组件通过 source_refs 反查 productId(每条 source_ref 来自唯一 chunk,见
  //   ADR-0017 D3 lineRange 指向唯一性)
  // - 设 pulseRef = { productId },触发右栏产品卡片 pulse 1.5s
  // - 同时 scrollIntoView 把对应产品卡片滚到视野中央(避免卡片在视口外 pulse
  //   用户看不到)
  // - asset ref 不画线(SVG 端点跳过);本路径只走 prd / aux 的反向联动
  // - onSourceRefClick 签名含 `SourceRef | null`(组件接口位保留);null 走 no-op
  // -------------------------------------------------------------------------
  const handleSourceRefClick = useCallback(
    (ref: SourceRef | null) => {
      if (!ref) return
      // 反查 productId:遍历当前 chunks,找到第一个 source_ref 与 ref 匹配的 chunk
      const hit = chunks.find((c) =>
        c.source_refs?.some((r) => isSameSourceRef(r, ref)),
      )
      if (!hit) return
      // 设 pulseRef 触发 ProductList 卡片 pulse
      setPulseRef({ productId: hit.id })
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = window.setTimeout(() => setPulseRef(null), 1500)
      // 滚对应 product 卡片到视野中央
      // (跨 microtask 等 React commit 完成,DOM 已挂载新 product 时再查)
      if (typeof window === 'undefined') return
      window.requestAnimationFrame(() => {
        const card = productListRef.current?.querySelector<HTMLElement>(
          `[data-product-id="${CSS.escape(hit.id)}"]`,
        )
        if (card && typeof card.scrollIntoView === 'function') {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
    },
    [chunks],
  )

  // 卸载清 pulse 计时器
  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
    }
  }, [])

  // -------------------------------------------------------------------------
  // 打字机推进(state machine,useEffect 唯一驱动)
  // 注意:依赖 chunks(而非 data.chunks),因为 chunks 是客户端可变副本
  // 切换会话时 chunks 数组引用变化 → 重置 phase 从 idle 开始,打字机独立工作
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase.kind === 'idle') {
      const first = chunks[0]
      if (!first) {
        setPhase({ kind: 'done' })
        return
      }
      setPhase({ kind: 'typing', chunkIndex: 0, typedLen: 1 })
      return
    }

    if (phase.kind === 'typing') {
      const chunk = chunks[phase.chunkIndex]
      if (!chunk) {
        setPhase({ kind: 'done' })
        return
      }
      if (phase.typedLen < chunk.text.length) {
        const id = window.setTimeout(() => {
          setPhase((p) => {
            if (p.kind !== 'typing') return p
            const c = chunks[p.chunkIndex]
            if (!c) return { kind: 'done' }
            if (p.typedLen >= c.text.length) return p
            return { ...p, typedLen: p.typedLen + 1 }
          })
        }, TYPEWRITER_INTERVAL_MS)
        return () => window.clearTimeout(id)
      }
      const id = window.setTimeout(() => {
        setPhase({ kind: 'pausing', chunkIndex: phase.chunkIndex, typedLen: chunk.text.length })
      }, INTER_CHUNK_PAUSE_MS)
      return () => window.clearTimeout(id)
    }

    if (phase.kind === 'pausing') {
      const id = window.setTimeout(() => {
        const nextIndex = phase.chunkIndex + 1
        if (nextIndex >= chunks.length) {
          setPhase({ kind: 'done' })
        } else {
          setPhase({ kind: 'typing', chunkIndex: nextIndex, typedLen: 1 })
        }
      }, INTER_CHUNK_PAUSE_MS)
      return () => window.clearTimeout(id)
    }
  }, [phase, chunks])

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------
  const reset = useCallback(() => {
    setPhase({ kind: 'idle' })
  }, [])

  const skipTypewriter = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== 'typing') return p
      const chunk = chunks[p.chunkIndex]
      if (!chunk) return p
      if (p.typedLen >= chunk.text.length) return p
      return { ...p, typedLen: chunk.text.length }
    })
  }, [chunks])

  // -------------------------------------------------------------------------
  // 产物变更(issue 19d VS4):Server Action updateProduct → 写 products.yaml →
  // revalidatePath 触发 admission / products 刷新
  // -------------------------------------------------------------------------
  const [productError, setProductError] = useState<string | null>(null)
  const handleProductAction = useCallback(
    async (change: ProductChange) => {
      setProductError(null)
      const result = await updateProduct(data.requirementId, activeSessionId, change)
      if (!result.ok) {
        setProductError(result.error)
      }
    },
    [data.requirementId, activeSessionId],
  )

  // -------------------------------------------------------------------------
  // Synthetic chunk 合成(ADR-0017 D6 · ticket 04):用户在 ProductList 加 product 时,
  // ProductList 合成一条 synthetic chunk 通知这里 → 落到当前 active 会话的
  // chunksBySessionId(chunks.jsonl 单一真相源)。
  //
  // 本期仅客户端 memory:不推 SSE(本地合成),也不落盘(server action 留 v2);
  // 刷新页面后 synthetic 卡片丢失是已知代价(UI 角标说明)。
  // -------------------------------------------------------------------------
  const handleAddSyntheticChunk = useCallback(
    (chunk: AnalyzingChunk) => {
      setChunksBySessionId((prev) => ({
        ...prev,
        [activeSessionId]: [...(prev[activeSessionId] ?? []), chunk],
      }))
    },
    [activeSessionId],
  )

  // -------------------------------------------------------------------------
  // SessionTabs 回调(issue 19c VS3)
  // -------------------------------------------------------------------------

  /** 切换会话:切换 activeSessionId + 重置打字机 phase + 写 last_session_id cookie。
   * 打字机 phase 必须重置(切换后会话的 chunks 长度/内容不同)。
   * 滚动位置持久化已删(ADR-0019 D4:主区 overflow-hidden 后外层不再滚动)。 */
  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) return
      setActiveSessionId(sessionId)
      // 重置打字机 phase(切换后会话的 chunks 长度/内容不同,phase 必须重置)
      setPhase({ kind: 'idle' })
      // 写入 cookie `last_session_id`,下次 SSR 默认值
      setLastSessionCookie(sessionId)
    },
    [activeSessionId],
  )

  /** 新建会话:追加到列表末尾,自动切到该会话 */
  const handleCreateSession = useCallback(
    (params: { label: string; angle: AnalysisSessionAngle }) => {
      // 本 slice 仅前端 mock:生成稳定 id 后追加 + 切到新会话
      // 后端落盘推迟到 VS5(analysis/sessions/_index.yaml 写入)
      const newId = `sess-${params.angle}-${Date.now().toString(36)}`
      const newSession: AnalysisSession = {
        id: newId,
        label: params.label,
        angle: params.angle,
        detectedCount: 0,
        isStreaming: false,
      }
      setSessions((prev) => [...prev, newSession])
      // 新会话初始 chunks = 空数组(与 empty 数据一致)
      setChunksBySessionId((prev) => ({ ...prev, [newId]: [] }))
      // 直接切到新会话(不调用 handleSwitchSession,因为旧会话无需存滚动位置)
      setActiveSessionId(newId)
      setPhase({ kind: 'idle' })
      setLastSessionCookie(newId)
    },
    [],
  )

  /** 关闭会话:从 sessions 中移除 + chunks map 中清理 + 自动切到邻居 */
  const handleCloseSession = useCallback(
    (sessionId: string) => {
      if (sessions.length <= 1) return // 最后一个 Tab 不可关闭
      const idx = sessions.findIndex((s) => s.id === sessionId)
      if (idx < 0) return
      const nextSessions = sessions.filter((s) => s.id !== sessionId)
      setSessions(nextSessions)
      // 清理 chunks map(滚动位置持久化已删 · ADR-0019 D4)
      setChunksBySessionId((prev) => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      // 如果关闭的就是 active → 切到邻居(关闭非首项用左邻居,关闭首项用新首项)
      if (activeSessionId === sessionId) {
        const neighborIdx = idx === 0 ? 0 : idx - 1
        const neighbor = nextSessions[neighborIdx]
        setActiveSessionId(neighbor.id)
        setPhase({ kind: 'idle' })
        setLastSessionCookie(neighbor.id)
      }
    },
    [sessions, activeSessionId],
  )

  // 派生:当前 chunk 已揭示的 chunk 数(包含正在打字的 chunk)
  const revealedCount =
    phase.kind === 'idle'
      ? 0
      : phase.kind === 'done'
        ? totalChunks
        : phase.chunkIndex + 1

  return (
    // ADR-0019 D1/D2 真实生效前提:主区必须有**确定高度**,内部列 body 的
    // overflow-auto 才会触发(祖先 ZoneShell 用 min-h-[calc(100vh-84px)] 不是
    // 确定高度 → h-full 在 grid 里退化成内容高度 → 整页外滚)。这里直接取
    // "视口高 - 上方固定条(StatusBar h-10 + ZoneBar h-11 = 84px,见
    // ZoneShell.WORKSPACE_SHELL_OFFSET_PX)" 作为主区确定高度,打破循环依赖。
    <main
      data-testid="analyzing-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      data-phase={data.phase}
      className="flex flex-col h-[calc(100vh-84px)] overflow-hidden bg-bg-elevated"
    >
      <StageStrip
        totalChunks={totalChunks}
        revealedCount={revealedCount}
        isStreaming={data.streamMeta.isStreaming}
      />
      {/* issue 01 · ADR-0021:原 Admission Dashboard(五维卡 + verdict + 待裁决)
          被 Analysis Skill 单选器替代,只展示名称 / 功能简介 / 选中状态。
          「开始分析」按钮常驻,availableSkills.length === 0 时禁用(issue 01
          acceptance 8:不允许用非法 Skill 启动)。 */}
      <div className="px-6 pt-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <AnalysisSkillSelector
            requirementId={data.requirementId}
            availableSkills={data.availableSkills}
            selectedSkillName={data.selectedSkillName}
            onSelectionChange={(name) => {
              // 同步到顶层 state,以便 handleStart 拿最新值
              setCurrentSelectedSkill(name)
            }}
            onError={(message) => pushToast(message, 'err')}
          />
        </div>
        <StartAnalysisButton
          state={startState}
          disabled={data.availableSkills.length === 0}
          onClick={handleStart}
        />
      </div>
      {/* issue 19c VS3 — 多会话 Tab(横向浏览器风格,主区按 activeSessionId 切换)
          + issue 19e VS5 — 技术概要面板(右对齐,与 Tabs 同行) */}
      <div className="mt-3 px-6 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <SessionTabs
            sessions={sessions}
            activeId={activeSessionId}
            onSwitch={handleSwitchSession}
            onCreate={handleCreateSession}
            onClose={handleCloseSession}
          />
        </div>
        <TechBriefPanel
          requirementId={data.requirementId}
          sessionId={activeSessionId}
          preview={data.techBriefPreview}
          modulesPreview={data.modulesPreview}
          generatedAt={data.briefGeneratedAt}
        />
      </div>
      <div
        data-testid="analyzing-main"
        data-active-session-id={activeSessionId}
        data-layout={isDesktop ? 'doc-reader-2-1' : 'narrow-tabs'}
        className="flex-1 min-h-0 overflow-hidden px-6 py-6 flex flex-col gap-5"
      >
        {/* 主区内容 — 桌面 = 2:1 分栏;窄视口 = 顶部 Tab + 单栏切换(ticket 05) */}
        {isDesktop ? (
          <div
            data-testid="analyzing-grid"
            data-viewport="desktop"
            className="relative grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0 overflow-hidden"
          >
            <div
              data-testid="analyzing-left-col"
              className="col-span-1 lg:col-span-2 flex flex-col min-h-0 relative overflow-hidden"
            >
              <DocumentReaderPane
                prdMarkdown={data.prdMarkdown}
                auxFiles={data.auxFiles}
                assetList={data.assetList}
                citationCounts={countCitationsByDoc(chunks)}
                citationRefs={citationRefs}
                activeSourceRef={activeSourceRef}
                pulseRef={pulseRef}
                containerRef={docPaneRef}
                onSourceRefClick={handleSourceRefClick}
              />
            </div>
            <div
              data-testid="analyzing-right-col"
              className="col-span-1 flex flex-col gap-5 min-h-0 overflow-hidden"
            >
              <Summary summary={data.summary} stats={data.stats} />
              <div className="flex-1 min-h-0">
                <ProductList
                  products={products}
                  onAction={handleProductAction}
                  onItemClick={handleItemClick}
                  onAddSyntheticChunk={handleAddSyntheticChunk}
                  citationSources={citationSources}
                  pulseRef={
                    pulseRef && 'productId' in pulseRef ? pulseRef : null
                  }
                  containerRef={productListRef}
                />
              </div>
            </div>
          </div>
        ) : (
          <NarrowLayout
            data={data}
            products={products}
            chunks={chunks}
            citationSources={citationSources}
            citationRefs={citationRefs}
            activeSourceRef={activeSourceRef}
            pulseRef={pulseRef}
            onItemClick={handleItemClick}
            onProductAction={handleProductAction}
            onAddSyntheticChunk={handleAddSyntheticChunk}
            narrowTab={narrowTab}
            onNarrowTabChange={setNarrowTab}
          />
        )}
        {productError && (
          <div
            data-testid="product-error"
            role="alert"
            className="text-sm text-error bg-error/10 border border-error rounded-md px-3 py-2"
          >
            产物编辑失败:{productError}
          </div>
        )}
      </div>

      {/* 画线联动提示(ticket 03):无出处产物点击 → "未关联原文出处" toast */}
      <ToastHost items={toasts} onDismiss={dismissToast} />
    </main>
  )
}

// ============================================================================
// NarrowLayout(窄视口 · ticket 05 · ADR-0017 窄视口 UX · 候选 A)
//
// 形态:
// ┌─────────────────────────────────────────────────────────────┐
// │ [📑 文档] [🎯 产物]    ← role="tablist"                   │
// ├─────────────────────────────────────────────────────────────┤
// │ narrowTab='doc'    → DocumentReaderPane(全宽)              │
// │ narrowTab='products' → Summary + ProductList(全宽)         │
// └─────────────────────────────────────────────────────────────┘
// - 默认 active = 'products'(让用户一打开就看到产物)
// - Tab 切换无动画(避免窄屏滚动性能问题,见 ADR-0017 ticket 05)
// - 联动:handleItemClick 在父组件检测 !isDesktop → setNarrowTab('doc'),
//   此处只是被动渲染态
// ============================================================================

interface NarrowLayoutProps {
  data: AnalyzingData
  products: AnalyzingProductGroup
  /** 当前 active 会话的 chunks(ticket 01 数据契约变化,SSR 已注入 + 客户端 SSE 追加) */
  chunks: AnalyzingChunk[]
  citationSources: CitationSourceOption[]
  citationRefs: ReturnType<typeof collectCitationRefs>
  activeSourceRef: SourceRef | null
  /**
   * ticket 07(ADR-0018 D3):pulseRef 类型 union 化;DocumentReaderPane 与 ProductList
   * 各自按 `'tabId' in pulseRef` / `'productId' in pulseRef` 守卫过滤自己关心的分支。
   */
  pulseRef:
    | { tabId: string; lineRange: readonly [number, number] }
    | { productId: string }
    | null
  onItemClick: (itemId: string) => void
  onProductAction: (change: ProductChange) => Promise<void>
  onAddSyntheticChunk: (chunk: AnalyzingChunk) => void
  narrowTab: 'doc' | 'products'
  onNarrowTabChange: (tab: 'doc' | 'products') => void
}

function NarrowLayout({
  data,
  products,
  chunks,
  citationSources,
  citationRefs,
  activeSourceRef,
  pulseRef,
  onItemClick,
  onProductAction,
  onAddSyntheticChunk,
  narrowTab,
  onNarrowTabChange,
}: NarrowLayoutProps) {
  return (
    <div
      data-testid="analyzing-narrow"
      data-narrow-tab={narrowTab}
      className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden"
    >
      {/* 顶部 Tab 切换("📑 文档" / "🎯 产物") */}
      <div
        role="tablist"
        aria-label="ANALYZING 窄视口切换"
        data-testid="analyzing-narrow-tabs"
        className="flex items-center gap-1 px-1 py-1 border border-border rounded-lg bg-bg-subtle"
      >
        <button
          type="button"
          role="tab"
          data-testid="analyzing-narrow-tab-doc"
          data-tab-id="doc"
          data-active={narrowTab === 'doc' ? 'true' : 'false'}
          aria-selected={narrowTab === 'doc' ? 'true' : 'false'}
          onClick={() => onNarrowTabChange('doc')}
          className={
            narrowTab === 'doc'
              ? 'flex-1 h-9 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border flex items-center justify-center gap-1.5'
              : 'flex-1 h-9 rounded-md text-sm font-medium bg-transparent text-text-2 hover:text-text-1 flex items-center justify-center gap-1.5 border border-transparent'
          }
        >
          <span>📑</span>
          <span>文档</span>
        </button>
        <button
          type="button"
          role="tab"
          data-testid="analyzing-narrow-tab-products"
          data-tab-id="products"
          data-active={narrowTab === 'products' ? 'true' : 'false'}
          aria-selected={narrowTab === 'products' ? 'true' : 'false'}
          onClick={() => onNarrowTabChange('products')}
          className={
            narrowTab === 'products'
              ? 'flex-1 h-9 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border flex items-center justify-center gap-1.5'
              : 'flex-1 h-9 rounded-md text-sm font-medium bg-transparent text-text-2 hover:text-text-1 flex items-center justify-center gap-1.5 border border-transparent'
          }
        >
          <span>🎯</span>
          <span>产物</span>
        </button>
      </div>

      {/* 主区:根据 narrowTab 单条件渲染 */}
      <div
        data-testid="analyzing-narrow-body"
        className="flex-1 min-h-0 overflow-hidden"
      >
        {narrowTab === 'doc' ? (
          <div
            data-testid="analyzing-narrow-pane-doc"
            role="tabpanel"
            aria-labelledby="analyzing-narrow-tab-doc"
            className="h-full"
          >
            <DocumentReaderPane
              prdMarkdown={data.prdMarkdown}
              auxFiles={data.auxFiles}
              assetList={data.assetList}
              citationCounts={countCitationsByDoc(chunks)}
              citationRefs={citationRefs}
              activeSourceRef={activeSourceRef}
              pulseRef={pulseRef}
            />
          </div>
        ) : (
          <div
            data-testid="analyzing-narrow-pane-products"
            role="tabpanel"
            aria-labelledby="analyzing-narrow-tab-products"
            className="flex flex-col gap-5 h-full min-h-0"
          >
            <Summary summary={data.summary} stats={data.stats} />
            <div className="flex-1 min-h-0">
              <ProductList
                products={products}
                onAction={onProductAction}
                onItemClick={onItemClick}
                onAddSyntheticChunk={onAddSyntheticChunk}
                citationSources={citationSources}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Stage strip(顶部状态条)
// ============================================================================

function StageStrip({
  totalChunks,
  revealedCount,
  isStreaming,
}: {
  totalChunks: number
  revealedCount: number
  isStreaming: boolean
}) {
  return (
    <div
      data-testid="analyzing-stage-strip"
      className="bg-gradient-to-r from-brand-50 to-brand-50/30 border-b border-border px-6 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2 font-semibold text-md text-brand-700">
        <span
          data-testid="analyzing-stage-badge"
          className="bg-brand text-white text-xs font-medium px-2 py-0.5 rounded"
        >
          ② 分析
        </span>
        <span data-testid="analyzing-stage-title">
          ANALYZING · Thinking 形态 · 实时观察屏
        </span>
      </div>
      <div
        data-testid="analyzing-stage-meta"
        className="font-mono text-sm text-brand-600 flex items-center gap-3"
      >
        <span>
          进度{' '}
          <strong>
            {Math.min(revealedCount, totalChunks)}/{totalChunks}
          </strong>{' '}
          chunks
        </span>
        <span className="text-text-3">·</span>
        <span data-testid="analyzing-stage-status">
          {isStreaming ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
              运行中
            </span>
          ) : (
            '已暂停'
          )}
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// StartAnalysisButton(issue 01 · ADR-0021)
//
// 「开始分析」按钮 —— ticket 08 调整后改为常驻显示;
// issue 01 进一步把按钮从 AdmissionDashboard 抽出,放到 AnalysisSkillSelector
// 右侧(同 h-7 行内),与 Skill 单选器并排。
//
// 视觉:与 Skill selector 同高(h-7 ~ 28px,text-xs);brand 主色填充。
//
// 状态机(StartAnalysisState):
//   idle      → 「▶ 开始分析」,可点击
//   starting  → 「分析中…」(等待 POST 返回);disabled 防重
//   running   → 「分析中…」(POST 已返回,SSE 推 chunks);disabled(等
//                agent 端 turn-done publish `analysis_done` 命名事件 →
//                AnalyzingZone 监听 → setStartState('idle'))
//
// `disabled` prop:可由父组件控制(issue 01 acceptance 8:无可用 Skill 时
// 禁用 + toast 提示)。
//
// 幂等防线:starting/running → 按钮 disabled,onClick 不触发;
// AnalyzingZone.handleStart 内部另有 `startState !== 'idle'` 守卫。
// ============================================================================

function StartAnalysisButton({
  state,
  disabled,
  onClick,
}: {
  state: StartAnalysisState
  disabled?: boolean
  onClick?: () => void
}) {
  const isStreaming = state !== 'idle'
  const isDisabled = isStreaming || disabled
  return (
    <button
      type="button"
      data-testid="admission-start-btn"
      data-state={state}
      data-disabled={disabled ? 'no_skills' : 'ok'}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-semibold transition-colors flex-shrink-0 ${
        isDisabled
          ? 'bg-brand/50 text-white cursor-not-allowed'
          : 'bg-brand text-white hover:bg-brand-600'
      }`}
    >
      {isStreaming ? (
        <>
          <span
            aria-hidden
            data-testid="admission-start-spinner"
            className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"
          />
          分析中…
        </>
      ) : (
        <>
          <span aria-hidden>▶</span>
          开始分析
        </>
      )}
    </button>
  )
}

// ============================================================================
// Summary(图标 + 标题 + 描述 + 三 stats)
// ============================================================================

function Summary({
  summary,
  stats,
}: {
  summary: AnalyzingData['summary']
  stats: AnalyzingStats
}) {
  return (
    <div
      data-testid="analyzing-summary"
      className="bg-gradient-to-br from-brand-50 to-brand-50/40 border border-brand-50 rounded-xl px-4 py-2 flex items-center gap-3"
    >
      <div
        data-testid="analyzing-summary-icon"
        className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center text-xl flex-shrink-0 ring-2 ring-brand-50"
      >
        {summary.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="analyzing-summary-title"
          className="text-sm font-semibold text-brand-700 mb-0"
        >
          {summary.title}
        </div>
        <div className="text-text-2 text-[11px] leading-relaxed">
          {summary.description}
        </div>
      </div>
      <div data-testid="analyzing-stats" className="flex gap-2 flex-shrink-0">
        <StatCell n={stats.subproblems} label="子问题" testId="analyzing-stat-subproblems" />
        <StatCell n={stats.risks} label="风险点" testId="analyzing-stat-risks" />
        <StatCell n={stats.options} label="方案方向" testId="analyzing-stat-options" />
      </div>
    </div>
  )
}

function StatCell({
  n,
  label,
  testId,
}: {
  n: number
  label: string
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      data-n={n}
      className="text-center px-2.5 py-1 bg-bg-elevated border border-border rounded-md min-w-[52px]"
    >
      <div className="text-base font-semibold font-mono text-brand-700">{n}</div>
      <div className="text-[10px] text-text-3 uppercase tracking-wider mt-0">
        {label}
      </div>
    </div>
  )
}
