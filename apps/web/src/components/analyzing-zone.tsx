'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  deriveProducts,
  countCitationsByDoc,
  collectCitationRefs,
  type AnalysisSession,
  type AnalysisSessionAngle,
  type AnalyzingChunk,
  type AnalyzingData,
  type AnalyzingProductGroup,
  type AnalyzingStats,
  type AnalyzingToolbar,
  type AnalyzingToolbarAction,
  type AdmissionVerdict,
  type SourceRef,
} from '@/lib/analyzing'
import type { ProductChange } from '@/lib/products'
import { updateProduct } from '@/lib/products-actions'
// 注:ThinkingStream 组件本身已不再导入(ADR-0017 D1 · ticket 02):
// 左栏"思考流"UI 删,phase state machine 内部状态保留(供未来 StatusBar/插话)。
import { EmptyState } from './empty-state'
import { AdmissionDashboard } from './admission-dashboard'
import { SessionTabs } from './session-tabs'
import type { ThinkingPhase } from './thinking-stream'
import { ProductList, type CitationSourceOption } from './product-list'
import { InterjectInput } from './interject-input'
import { TechBriefPanel } from './tech-brief-panel'
import { ToastHost } from './toast-host'
import type { ToastItem } from './toast'
import {
  DocumentReaderPane,
  PRD_TAB_ID,
} from './document-reader-pane'

/**
 * ANALYZING 工位组件(ADR-0011 §6 ANALYZING 布局 · issue 19)
 *
 * 视觉对照基线:
 * - [11e-stage-adaptive-analyzing.html](../../../../docs/design/pages/11e-stage-adaptive-analyzing.html)(原"观察屏")
 * - [11h-A-zone-multisession-tabs.html](../../../../docs/design/pages/11h-A-zone-multisession-tabs.html)(多会话 Tab,VS3 基线)
 *
 * 布局(ADR-0017 D1 · ticket 02 —— 2:1 左右分栏,删 ThinkingStream):
 * ┌────────────────────────────────────────────────┐
 * │ Stage strip(ANALYZING 徽章 + 进度 + 状态)       │
 * ├────────────────────────────────────────────────┤
 * │ Toolbar(面包屑 + 复制/暂停/重置)                  │
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
 * │ 💬 插话输入条(InterjectInput · 按 active 会话推送新 chunk)│
 * └────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - 'use client':打字机 / 暂停 / 重置 / 完成提示 / SSE 订阅 / Tab 切换都是客户端交互
 * - props.data 由 server 注入(从 getAnalyzingData),组件只关心渲染 + 客户端状态
 * - **ADR-0017 D1**:主区改为 2:1 左右分栏;左栏 = `<DocumentReaderPane>`,右栏 = Summary + ProductList
 * - **ADR-0017 D1**:`<ThinkingStream>` 渲染出口删除;phase state machine 内部状态保留
 *   (pause / reset / skip 仍可点,UI 不再展示思考流)
 * - 打字机 20ms / 字(issue 19 验收 #2);chunk 间 200ms 间隔,模拟"思考停顿"
 * - 点击 ⏸ 暂停 / 继续;点击 ↶ 清空所有进度从 chunk-0 开始
 * - SSE 订阅 `/api/requirement/<id>/events` —— 收到 `analysis_chunk` 事件追加到 chunks
 * - InterjectInput 提交 → POST `/api/requirements/<id>/analysis/interject` →
 *   Agent 通过 SseHub 推送新 chunks → 上面 useEffect 订阅自动追加
 * - VS3 新增:
 *   - 渲染 SessionTabs(sessions / activeId / onSwitch / onCreate / onClose)
 *   - 切换 Tab 时主区 chunks 按 activeSessionId 重新加载;打字机 / 暂停独立工作
 *   - 主区滚动位置按 sessionStorage `analysis-scroll-<sid>` 持久化
 *   - activeId 默认 = props.data.activeSessionId(cookie `last_session_id` 决定,见 server)
 *
 * 状态机(single source of truth,避免 batching 双状态同步问题):
 *   idle     — 还没开始打字
 *   typing   — 正在打 chunkIndex 这条(已显示 typedLen 个字符)
 *   pausing  — 当前 chunk 完成,等 200ms 后推进到下一条
 *   done     — 所有 chunks 都完成,弹"切到 CLARIFYING"提示
 */
export interface AnalyzingZoneProps {
  data: AnalyzingData
}

const TYPEWRITER_INTERVAL_MS = 20
const INTER_CHUNK_PAUSE_MS = 200

/** sessionStorage key 模板:每会话独立滚动位置(issue 19c 验收 #5) */
function scrollStorageKey(sessionId: string): string {
  return `analysis-scroll-${sessionId}`
}

/** 客户端 cookie 名:上次 active session id(SSR 通过 cookies() 注入 lastSessionId) */
const LAST_SESSION_COOKIE = 'last_session_id'

/** SSE 端点路径(同 apps/agent/src/sse/requirementEventsRoute.ts) */
function sseUrl(requirementId: string): string {
  return `/api/requirement/${requirementId}/events`
}

/** 插话 REST 端点(issue 19b · 由 apps/agent/src/routes/analysis.ts 处理) */
function interjectUrl(requirementId: string): string {
  return `/api/requirements/${requirementId}/analysis/interject`
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
// 主内容:Stage + Toolbar + Summary + 打字机思考流
// ============================================================================

function AnalyzingContent({ data }: { data: AnalyzingData }) {
  const [paused, setPaused] = useState(false)
  const [phase, setPhase] = useState<ThinkingPhase>({ kind: 'idle' })
  const [showCompletePrompt, setShowCompletePrompt] = useState(false)
  // 客户端 verdict 覆盖(issue 19a VS1:[接受风险] 按钮 → fail → pending)
  // TODO VS6:接入 server action(POST /analysis/adjudicate)
  const [verdictOverride, setVerdictOverride] = useState<AdmissionVerdict | null>(null)

  // -------------------------------------------------------------------------
  // 多会话状态(issue 19c VS3 · ADR-0013 D7)
  // - sessions:完整会话列表(本 slice 仅前端 mock;后端落盘推迟到 VS5)
  // - activeSessionId:当前 active 会话 id(初始来自 server)
  // - chunksBySessionId:每个会话的 chunks map(mock 简化版:所有会话共用 data.chunks)
  // -------------------------------------------------------------------------
  const [sessions, setSessions] = useState<AnalysisSession[]>(
    data.sessions.length > 0 ? data.sessions : [
      {
        id: 'default',
        label: '架构',
        angle: 'architecture',
        detectedCount: 0,
        isStreaming: false,
      },
    ],
  )
  const [activeSessionId, setActiveSessionId] = useState<string>(
    data.activeSessionId || (sessions[0]?.id ?? 'default'),
  )

  // -------------------------------------------------------------------------
  // chunks 客户端副本 — SSE 推送的新 chunk 会被追加到这里
  // 初始值用 server 注入的 data.chunks(对应当前 active 会话);reset 时回到起点
  //
  // VS3 多会话(MOCK 局限):为简化本 slice 的 UI 实现,所有会话初始化时共用
  // data.chunks 的副本(真实 D7 要求"每 session 是独立对话流 + 自己的 chunks
  // jsonl",本 slice 仅前端 mock,后端落盘推迟到 VS5 与 sessions 持久化一并接入)。
  // SSE 推送时仅追加到 active 会话;新建会话初始化为 []。
  // -------------------------------------------------------------------------
  const [chunksBySessionId, setChunksBySessionId] = useState<Record<string, AnalyzingChunk[]>>(
    () => {
      const map: Record<string, AnalyzingChunk[]> = {}
      for (const s of sessions) map[s.id] = data.chunks
      return map
    },
  )
  const chunks = chunksBySessionId[activeSessionId] ?? []
  const setChunks = useCallback(
    (updater: AnalyzingChunk[] | ((prev: AnalyzingChunk[]) => AnalyzingChunk[])) => {
      setChunksBySessionId((prev) => {
        const current = prev[activeSessionId] ?? []
        const next = typeof updater === 'function' ? updater(current) : updater
        return { ...prev, [activeSessionId]: next }
      })
    },
    [activeSessionId],
  )
  const [interjectSubmitting, setInterjectSubmitting] = useState(false)
  const [interjectError, setInterjectError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // 画线联动状态(ticket 03 · ADR-0017 D4)
  // - activeSourceRef:当前联动的 source_ref(点右栏卡片设置)
  // - pulseRef:传给左栏阅读器触发切 Tab + 滚 + pulse;1.5s 后清空
  // - toasts:无出处等提示
  // -------------------------------------------------------------------------
  const [activeSourceRef, setActiveSourceRef] = useState<SourceRef | null>(null)
  const [pulseRef, setPulseRef] = useState<{
    tabId: string
    lineRange: readonly [number, number]
  } | null>(null)
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

  // 主区滚动容器 ref(用于滚动位置持久化,issue 19c 验收 #5)
  const mainScrollRef = useRef<HTMLDivElement>(null)

  // 当 props.data.chunks 变化(SSR re-render / 路由切换)时,重新同步 active 会话 chunks
  const lastSyncedDataRef = useRef(data.chunks)
  useEffect(() => {
    if (lastSyncedDataRef.current !== data.chunks) {
      lastSyncedDataRef.current = data.chunks
      setChunksBySessionId((prev) => ({ ...prev, [activeSessionId]: data.chunks }))
    }
  }, [data.chunks, activeSessionId, setChunks])

  // -------------------------------------------------------------------------
  // SSE 订阅(issue 19b D2 ② 插话后 AI 推送新 chunk)
  // 用 EventSource 订阅 /api/requirement/<id>/events,监听 **命名事件**
  // 'analysis_chunk'(服务端 publish 走 `event: analysis_chunk\ndata: ...`,
  // 命名事件不会触发 EventSource 默认的 'message' 监听)
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
    es.addEventListener('analysis_chunk', onAnalysisChunk)
    es.addEventListener('error', () => {
      /* browser will auto-reconnect; nothing to do */
    })
    return () => {
      es.removeEventListener('analysis_chunk', onAnalysisChunk)
      es.close()
    }
  }, [data.requirementId, setChunks])

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
  const currentAdmission = {
    ...data.admission,
    verdict: verdictOverride ?? data.admission.verdict,
  }

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
        return
      }
      const tabId = ref.kind === 'aux' ? ref.auxId : PRD_TAB_ID
      // 用新对象触发左栏 effect(即使 lineRange 相同也重跑)
      setPulseRef({ tabId, lineRange: ref.lineRange })
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
      pulseTimerRef.current = window.setTimeout(() => setPulseRef(null), 1500)
    },
    [products, pushToast],
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
    if (paused) return

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
  }, [paused, phase, chunks])

  // -------------------------------------------------------------------------
  // 完成 → 弹提示
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (phase.kind === 'done') {
      setShowCompletePrompt(true)
    }
  }, [phase])

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------
  const reset = useCallback(() => {
    setShowCompletePrompt(false)
    setPaused(false)
    setPhase({ kind: 'idle' })
  }, [])

  const dismissComplete = useCallback(() => {
    setShowCompletePrompt(false)
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
  // 插话提交(issue 19b D2 ②):POST /analysis/interject → SSE 推 chunk → useEffect 追加
  // VS3:session_id 用当前 activeSessionId
  // -------------------------------------------------------------------------
  const handleInterject = useCallback(
    async (text: string) => {
      setInterjectSubmitting(true)
      setInterjectError(null)
      try {
        const res = await fetch(interjectUrl(data.requirementId), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text, session_id: activeSessionId }),
        })
        if (!res.ok && res.status !== 202) {
          const errBody = (await res.json().catch(() => ({}))) as { reason?: string }
          throw new Error(errBody.reason ?? `HTTP ${res.status}`)
        }
        // chunks 由 SSE listener 异步追加;无需 setState 这里
      } catch (err) {
        setInterjectError(err instanceof Error ? err.message : '提交失败')
      } finally {
        setInterjectSubmitting(false)
      }
    },
    [data.requirementId, activeSessionId],
  )

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

  /** 切换会话:保存当前会话滚动位置 → 切换 activeSessionId → 恢复新会话滚动位置
   * 打字机 phase 与 paused 状态**保留**(per-session 切换不应让 UI 跳变,但 chunks
   * 引用已变 → phase.chunkIndex 会越界 → 自然落到 'idle' 重启,符合"独立工作"语义) */
  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      if (sessionId === activeSessionId) return
      // 保存当前会话的滚动位置到 sessionStorage
      const el = mainScrollRef.current
      if (el && typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(
            scrollStorageKey(activeSessionId),
            String(el.scrollTop),
          )
        } catch {
          /* sessionStorage may be unavailable; ignore */
        }
      }
      setActiveSessionId(sessionId)
      // 重置打字机 phase(切换后会话的 chunks 长度/内容不同,phase 必须重置)
      setPhase({ kind: 'idle' })
      // 写入 cookie `last_session_id`,下次 SSR 默认值
      if (typeof document !== 'undefined') {
        document.cookie = `${LAST_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; path=/; max-age=31536000; samesite=lax`
      }
      // 恢复新会话的滚动位置(下一次渲染后,从 mainScrollRef 读取并设置)
      // 通过微任务延迟到 DOM 更新后再写 scrollTop
      queueMicrotask(() => {
        const nextEl = mainScrollRef.current
        if (!nextEl || typeof window === 'undefined') return
        try {
          const saved = window.sessionStorage.getItem(scrollStorageKey(sessionId))
          if (saved !== null) {
            const n = Number(saved)
            if (Number.isFinite(n)) nextEl.scrollTop = n
          } else {
            nextEl.scrollTop = 0
          }
        } catch {
          /* ignore */
        }
      })
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
      if (typeof document !== 'undefined') {
        document.cookie = `${LAST_SESSION_COOKIE}=${encodeURIComponent(newId)}; path=/; max-age=31536000; samesite=lax`
      }
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
      // 清理 chunks map + sessionStorage
      setChunksBySessionId((prev) => {
        const next = { ...prev }
        delete next[sessionId]
        return next
      })
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(scrollStorageKey(sessionId))
        } catch {
          /* ignore */
        }
      }
      // 如果关闭的就是 active → 切到邻居(关闭非首项用左邻居,关闭首项用新首项)
      if (activeSessionId === sessionId) {
        const neighborIdx = idx === 0 ? 0 : idx - 1
        const neighbor = nextSessions[neighborIdx]
        setActiveSessionId(neighbor.id)
        setPhase({ kind: 'idle' })
        if (typeof document !== 'undefined') {
          document.cookie = `${LAST_SESSION_COOKIE}=${encodeURIComponent(neighbor.id)}; path=/; max-age=31536000; samesite=lax`
        }
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
    <main
      data-testid="analyzing-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      data-phase={data.phase}
      data-paused={paused ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <StageStrip
        totalChunks={totalChunks}
        revealedCount={revealedCount}
        isStreaming={data.streamMeta.isStreaming}
      />
      <Toolbar
        toolbar={data.toolbar}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        onReset={reset}
      />
      {/* issue 19a VS1 — 准入仪表板(顶部 5 维度卡 + verdict 徽章 + 待裁决 N · 全局共享) */}
      <div className="px-6 pt-4">
        <AdmissionDashboard
          admission={currentAdmission}
          onAcceptRisk={() => setVerdictOverride('pending')}
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
        ref={mainScrollRef}
        data-testid="analyzing-main"
        data-active-session-id={activeSessionId}
        data-layout="doc-reader-2-1"
        className="flex-1 overflow-auto px-6 py-6 flex flex-col gap-5"
      >
        {/* 主区 2:1 分栏(ADR-0017 D1 · ticket 02):
            左栏 = <DocumentReaderPane>(Tab 栏 + Markdown 阅读器)
            右栏 = Summary + ProductList(产物可编辑,沿用 ADR-0013 D2 ③)
            窄视口(<lg)→ Tailwind 自动垂直堆叠(左在上 / 右在下) */}
        <div
          data-testid="analyzing-grid"
          className="grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0"
        >
          <div
            data-testid="analyzing-left-col"
            className="col-span-1 lg:col-span-2 flex flex-col min-h-0"
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
          <div
            data-testid="analyzing-right-col"
            className="col-span-1 flex flex-col gap-5 min-h-0"
          >
            <Summary summary={data.summary} stats={data.stats} />
            <div className="flex-1 min-h-0">
              <ProductList
                products={products}
                onAction={handleProductAction}
                onItemClick={handleItemClick}
                onAddSyntheticChunk={handleAddSyntheticChunk}
                citationSources={citationSources}
              />
            </div>
          </div>
        </div>
        {interjectError && (
          <div
            data-testid="interject-error"
            role="alert"
            className="text-sm text-error bg-error/10 border border-error rounded-md px-3 py-2"
          >
            插话失败:{interjectError}
          </div>
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
        <InterjectInput
          onSubmit={handleInterject}
          isSubmitting={interjectSubmitting}
        />
      </div>

      {showCompletePrompt && (
        <CompletePrompt
          requirementId={data.requirementId}
          onDismiss={dismissComplete}
        />
      )}

      {/* 画线联动提示(ticket 03):无出处产物点击 → "未关联原文出处" toast */}
      <ToastHost items={toasts} onDismiss={dismissToast} />
    </main>
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
// Toolbar
// ============================================================================

function ToolbarActionButton({
  action,
  paused,
  onTogglePause,
  onReset,
}: {
  action: AnalyzingToolbarAction
  paused: boolean
  onTogglePause: () => void
  onReset: () => void
}) {
  // 识别 ANALYZING 工位专有动作:暂停 / 重置(由 label 启发式判断;
  // 数据层不绑 ID 是因为 Toolbar 是通用 UI 协议,与 EXECUTING 样板对齐)。
  const isPause = /⏸|▶|暂停|继续/.test(action.label)
  const isReset = /↶|重置/.test(action.label)

  const cls =
    action.variant === 'primary'
      ? 'bg-brand text-white hover:bg-brand-600'
      : action.variant === 'secondary'
        ? 'bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle'
        : action.variant === 'danger'
          ? 'bg-bg-elevated text-error border border-border hover:bg-[#fef2f2]'
          : 'bg-transparent text-text-2 hover:text-text-1 hover:bg-bg-subtle'

  if (isPause) {
    return (
      <button
        type="button"
        data-testid="analyzing-toolbar-pause"
        data-paused={paused ? 'true' : 'false'}
        onClick={onTogglePause}
        className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium ${cls}`}
      >
        {paused ? '▶ 继续' : action.label}
      </button>
    )
  }
  if (isReset) {
    return (
      <button
        type="button"
        data-testid="analyzing-toolbar-reset"
        onClick={onReset}
        className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium ${cls}`}
      >
        {action.label}
      </button>
    )
  }
  return (
    <button
      type="button"
      data-testid="analyzing-toolbar-action"
      data-variant={action.variant}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium ${cls}`}
    >
      {action.label}
    </button>
  )
}

function Toolbar({
  toolbar,
  paused,
  onTogglePause,
  onReset,
}: {
  toolbar: AnalyzingToolbar
  paused: boolean
  onTogglePause: () => void
  onReset: () => void
}) {
  return (
    <div
      data-testid="analyzing-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="analyzing-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={c.current ? 'analyzing-crumb-current' : 'analyzing-crumb-item'}
            data-current={c.current ? 'true' : 'false'}
            className={
              c.current
                ? 'text-text-1 font-medium'
                : i % 2 === 1
                  ? 'text-text-3'
                  : 'text-text-2'
            }
          >
            {c.label}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        {toolbar.actions.map((a, i) => (
          <ToolbarActionButton
            key={`${a.label}-${i}`}
            action={a}
            paused={paused}
            onTogglePause={onTogglePause}
            onReset={onReset}
          />
        ))}
      </div>
    </div>
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
      className="bg-gradient-to-br from-brand-50 to-brand-50/40 border border-brand-50 rounded-xl px-6 py-5 flex items-center gap-6"
    >
      <div
        data-testid="analyzing-summary-icon"
        className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center text-3xl flex-shrink-0 ring-2 ring-brand-50"
      >
        {summary.icon}
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="analyzing-summary-title"
          className="text-lg font-semibold text-brand-700 mb-1"
        >
          {summary.title}
        </div>
        <div className="text-text-2 text-sm leading-relaxed">
          {summary.description}
        </div>
      </div>
      <div data-testid="analyzing-stats" className="flex gap-4 flex-shrink-0">
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
      className="text-center px-4 py-2 bg-bg-elevated border border-border rounded-md min-w-[84px]"
    >
      <div className="text-xl font-semibold font-mono text-brand-700">{n}</div>
      <div className="text-xs text-text-3 uppercase tracking-wider mt-1">
        {label}
      </div>
    </div>
  )
}

// ============================================================================
// 完成提示(AI 分析完成 → 切 CLARIFYING 吗?非自动跳转,决策 15)
// ============================================================================

function CompletePrompt({
  requirementId,
  onDismiss,
}: {
  requirementId: string
  onDismiss: () => void
}) {
  return (
    <div
      data-testid="analyzing-complete-prompt"
      role="dialog"
      aria-label="AI 分析完成"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-bg-elevated border-2 border-brand rounded-xl shadow-lg px-5 py-4 flex items-center gap-4 max-w-[520px]"
    >
      <div className="text-2xl">✅</div>
      <div className="flex-1">
        <div className="font-semibold text-text-1">AI 分析完成</div>
        <div className="text-sm text-text-2">
          切到 CLARIFYING 工位回答 AI 的提问吗?(默认留在 ANALYZING)
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="analyzing-complete-stay"
          onClick={onDismiss}
          className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          留在此处
        </button>
        <Link
          href={`/requirements/${requirementId}/clarifying`}
          data-testid="analyzing-complete-switch"
          className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600"
        >
          切到 CLARIFYING →
        </Link>
      </div>
    </div>
  )
}