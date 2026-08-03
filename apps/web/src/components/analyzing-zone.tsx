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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  collectCitationRefs,
  countCitationsByDoc,
  emptyAnalyzing,
  type AnalyzingData,
} from '@/lib/analyzing'
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
import {
  AnalysisHistoryDrawer,
  AnalysisDeleteRunDialog,
} from './analysis-history-drawer'
import {
  deleteAnalysisRun,
  canDeleteAnalysisRun,
  DeleteAnalysisRunError,
} from '@/lib/analysis-run-delete'
import { agentFetch, AgentError } from '@/lib/agent-client'
import type { AnalysisRunDetailResponse } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 「开始分析」状态机(issue 02 · ADR-0021)
//   idle     → 「▶ 开始分析」可点击
//   starting → POST 在路上;切"分析中…",disabled 防重
//   running  → POST 201 已返,SSE 在推;disabled(等终态事件复位)
// ---------------------------------------------------------------------------
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
  const [currentSelectedSkill, setCurrentSelectedSkill] = useState<string>(
    data.selectedSkillName,
  )
  if (currentSelectedSkill !== data.selectedSkillName && startState === 'idle') {
    setCurrentSelectedSkill(data.selectedSkillName)
  }

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

  // 焦点规则(issue 05 验收 6 / 7):用户手动切换 Run 后,SSE 终态事件不抢回焦点
  const userManuallySwitchedRef = useRef(false)

  // 删除 Run 二次确认状态(issue 05 验收 9)
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null)
  const deleteTarget = pendingDeleteRunId
    ? runs.find((r) => r.run_id === pendingDeleteRunId) ?? null
    : null

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
      try {
        await deleteAnalysisRun(data.requirementId, runId)
        setPendingDeleteRunId(null)
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
    },
    [data.requirementId, pushToast],
  )

  const handleCancelDelete = useCallback(() => {
    setPendingDeleteRunId(null)
  }, [])

  const skillDescriptions = useMemo(() => {
    return new Map(data.availableSkills.map((s) => [s.name, s.description]))
  }, [data.availableSkills])

  const historyDrawerElement = useMemo(
    () => (
      <AnalysisHistoryDrawer
        runs={runs}
        activeRunId={currentRunId}
        onSelect={handleSelectRun}
        onRequestDelete={handleRequestDelete}
        skillDescriptions={skillDescriptions}
      />
    ),
    [runs, currentRunId, handleSelectRun, handleRequestDelete, skillDescriptions],
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
        const isCurrent = currentRunId === parsed.runId
        setRuns((prev) => prev.filter((r) => r.run_id !== parsed.runId))
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
  const sourceRefs = useMemo(
    () =>
      currentRunIssues.flatMap((issue) => issue.source_refs as readonly unknown[]),
    [currentRunIssues],
  )
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
            historyDrawer={historyDrawerElement}
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
            historyDrawer={historyDrawerElement}
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
      data-testid="analysis-run-start-btn"
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
            data-testid="analysis-run-start-spinner"
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
  historyDrawer: React.ReactNode
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
    historyDrawer,
  } = props
  return (
    <div
      data-testid="analyzing-grid"
      data-viewport="desktop"
      className="relative grid grid-cols-1 lg:grid-cols-[2fr_1fr_320px] gap-5 flex-1 min-h-0 overflow-hidden"
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
        className="flex flex-col gap-5 min-h-0 overflow-hidden"
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
      <div
        data-testid="analyzing-history-col"
        className="flex flex-col min-h-0 overflow-hidden"
      >
        {historyDrawer}
      </div>
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
    historyDrawer,
  } = props
  const [narrowTab, setNarrowTab] = useState<'doc' | 'issues'>('issues')
  return (
    <div
      data-testid="analyzing-narrow"
      data-narrow-tab={narrowTab}
      className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden"
    >
      {historyDrawer && (
        <div className="max-h-[200px] flex-shrink-0" data-testid="analyzing-narrow-history">
          {historyDrawer}
        </div>
      )}
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