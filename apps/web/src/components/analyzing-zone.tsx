'use client'

/**
 * ANALYZING 工位组件(issue 08 · ADR-0021 契约收缩)
 *
 * 领域模型(issue 08 之后):
 * - Analysis Skill 单选器
 * - Analysis Run 历史抽屉
 * - Analysis Issue 列表(当前 Run)
 * - Issue Response 编辑器(每个 Issue 卡片下挂一个)
 * - Analysis Run Log 可折叠面板
 * - DocumentReaderPane(文档阅读器,与 Issue / SourceRef 联动)
 *
 * 已删除的旧模型(issue 08 完整替换):
 * - Admission Dimension / Verdict / Pending Adjudication
 * - subproblem / risk / option 三桶 Product
 * - AnalysisSession + angle + Session Tabs + 创建对话框
 * - Technical Brief + Aggregate Module 双产物
 * - 固定 admission-check / requirement-brainstorm 双 turn
 * - 运行中 interject
 *
 * 不依赖旧 `AnalyzingChunk` / `AnalyzingProductGroup` / `AnalyzingData.chunks`
 * 等任何遗留字段 —— `AnalyzingData` 已收缩为只含 Requirement id + PRD /
 * AuxFile / Asset + 可用 Skill + 已选 Skill + Analysis Run 元数据列表。
 *
 * analyzing-fab ticket 04 · ADR-0022 D5.2:把 FAB 浮动面板的 `isOpen` state
 * 提升到本组件,以便通过 `useAnalyzingHistoryFabController` 暴露给
 * `<CommandPalette>`(Cmd+K 「🗂️ 历史分析」命令)。AnalyzingZone unmount →
 * setController(null) → 命令 disabled。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectCitationRefs,
  countCitationsByDoc,
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'
import { sharedSourceRefToWebRef } from './analysis-issue-list'
import type { AnalysisIssue, AnalysisLogEntry, AnalysisRunMeta } from '@ai-devspace/shared'
import type { SourceRef as SharedSourceRef } from '@ai-devspace/shared'
import { useMediaQuery } from '@/lib/use-media-query'
import { EmptyState } from './empty-state'
import { AnalysisSkillSelector } from './analysis-skill-selector'
import { ToastHost } from './toast-host'
import type { ToastItem } from './toast'
import { DocumentReaderPane, PRD_TAB_ID } from './document-reader-pane'
import {
  startAnalysisRun,
  StartAnalysisRunError,
  type StartAnalysisRunSuccess,
} from '@/lib/analysis-run-start'
import { AnalysisIssueList } from './analysis-issue-list'
import { AnalysisRunLogPanel } from './analysis-run-log-panel'
import { StartAnalysisButton } from './start-analysis-button'
import { AnalysisHistoryFabPanel } from './analysis-history-fab-panel'
import {
  AnalysisDeleteRunDialog,
} from './analysis-history-drawer'
import {
  deleteAnalysisRun,
  canDeleteAnalysisRun,
  DeleteAnalysisRunError,
} from '@/lib/analysis-run-delete'
import { findNextRunId } from '@/lib/analysis-run-focus'
import { agentFetch, AgentError } from '@/lib/agent-client'
import { useAnalyzingHistoryFabController } from './analyzing-history-fab-controller'
import type { AnalysisRunDetailResponse } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 「开始分析」状态机(issue 02 · ADR-0021)
//   idle     → 「▶ 开始分析」可点击
//   starting → POST 在路上;切"分析中…",disabled 防重
//   running  → POST 201 已返,SSE 在推;disabled(等终态事件复位)
// ---------------------------------------------------------------------------
// analyzing-fab ticket 07:状态机类型与按钮组件抽到独立文件,
// 让 `<AnalysisHistoryFabPanel>` 的 N=0 空态 CTA 也能复用同一按钮,
// 保证两个位置的「idle → starting → running」视觉与状态机完全一致。
type StartAnalysisState = 'idle' | 'starting' | 'running'

/** SSE 端点路径(同 apps/agent/src/sse/requirementEventsRoute.ts) */
function sseUrl(requirementId: string): string {
  return `/api/requirement/${requirementId}/events`
}

/**
 * 比较两条 shared SourceRef 是否指向同一出处(用于缺行范围时的 no-op 兜底)。
 */
function isSameSharedSourceRef(a: SharedSourceRef, b: SharedSourceRef): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'asset' && b.kind === 'asset') return a.asset_id === b.asset_id
  if (a.kind === 'repository' && b.kind === 'repository') {
    return a.repo_name === b.repo_name && a.relative_path === b.relative_path
  }
  if (a.kind === 'aux' && b.kind === 'aux') {
    return (
      a.aux_id === b.aux_id &&
      (!a.line_range || !b.line_range
        ? a.line_range === undefined && b.line_range === undefined
        : a.line_range[0] === b.line_range[0] && a.line_range[1] === b.line_range[1])
    )
  }
  if (a.kind === 'requirement' && b.kind === 'requirement') {
    return (
      a.relative_path === b.relative_path &&
      (!a.line_range || !b.line_range
        ? a.line_range === undefined && b.line_range === undefined
        : a.line_range[0] === b.line_range[0] && a.line_range[1] === b.line_range[1])
    )
  }
  return false
}

export interface AnalyzingZoneProps {
  data: AnalyzingData
}

export function AnalyzingZone({ data }: AnalyzingZoneProps) {
  if (data.empty) {
    return <EmptyAnalyzing data={data} />
  }
  return <AnalyzingContent data={data} />
}

// ============================================================================
// 空态 —— 引导去 DRAFTING 写 PRD
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
          subtitle="这个需求还没有可分析的内容。先去 DRAFTING 工位写需求文档,完成后选择 Analysis Skill 并开始分析。"
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
// 主内容
// ============================================================================

function AnalyzingContent({ data }: { data: AnalyzingData }) {
  // 「开始分析」状态机
  const [startState, setStartState] = useState<StartAnalysisState>('idle')
  const { items: toastItems, push: pushToast, dismiss: dismissToast } = useToast()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // Skill 选择(issue 01 · ADR-0021)
  // 与 `data.selectedSkillName` 同步的策略:**只在 effect 里跑**,不在 render
  // 期间 setState。
  // - render 期间 setState 是反模式,虽然 React 18 在值不变时会 bail out,但
  //   与父级 router.refresh() / SSEInvalidator 引发的连续 re-render 叠加
  //   时会触发 "Maximum update depth exceeded"(issue 01 当时合入时未踩到,
  //   本次因 sibling controller 修复一起治理)。
  // - startState !== 'idle' 时保留用户本地选择(避免用户点了「开始分析」后,
  //   父组件因为 SSE 推回 server 状态而把乐观值擦掉,造成「按了按钮但 UI
  //   又跳回旧 Skill」的视觉抖跳)。
  const [currentSelectedSkill, setCurrentSelectedSkill] = useState<string>(
    data.selectedSkillName,
  )
  useEffect(() => {
    if (startState === 'idle' && currentSelectedSkill !== data.selectedSkillName) {
      setCurrentSelectedSkill(data.selectedSkillName)
    }
  }, [data.selectedSkillName, startState, currentSelectedSkill])

  // Analysis Run 状态(issue 02 · ADR-0021)
  const [runs, setRuns] = useState<AnalysisRunMeta[]>([...data.runs])
  const [currentRunId, setCurrentRunId] = useState<string>(() => {
    const sorted = [...data.runs].sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    )
    return sorted[0]?.run_id ?? ''
  })
  const [currentRunIssues, setCurrentRunIssues] = useState<AnalysisIssue[]>([])
  const [currentRunLog, setCurrentRunLog] = useState<AnalysisLogEntry[]>([])
  const [logPanelUserToggle, setLogPanelUserToggle] = useState<boolean | null>(null)
  const currentRun = runs.find((r) => r.run_id === currentRunId) ?? null

  // 浮动面板开合 state(analyzing-fab ticket 04 · ADR-0022 D5.2):
  // 提升到 AnalyzingContent 层,这样 Cmd+K 等上层通过 controller 间接控
  // 制面板;sse handler 不影响这个 state(创建 / 切上下文时不强制收起,
  // 由 ADR-0022 决策 96-98 后续 ticket 05 处理)。
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState(false)
  // 用 ref 包 setState(避免 useEffect deps 每次 re-render 都跑)。
  const setIsHistoryPanelOpenRef = useRef(setIsHistoryPanelOpen)
  setIsHistoryPanelOpenRef.current = setIsHistoryPanelOpen

  // 焦点规则(issue 05 验收 6 / 7):用户手动切换 Run 后,SSE 终态事件不抢回焦点
  const userManuallySwitchedRef = useRef(false)

  // 乐观删除 trace(analyzing-fab ticket 03 · ADR-0022 D5.1):本标签主动
  // 触发的 Run 删除会在 handleConfirmDelete 成功路径中立即更新 runs /
  // currentRunId;同 Run 的 analysis_run_deleted SSE 广播会在数十毫秒内
  // 推回本标签,撞到该 ref 时跳过 currentRun 切换,避免与乐观更新的双切换
  // 竞态。仅记录「最近一次由本标签主动删除的 Run id」,SSE handler 命中后
  // 清空。
  const optimisticallyDeletedRunIdRef = useRef<string | null>(null)

  // 删除 Run 二次确认状态(issue 05 验收 9)
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null)
  const deleteTarget = pendingDeleteRunId
    ? runs.find((r) => r.run_id === pendingDeleteRunId) ?? null
    : null

  // ──────────────────────────────────────────────────────────────────────
  // analyzing-fab ticket 04 · ADR-0022 D5.2:注册到 controller context
  // - 把本 zone 的 `requirementId` / `runCount` / `isOpen` / open+close 暴露给
  //   workspace 顶层,让 `<CommandPalette>` 知道有没有「🗂️ 历史分析」能力。
  // - AnalyzingZone unmount → setController(null) → CommandPalette 命令
  //   disabled,符合 PRD「无 req 上下文时 disabled」契约。
  // - useEffect cleanup 兜底:即使 React 18 在严格模式下双 mount,clear
  //   也会把上一次注册的 instance 清掉,避免悬挂引用。
  //
  // 关键:**不要**把 `fabControllerCtx` 放进 deps。Provider 的 value 对象每次
  // render 都会重建(它包了 `controller` + `setController`,后者稳定但 value
  // 不是),所以 deps 含它会让 effect 副作用(setController)反作用于自己:
  // setController → Provider 重建 value → deps 变化 → cleanup setController(null)
  // → Provider 又重建 value → effect 再跑 → 死循环("Maximum update depth
  // exceeded")。把 setController 收到 ref 里只关心真正可能变的字段。
  // ──────────────────────────────────────────────────────────────────────
  const fabControllerCtx = useAnalyzingHistoryFabController()
  const setControllerRef = useRef(fabControllerCtx?.setController ?? null)
  setControllerRef.current = fabControllerCtx?.setController ?? null
  useEffect(() => {
    const setController = setControllerRef.current
    if (!setController) return
    setController({
      requirementId: data.requirementId,
      runCount: runs.length,
      isOpen: isHistoryPanelOpen,
      open: () => setIsHistoryPanelOpenRef.current(true),
      close: () => setIsHistoryPanelOpenRef.current(false),
    })
    return () => {
      setController(null)
    }
  }, [data.requirementId, runs.length, isHistoryPanelOpen])

  // 文档阅读器联动(issue 03 · ADR-0017 D4)
  type PulseRefState =
    | { tabId: string; lineRange: readonly [number, number] }
    | null
  const [activeSourceRef, setActiveSourceRef] = useState<SharedSourceRef | null>(null)
  const [pulseRef, setPulseRef] = useState<PulseRefState>(null)
  const pulseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
    }
  }, [])

  // Issue Response flush gate(issue 04 验收 8 / 9)
  const responseFlushersRef = useRef<Map<string, () => Promise<void>>>(new Map())
  const registerIssueResponseFlush = useCallback(
    (issueId: string, flush: () => Promise<void>) => {
      responseFlushersRef.current.set(issueId, flush)
      return () => {
        responseFlushersRef.current.delete(issueId)
      }
    },
    [],
  )

  // -------------------------------------------------------------------------
  // 切 Run 焦点或选择新 Run 时,重新拉 Run 详情
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!currentRunId) {
      setCurrentRunIssues([])
      setCurrentRunLog([])
      return
    }
    const target = runs.find((r) => r.run_id === currentRunId)
    if (target && target.status === 'running' && target.issue_count === 0) {
      // 刚启动的新 Run → SSE 实时累积,跳过 fetch
      return
    }
    let cancelled = false
    void (async () => {
      try {
        // 必须走 agentFetch(走 getAgentBase() → 真正 agent 端口 + cookie 鉴权)
        // 不能用裸 fetch + 相对路径:会打到 Next.js dev server,Next.js 没这条
        // API route → 返 404 HTML 页(参 issue 复盘:analyzing-zone.tsx:221)
        const json = await agentFetch<AnalysisRunDetailResponse>(
          `/api/requirements/${encodeURIComponent(data.requirementId)}/analysis/runs/${encodeURIComponent(currentRunId)}`,
        )
        if (cancelled) return
        setCurrentRunIssues(Array.isArray(json.issues) ? json.issues : [])
        setCurrentRunLog(Array.isArray(json.log) ? json.log : [])
      } catch (err) {
        // 404(analysis_run_not_found):Run 已被并发流程删/收拢,保持当前 UI,
        // 不弹 toast 干扰用户;其他错误(sse/网络/5xx)静默吞,保持空 Issue,
        // 仍可依赖 SSE 后续推 analysis_run_succeeded/failed 收敛。
        if (err instanceof AgentError && err.status === 404) return
        /* 网络错误 / 解析失败 → 保持空 Issue,不阻断 UI */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [currentRunId, runs, data.requirementId])

  // -------------------------------------------------------------------------
  // 「开始分析」流程(issue 02 + 04 + 06)
  // - 幂等守卫:`startState !== 'idle'` 直接 return
  // - 前置:无可用 Skill / 选定 Skill 为空 → 阻止启动
  // - 前置:flush 全部 IssueResponseEditor;任一失败 → 阻止启动
  // - 成功:乐观追加 Run + 切到新 Run + 设 startState='running'
  // -------------------------------------------------------------------------
  const handleStart = useCallback(async () => {
    if (startState !== 'idle') return
    if (data.availableSkills.length === 0 || currentSelectedSkill === '') {
      pushToast('暂无可用 Analysis Skill,无法开始分析', 'err')
      return
    }
    if (responseFlushersRef.current.size > 0) {
      pushToast('正在保存最新 Issue Response…', 'info')
      const flushers = Array.from(responseFlushersRef.current.values())
      const results = await Promise.allSettled(flushers.map((f) => f()))
      const failures = results.filter((r) => r.status === 'rejected')
      if (failures.length > 0) {
        const first = failures[0]
        const reason =
          first && first.status === 'rejected'
            ? first.reason instanceof Error
              ? first.reason.message
              : String(first.reason)
            : 'unknown'
        pushToast(`Issue Response 保存失败,无法启动分析:${reason}`, 'err')
        return
      }
    }

    setStartState('starting')

    let success: StartAnalysisRunSuccess
    try {
      success = await startAnalysisRun(data.requirementId, {
        skill_name: currentSelectedSkill,
      })
    } catch (err) {
      if (err instanceof StartAnalysisRunError) {
        if (err.code === 'prd_not_ready') {
          pushToast('PRD 未就绪,请先完成 DRAFTING 工位的需求文档', 'warn')
        } else if (err.code === 'empty_prd') {
          // PR-5 (ticket 10):route 层前置拒空 PRD(< 50 字符)
          // 单独提示,与 prd_not_ready 区分:前者是"PRD 文件就绪但内容过短",
          // 后者是"PRD 文件不存在 / 全空白"。
          pushToast('PRD 内容过短,无法支撑 Analysis;请先填写足够的需求内容', 'warn')
        } else if (err.code === 'analysis_run_already_running') {
          pushToast('已有运行中的 Analysis Run,请等待其结束', 'warn')
        } else if (err.code === 'startup_lock_stale') {
          // PR-A (ticket 11):与"运行中"区分 —— 这是 server 启动时
          // reconcile 没清理干净的 stale lock,通常需要重启 agent。
          pushToast('启动锁残留,请稍后重试或重启 agent 服务', 'err')
        } else if (err.code === 'context_overflow') {
          pushToast(
            '历史已答复 Issue 超过上下文预算;请裁剪、删除或拆分后再启动',
            'warn',
          )
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

    const newRun: AnalysisRunMeta = {
      run_id: success.run_id,
      requirement_id: success.requirement_id,
      skill_name: success.skill_name,
      status: 'running',
      created_at: success.created_at,
      finished_at: null,
      issue_count: 0,
      error: null,
    }
    setRuns((prev) => {
      if (prev.some((r) => r.run_id === newRun.run_id)) return prev
      return [newRun, ...prev]
    })
    userManuallySwitchedRef.current = false
    setCurrentRunId(newRun.run_id)
    setCurrentRunIssues([])
    setCurrentRunLog([])
    setLogPanelUserToggle(null)
    setStartState('running')
    // analyzing-fab ticket 05 · ADR-0022 决策 96~98:启动新 Run 成功后强制
    // 收起 FAB 面板(state 留在 AnalyzingContent 内,unmount → 自动重置)。
    // - 失败路径不碰该 state(只 pushToast),保「若已开则仍开,若已关则仍
    //   关」契约。
    setIsHistoryPanelOpen(false)
  }, [
    data.requirementId,
    data.availableSkills.length,
    currentSelectedSkill,
    pushToast,
    startState,
  ])

  // -------------------------------------------------------------------------
  // 切换历史 Run(issue 05 验收 5 · 焦点规则)
  // -------------------------------------------------------------------------
  const handleSelectRun = useCallback(
    (runId: string) => {
      if (runId === currentRunId) return
      userManuallySwitchedRef.current = true
      setCurrentRunId(runId)
      setCurrentRunIssues([])
      setCurrentRunLog([])
      setLogPanelUserToggle(null)
    },
    [currentRunId],
  )

  // -------------------------------------------------------------------------
  // 删除 Run(issue 05 验收 8 / 9 / 11)
  // -------------------------------------------------------------------------
  const handleRequestDelete = useCallback(
    (runId: string) => {
      const target = runs.find((r) => r.run_id === runId)
      if (!target) return
      if (!canDeleteAnalysisRun(target)) {
        pushToast('运行中的 Analysis Run 不可删除', 'warn')
        return
      }
      setPendingDeleteRunId(runId)
    },
    [runs, pushToast],
  )

  const handleConfirmDelete = useCallback(
    async (runId: string) => {
      const isCurrent = currentRunId === runId
      try {
        await deleteAnalysisRun(data.requirementId, runId)
      } catch (err) {
        if (err instanceof DeleteAnalysisRunError) {
          if (err.code === 'analysis_run_not_found') {
            pushToast('该 Run 已被其他标签删除', 'info')
            setPendingDeleteRunId(null)
            return
          }
          if (err.code === 'analysis_run_still_running') {
            pushToast('该 Run 已重新进入运行中,不可删除', 'warn')
            setPendingDeleteRunId(null)
            return
          }
          throw err
        }
        throw err
      }
      // 二次确认对话框关闭(analyzing-fab ticket 03 · ADR-0022 D5.1)
      setPendingDeleteRunId(null)

      // 乐观本地更新(避免等 SSE 异步推 analysis_run_deleted):把被删的
      // Run 从 runs 列表里去掉,然后:
      // - 当前 Run 被删 → 切到 findNextRunId 推荐的下一个 Run;
      // - 非当前 Run 被删 → currentRunId 保持不变。
      //
      // 注意:此处 setRuns 用 functional update,因为这是 useCallback 闭包
      // 内,且需要读最新 runs 状态。如果闭包内的 runs 已过期,filter 会
      // 多删一份空的 prev,后续 SSE 推送仍然兜底(再 filter 一次)。
      const optimisticNext = isCurrent ? findNextRunId(runs, runId) : currentRunId
      optimisticallyDeletedRunIdRef.current = runId
      setRuns((prev) => prev.filter((r) => r.run_id !== runId))
      if (isCurrent) {
        setCurrentRunId(optimisticNext)
        setCurrentRunIssues([])
        setCurrentRunLog([])
        setLogPanelUserToggle(null)
      }
      // 让后续 SSE 终态事件可正常收敛 startState —— ticket 03 验收第 7 条
      // (原本 ticket 02 已落地 handleSelectRun 时翻 true,这里删完后回 false)
      userManuallySwitchedRef.current = false
      // 面板保持打开(analyzing-fab ticket 03 · ADR-0022 D5.1):让用户继续在
      // 「历史语境」里操作;既不调 setIsOpen(false) 也不强渲 isOpen=true,
      // 由父组件 historyFabPanelEl 持有的 isOpen state 自然不变。
    },
    [data.requirementId, pushToast, currentRunId, runs],
  )

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteRunId(null)
  }, [])

  const skillDescriptions = useMemo(() => {
    return new Map(data.availableSkills.map((s) => [s.name, s.description]))
  }, [data.availableSkills])

  // 浮动召唤按钮 + 浮动面板(analyzing-fab ticket 01 · ADR-0022)
  // 替代旧 320px 永久列;FAB / 面板在 DesktopLayout / NarrowLayout 内
  // absolute 定位到主区右上角。
  //
  // ticket 03 · ADR-0022 D5.1:删除 UX 重设 — 面板保留打开 + currentRun
  // 自动切到下一个 Run。删除流程中(dialog 显示期间)用
  // `suppressOutsideClose` 让 fab-panel 不响应 mousedown outside 关闭,
  // 避免用户在二次确认对话框上的 click 误关面板(参
  // `analysis-history-fab-panel.tsx`);删完后 dialog 已关,suppress 解
  // 除,panel 内 useEffect mousedown listener 重新注册,isOpen 状态保持
  // 不变。
  //
  // ticket 04 · ADR-0022 D5.2:`isOpen` / `onOpenChange` 由本组件持有
  // (而非由 AnalysisHistoryFabPanel 内部),通过 controller 暴露给
  // `<CommandPalette>` 同步控制。
  //
  // ticket 06 · ADR-0022 D6:面板展开时给主区加 dim 蒙层(4% 黑色蒙层),
  // 给屏幕阅读器加 `aria-hidden="true"`,避免误读蒙层为可交互元素
  // (`data-dimmed="true"`)。
  const suppressPanelOutsideClose = pendingDeleteRunId !== null
  const historyFabPanelElement = useMemo(
    () => (
      <AnalysisHistoryFabPanel
        runs={runs}
        activeRunId={currentRunId}
        onSelect={handleSelectRun}
        onRequestDelete={handleRequestDelete}
        skillDescriptions={skillDescriptions}
        suppressOutsideClose={suppressPanelOutsideClose}
        isOpen={isHistoryPanelOpen}
        onOpenChange={setIsHistoryPanelOpen}
        // analyzing-fab ticket 07:N=0 空态 CTA 接入主区 handleStart
        startAnalysisState={startState}
        startAnalysisDisabled={data.availableSkills.length === 0}
        onStartAnalysis={handleStart}
      />
    ),
    [
      runs,
      currentRunId,
      handleSelectRun,
      handleRequestDelete,
      skillDescriptions,
      suppressPanelOutsideClose,
      isHistoryPanelOpen,
      startState,
      data.availableSkills.length,
      handleStart,
    ],
  )

  // -------------------------------------------------------------------------
  // SSE 订阅 —— Analysis Run 事件簇(issue 02 / 03 / 05 / 06 / 07)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const es = new EventSource(sseUrl(data.requirementId))
    const onRunCreated = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          skillName: string
          createdAt: string
        }
        setRuns((prev) => {
          if (prev.some((r) => r.run_id === parsed.runId)) return prev
          return [
            {
              run_id: parsed.runId,
              requirement_id: data.requirementId,
              skill_name: parsed.skillName,
              status: 'running',
              created_at: parsed.createdAt,
              finished_at: null,
              issue_count: 0,
              error: null,
            },
            ...prev,
          ]
        })
        userManuallySwitchedRef.current = false
        setCurrentRunId(parsed.runId)
      } catch {
        /* ignore */
      }
    }
    const onIssueReported = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          issue: AnalysisIssue
        }
        if (parsed.runId !== currentRunId) return
        setCurrentRunIssues((prev) => {
          if (prev.some((it) => it.issue_id === parsed.issue.issue_id)) return prev
          return [...prev, parsed.issue]
        })
      } catch {
        /* ignore */
      }
    }
    const onRunLog = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          entry: AnalysisLogEntry
        }
        if (parsed.runId !== currentRunId) return
        setCurrentRunLog((prev) => {
          const dup = prev.some(
            (it) =>
              it.kind === parsed.entry.kind &&
              it.ts === parsed.entry.ts &&
              (it.kind === 'text'
                ? false
                : it.tool_use_id ===
                  (parsed.entry as { tool_use_id?: string }).tool_use_id),
          )
          if (dup) return prev
          return [...prev, parsed.entry]
        })
      } catch {
        /* ignore */
      }
    }
    const applyTerminalState = (
      parsed: { runId: string; finishedAt: string; issueCount: number; status: 'succeeded' | 'failed'; error?: string },
    ): void => {
      setRuns((prev) =>
        prev.map((r) =>
          r.run_id === parsed.runId
            ? {
                ...r,
                status: parsed.status,
                finished_at: parsed.finishedAt,
                issue_count: parsed.issueCount,
                ...(parsed.error !== undefined ? { error: parsed.error } : {}),
              }
            : r,
        ),
      )
      if (
        !userManuallySwitchedRef.current &&
        parsed.runId === currentRunId
      ) {
        setStartState('idle')
      }
    }
    const onRunSucceeded = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          finishedAt: string
          issueCount: number
        }
        applyTerminalState({ ...parsed, status: 'succeeded' })
      } catch {
        /* ignore */
      }
    }
    const onRunFailed = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          finishedAt: string
          error: string
          issueCount: number
        }
        applyTerminalState({ ...parsed, status: 'failed', error: parsed.error })
      } catch {
        /* ignore */
      }
    }
    const onRunDeleted = (e: MessageEvent<string>): void => {
      try {
        const parsed = JSON.parse(e.data) as {
          runId: string
          skillName: string
        }
        // setRuns 始终 filter(idempotent):若本标签已走乐观更新,本次 prev
        // 列表中已不含 parsed.runId;filter 是 no-op。若是其他标签删除或
        // 跨进程 race,filter 会去掉该 Run。
        setRuns((prev) => prev.filter((r) => r.run_id !== parsed.runId))

        // 撞到本标签乐观删除 trace → 跳过 currentRun 切换 + toast(乐观路径
        // 已切 + 不弹 toast 避免重复);仅清 ref,让后续 SSE 行为回归正常。
        if (optimisticallyDeletedRunIdRef.current === parsed.runId) {
          optimisticallyDeletedRunIdRef.current = null
          return
        }

        const isCurrent = currentRunId === parsed.runId
        if (isCurrent) {
          const remaining = [...runs]
            .filter((r) => r.run_id !== parsed.runId)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
          setCurrentRunId(remaining[0]?.run_id ?? '')
          setCurrentRunIssues([])
          setCurrentRunLog([])
          setLogPanelUserToggle(null)
          setPendingDeleteRunId(null)
          pushToast(`已删除 Analysis Run ${parsed.skillName}`, 'info')
        } else {
          pushToast(`已删除历史 Run ${parsed.skillName}`, 'info')
        }
        userManuallySwitchedRef.current = false
      } catch {
        /* ignore */
      }
    }
    es.addEventListener('analysis_run_created', onRunCreated)
    es.addEventListener('analysis_issue_reported', onIssueReported)
    es.addEventListener('analysis_run_log', onRunLog)
    es.addEventListener('analysis_run_succeeded', onRunSucceeded)
    es.addEventListener('analysis_run_failed', onRunFailed)
    es.addEventListener('analysis_run_deleted', onRunDeleted)
    es.addEventListener('error', () => {
      /* browser will auto-reconnect; nothing to do */
    })
    return () => {
      es.removeEventListener('analysis_run_created', onRunCreated)
      es.removeEventListener('analysis_issue_reported', onIssueReported)
      es.removeEventListener('analysis_run_log', onRunLog)
      es.removeEventListener('analysis_run_succeeded', onRunSucceeded)
      es.removeEventListener('analysis_run_failed', onRunFailed)
      es.removeEventListener('analysis_run_deleted', onRunDeleted)
      es.close()
    }
  }, [data.requirementId, currentRunId, pushToast, runs])

  // -------------------------------------------------------------------------
  // Analysis Issue 的 SourceRef 点击 → 文档阅读器联动
  // -------------------------------------------------------------------------
  const handleIssueSourceRefClick = useCallback(
    (ref: SharedSourceRef) => {
      if (ref.kind === 'requirement') {
        const lr = ref.line_range
        setActiveSourceRef(ref)
        setPulseRef({ tabId: PRD_TAB_ID, lineRange: lr ?? [0, 0] })
        if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
        pulseTimerRef.current = window.setTimeout(() => setPulseRef(null), 1500)
        return
      }
      if (ref.kind === 'aux') {
        const lr = ref.line_range
        setActiveSourceRef(ref)
        setPulseRef({ tabId: ref.aux_id, lineRange: lr ?? [0, 0] })
        if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current)
        pulseTimerRef.current = window.setTimeout(() => setPulseRef(null), 1500)
        return
      }
      if (ref.kind === 'asset') {
        setActiveSourceRef(ref)
        return
      }
      // repository:不在阅读器内,无操作
    },
    [],
  )

  // 当前 Run 已收集的 SourceRef(用于 DocumentReaderPane 高亮)
  // - shared SourceRef 用 `kind: 'requirement'` 等(参见 packages/shared),
  //   而 `collectCitationRefs` 期望 web 端的 `kind: 'prd'` / `'aux'` / `'asset'`。
  //   在 flatMap 阶段就通过 `sharedSourceRefToWebRef` 转好,避免 requirement
  //   refs 在 collectCitationRefs 里被静默丢弃(issue 03 联动 → no mark →
  //   scrollIntoView 找不到目标,见 analyzing-issue-click 集成测试新 case)。
  // - `repository` kind 返回 null,过滤掉(本期不在阅读器内,等
  //   isSourceRefMissing 的契约)。
  const sourceRefs = useMemo(() => {
    const out: Array<NonNullable<ReturnType<typeof sharedSourceRefToWebRef>>> = []
    for (const issue of currentRunIssues) {
      for (const ref of issue.source_refs) {
        const webRef = sharedSourceRefToWebRef(ref)
        if (webRef) out.push(webRef)
      }
    }
    return out
  }, [currentRunIssues])
  const citationRefs = useMemo(() => collectCitationRefs(sourceRefs as never), [sourceRefs])
  const citationCounts = useMemo(() => countCitationsByDoc(citationRefs), [citationRefs])

  return (
    <main
      data-testid="analyzing-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      className="flex flex-col h-[calc(100vh-84px)] overflow-hidden bg-bg-elevated"
    >
      <StageStrip />
      {/* Analysis Skill 单选器 + 开始按钮(issue 01 · ADR-0021) */}
      <div className="px-6 pt-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <AnalysisSkillSelector
            requirementId={data.requirementId}
            availableSkills={data.availableSkills}
            selectedSkillName={data.selectedSkillName}
            onSelectionChange={setCurrentSelectedSkill}
            onError={(message) => pushToast(message, 'err')}
          />
        </div>
        <StartAnalysisButton
          state={startState}
          disabled={data.availableSkills.length === 0}
          onClick={handleStart}
        />
      </div>
      <div
        data-testid="analyzing-main"
        data-layout={isDesktop ? 'doc-reader-and-runs' : 'narrow-tabs'}
        className="flex-1 min-h-0 overflow-hidden px-6 py-6 flex flex-col gap-5"
      >
        {isDesktop ? (
          <DesktopLayout
            data={data}
            citationRefs={citationRefs}
            citationCounts={citationCounts}
            activeSourceRef={activeSourceRef}
            pulseRef={pulseRef}
            currentRun={currentRun}
            currentRunIssues={currentRunIssues}
            currentRunLog={currentRunLog}
            logPanelUserToggle={logPanelUserToggle}
            setLogPanelUserToggle={setLogPanelUserToggle}
            onIssueSourceRefClick={handleIssueSourceRefClick}
            registerIssueResponseFlush={registerIssueResponseFlush}
            historyFabPanel={historyFabPanelElement}
            historyPanelOpen={isHistoryPanelOpen}
          />
        ) : (
          <NarrowLayout
            data={data}
            citationRefs={citationRefs}
            citationCounts={citationCounts}
            activeSourceRef={activeSourceRef}
            pulseRef={pulseRef}
            currentRun={currentRun}
            currentRunIssues={currentRunIssues}
            currentRunLog={currentRunLog}
            logPanelUserToggle={logPanelUserToggle}
            setLogPanelUserToggle={setLogPanelUserToggle}
            onIssueSourceRefClick={handleIssueSourceRefClick}
            registerIssueResponseFlush={registerIssueResponseFlush}
            historyFabPanel={historyFabPanelElement}
            historyPanelOpen={isHistoryPanelOpen}
          />
        )}
      </div>
      <ToastHost items={toastItems} onDismiss={dismissToast} />
      <AnalysisDeleteRunDialog
        requirementId={data.requirementId}
        run={deleteTarget}
        onCancel={handleCancelDelete}
        onConfirm={handleConfirmDelete}
      />
    </main>
  )
}

// ============================================================================
// 子组件
// ============================================================================

function StageStrip() {
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
        <span data-testid="analyzing-stage-title">ANALYZING · Analysis Skill & Run</span>
      </div>
    </div>
  )
}

interface LayoutProps {
  data: AnalyzingData
  citationRefs: ReturnType<typeof collectCitationRefs>
  citationCounts: ReturnType<typeof countCitationsByDoc>
  activeSourceRef: SharedSourceRef | null
  pulseRef:
    | { tabId: string; lineRange: readonly [number, number] }
    | null
  currentRun: AnalysisRunMeta | null
  currentRunIssues: ReadonlyArray<AnalysisIssue>
  currentRunLog: ReadonlyArray<AnalysisLogEntry>
  logPanelUserToggle: boolean | null
  setLogPanelUserToggle: (next: boolean | null) => void
  onIssueSourceRefClick: (ref: SharedSourceRef) => void
  registerIssueResponseFlush: (issueId: string, flush: () => Promise<void>) => () => void
  historyFabPanel: React.ReactNode
  /**
   * FAB 面板是否打开(analyzing-fab ticket 06 · ADR-0022 D6)。
   * 桌面布局的 `[识别产物]` 列在面板打开时被 dim 蒙层覆盖(4% 黑色蒙层),
   * 该蒙层 `aria-hidden="true"` 避免屏幕阅读器误读。
   */
  historyPanelOpen: boolean
}

function DesktopLayout(props: LayoutProps) {
  const {
    data,
    citationRefs,
    citationCounts,
    activeSourceRef,
    pulseRef,
    currentRun,
    currentRunIssues,
    currentRunLog,
    logPanelUserToggle,
    setLogPanelUserToggle,
    onIssueSourceRefClick,
    registerIssueResponseFlush,
    historyFabPanel,
    historyPanelOpen,
  } = props
  return (
    <div
      data-testid="analyzing-grid"
      data-viewport="desktop"
      data-history-panel-open={historyPanelOpen ? 'true' : 'false'}
      className="relative grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5 flex-1 min-h-0 overflow-hidden"
    >
      <div
        data-testid="analyzing-left-col"
        className="flex flex-col min-h-0 relative overflow-hidden"
      >
        <DocumentReaderPane
          prdMarkdown={data.prdMarkdown}
          auxFiles={data.auxFiles}
          assetList={data.assetList}
          citationCounts={citationCounts}
          citationRefs={citationRefs}
          activeSourceRef={activeSourceRef}
          pulseRef={pulseRef}
        />
      </div>
      <div
        data-testid="analyzing-right-col"
        data-dimmed={historyPanelOpen ? 'true' : 'false'}
        className="relative flex flex-col gap-5 min-h-0 overflow-hidden"
      >
        <RunSummary
          currentRun={currentRun}
          issueCount={currentRunIssues.length}
        />
        <div className="flex-[2] min-h-0">
          <AnalysisIssueList
            issues={currentRunIssues}
            prdExists={data.prdMarkdown.trim().length > 0}
            auxFiles={data.auxFiles}
            assetList={data.assetList}
            onSourceRefClick={onIssueSourceRefClick}
            requirementId={data.requirementId}
            runId={currentRun?.run_id ?? ''}
            registerFlush={registerIssueResponseFlush}
          />
        </div>
        <AnalysisRunLogPanel
          entries={currentRunLog}
          runStatus={currentRun?.status ?? 'succeeded'}
          userToggle={logPanelUserToggle}
          onToggle={setLogPanelUserToggle}
        />
        {historyPanelOpen && (
          // 4% 黑色 dim 蒙层(non-modal 提示焦点在浮层;`aria-hidden` 避免
          // 屏幕阅读器误读蒙层为可交互元素)。`pointer-events: none` 保
          // 留主列交互 —— 不阻断(non-modal popover 心智)。
          <div
            data-testid="analyzing-right-col-dim"
            aria-hidden="true"
            className="absolute inset-0 bg-black/[0.04] pointer-events-none"
          />
        )}
      </div>
      {historyFabPanel}
    </div>
  )
}

function NarrowLayout(props: LayoutProps) {
  const {
    data,
    citationRefs,
    citationCounts,
    activeSourceRef,
    pulseRef,
    currentRun,
    currentRunIssues,
    currentRunLog,
    logPanelUserToggle,
    setLogPanelUserToggle,
    onIssueSourceRefClick,
    registerIssueResponseFlush,
    historyFabPanel,
    historyPanelOpen,
  } = props
  const [narrowTab, setNarrowTab] = useState<'doc' | 'issues'>('issues')
  return (
    <div
      data-testid="analyzing-narrow"
      data-narrow-tab={narrowTab}
      data-history-panel-open={historyPanelOpen ? 'true' : 'false'}
      className="relative flex flex-col gap-3 flex-1 min-h-0 overflow-hidden"
    >
      {historyFabPanel}
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
          onClick={() => setNarrowTab('doc')}
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
          data-testid="analyzing-narrow-tab-issues"
          data-tab-id="issues"
          data-active={narrowTab === 'issues' ? 'true' : 'false'}
          onClick={() => setNarrowTab('issues')}
          className={
            narrowTab === 'issues'
              ? 'flex-1 h-9 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border flex items-center justify-center gap-1.5'
              : 'flex-1 h-9 rounded-md text-sm font-medium bg-transparent text-text-2 hover:text-text-1 flex items-center justify-center gap-1.5 border border-transparent'
          }
        >
          <span>📝</span>
          <span>问题</span>
        </button>
      </div>
      <div
        data-testid="analyzing-narrow-body"
        className="flex-1 min-h-0 overflow-hidden"
      >
        {narrowTab === 'doc' ? (
          <div
            data-testid="analyzing-narrow-pane-doc"
            role="tabpanel"
            className="h-full"
          >
            <DocumentReaderPane
              prdMarkdown={data.prdMarkdown}
              auxFiles={data.auxFiles}
              assetList={data.assetList}
              citationCounts={citationCounts}
              citationRefs={citationRefs}
              activeSourceRef={activeSourceRef}
              pulseRef={pulseRef}
            />
          </div>
        ) : (
          <div
            data-testid="analyzing-narrow-pane-issues"
            role="tabpanel"
            className="flex flex-col gap-5 h-full min-h-0"
          >
            <RunSummary
              currentRun={currentRun}
              issueCount={currentRunIssues.length}
            />
            <div className="flex-[2] min-h-0">
              <AnalysisIssueList
                issues={currentRunIssues}
                prdExists={data.prdMarkdown.trim().length > 0}
                auxFiles={data.auxFiles}
                assetList={data.assetList}
                onSourceRefClick={onIssueSourceRefClick}
                requirementId={data.requirementId}
                runId={currentRun?.run_id ?? ''}
                registerFlush={registerIssueResponseFlush}
              />
            </div>
            <AnalysisRunLogPanel
              entries={currentRunLog}
              runStatus={currentRun?.status ?? 'succeeded'}
              userToggle={logPanelUserToggle}
              onToggle={setLogPanelUserToggle}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function RunSummary({
  currentRun,
  issueCount,
}: {
  currentRun: AnalysisRunMeta | null
  issueCount: number
}) {
  if (!currentRun) {
    return (
      <div
        data-testid="analyzing-summary"
        className="bg-gradient-to-br from-brand-50 to-brand-50/40 border border-brand-50 rounded-xl px-4 py-3"
      >
        <div className="text-sm font-semibold text-brand-700 mb-1">
          尚未发起 Analysis Run
        </div>
        <div className="text-text-2 text-[11px] leading-relaxed">
          选择 Analysis Skill 后,点击「▶ 开始分析」即可发起一次独立识别。
        </div>
      </div>
    )
  }
  const isZeroIssueSuccess =
    currentRun.status === 'succeeded' && issueCount === 0
  return (
    <div
      data-testid="analyzing-summary"
      className="bg-gradient-to-br from-brand-50 to-brand-50/40 border border-brand-50 rounded-xl px-4 py-3 flex items-center gap-3"
    >
      <div
        data-testid="analyzing-summary-icon"
        className="w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center text-xl flex-shrink-0 ring-2 ring-brand-50"
      >
        {currentRun.status === 'running'
          ? '⏳'
          : currentRun.status === 'failed'
            ? '⚠️'
            : '✅'}
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="analyzing-summary-title"
          className="text-sm font-semibold text-brand-700 mb-0"
        >
          {isZeroIssueSuccess
            ? '本次 Skill 未识别出问题'
            : currentRun.status === 'running'
              ? 'Analysis Skill 正在检查'
              : currentRun.status === 'failed'
                ? 'Analysis Run 失败'
                : `Analysis Run 完成`}
        </div>
        <div className="text-text-2 text-[11px] leading-relaxed">
          Skill:{currentRun.skill_name} · 已提交 Issue {issueCount} 条
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Toast hook —— 简易 wrapper,封装 push / dismiss / 序列 id
// ============================================================================
function useToast() {
  const [items, setItems] = useState<ToastItem[]>([])
  const seqRef = useRef(0)
  const push = useCallback(
    (message: string, tone: ToastItem['tone']) => {
      const id = `toast-${seqRef.current++}`
      setItems((prev) => [...prev, { id, message, tone, durationMs: 3000 }])
    },
    [],
  )
  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])
  return { items, push, dismiss }
}

// useMemo 已在顶部导入