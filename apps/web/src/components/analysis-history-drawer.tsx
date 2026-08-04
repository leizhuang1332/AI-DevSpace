/**
 * 历史分析抽屉组件(issue 05 · ADR-0021)
 *
 * 替代旧 SessionTabs(ADR-0013 D7 + 决策 50·横向多会话 Tab),改为侧边抽屉。
 * 核心差异:
 * - 历史列表 = AnalysisRunMeta 数组(按 created_at 倒序)
 * - 每个 Run 一行;点击行 = 切到该 Run;每个 Run 状态对应一个删除入口(终态可删)
 * - 删除走二次确认对话框,明确告知 Issue / Response / Log / 后续上下文影响
 * - 运行中 Run 不显示删除按钮(避免 UI 与服务端 409 不一致)
 *
 * 焦点规则(ADR-0021 决策 36):
 * - 父组件决定"用户是否手动切换";本组件仅暴露 onSelect / onDelete 回调
 * - 用户点行 → 父组件 setCurrentRunId + 标记"用户主动切换" → 后续 SSE 终态
 *   事件不会抢回焦点(由父组件 AnalyzingZone 维护)
 * - "开始新 Run"由父组件主动 setCurrentRunId(分析发起时);不在抽屉层做
 *
 * 视觉:右侧窄抽屉 w-[320px];顶部抽屉标题"历史分析 N";中间列表;无 Run
 * 时显示空态。
 */

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnalysisRunMeta } from '@ai-devspace/shared'
import { canDeleteAnalysisRun } from '@/lib/analysis-run-delete'

export interface AnalysisHistoryDrawerProps {
  /** Analysis Run 列表(按 created_at 倒序;SSR 注入 + SSE 追加 + 删除消失) */
  runs: ReadonlyArray<AnalysisRunMeta>
  /** 当前选中 Run id */
  activeRunId: string
  /** 点行 → 父组件切到该 Run(用户手动切换的判定由父组件维护) */
  onSelect: (runId: string) => void
  /** 点删除按钮 → 父组件弹二次确认;本组件不直接调 delete */
  onRequestDelete: (runId: string) => void
  /**
   * Skill 名称 → 简介 的映射(来自 SSR;若未提供则抽屉只显示 Skill 名)。
   * 用于让用户在不打开 Run 详情时识别 Skill。
   */
  skillDescriptions?: ReadonlyMap<string, string>
}

/** 把 ISO 时间格式化为"MM/DD HH:mm" — 抽屉行使用紧凑形态 */
function formatRunTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 状态显示标签 + 配色 */
function statusPresentation(
  status: AnalysisRunMeta['status'],
): { label: string; dotClass: string; textClass: string } {
  if (status === 'running') {
    return { label: '运行中', dotClass: 'bg-brand animate-pulse', textClass: 'text-brand-700' }
  }
  if (status === 'succeeded') {
    return { label: '已完成', dotClass: 'bg-success', textClass: 'text-success-700' }
  }
  return { label: '失败', dotClass: 'bg-error', textClass: 'text-error-700' }
}

export function AnalysisHistoryDrawer({
  runs,
  activeRunId,
  onSelect,
  onRequestDelete,
  skillDescriptions,
}: AnalysisHistoryDrawerProps) {
  // runs 永远按 created_at 倒序展示(防御性排序;SSR 已排好但客户端 SSE
  // 追加或本地过滤后可能打乱)
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runs],
  )

  return (
    <aside
      data-testid="analysis-history-drawer"
      data-run-count={sortedRuns.length}
      data-active-run-id={activeRunId}
      className="flex flex-col w-[320px] flex-shrink-0 bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <header
        data-testid="analysis-history-drawer-header"
        className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between"
      >
        <h2 className="text-md font-semibold flex items-center gap-2">
          🗂️ 历史分析
          <span
            data-testid="analysis-history-drawer-count"
            className="text-[11px] font-mono text-text-3"
          >
            {sortedRuns.length}
          </span>
        </h2>
      </header>

      <div
        data-testid="analysis-history-drawer-body"
        className="flex-1 min-h-0 overflow-auto"
      >
        {sortedRuns.length === 0 ? (
          <div
            data-testid="analysis-history-empty"
            className="px-4 py-6 text-center text-xs text-text-3"
          >
            暂无历史 Analysis Run
          </div>
        ) : (
          <ul className="flex flex-col" data-testid="analysis-history-list">
            {sortedRuns.map((run) => (
              <HistoryRow
                key={run.run_id}
                run={run}
                active={run.run_id === activeRunId}
                skillDescription={skillDescriptions?.get(run.skill_name)}
                onSelect={onSelect}
                onRequestDelete={onRequestDelete}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// 单行 Run
// ---------------------------------------------------------------------------

export interface HistoryRowProps {
  run: AnalysisRunMeta
  active: boolean
  skillDescription?: string
  onSelect: (runId: string) => void
  onRequestDelete: (runId: string) => void
}

/**
 * 单行 Run(供 `AnalysisHistoryFabPanel` 复用,见 analyzing-fab ticket 01 / 02)。
 *
 * 暂以"export"暴露给同包组件使用,本文件其余本体未动。
 */
export function HistoryRow({
  run,
  active,
  skillDescription,
  onSelect,
  onRequestDelete,
}: HistoryRowProps) {
  const pres = statusPresentation(run.status)
  const deletable = canDeleteAnalysisRun(run)

  return (
    <li
      data-testid="analysis-history-row"
      data-run-id={run.run_id}
      data-run-status={run.status}
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'true' : undefined}
      className={`border-b border-border last:border-b-0 transition-colors ${
        active ? 'bg-brand-50/40' : 'hover:bg-bg-subtle'
      }`}
    >
      <div className="flex items-start gap-2 px-3 py-2.5">
        {/* 行主体:点击 → 切换 Run */}
        <button
          type="button"
          data-testid="analysis-history-row-select"
          data-active={active ? 'true' : 'false'}
          onClick={() => onSelect(run.run_id)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              aria-hidden
              data-testid="analysis-history-row-status-dot"
              className={`inline-block w-1.5 h-1.5 rounded-full ${pres.dotClass}`}
            />
            <span
              data-testid="analysis-history-row-time"
              className="font-mono text-[11px] text-text-3"
            >
              {formatRunTime(run.created_at)}
            </span>
            <span
              data-testid="analysis-history-row-status"
              className={`text-[10px] font-medium ${pres.textClass}`}
            >
              {pres.label}
            </span>
          </div>
          <div
            data-testid="analysis-history-row-skill"
            className="text-sm font-medium text-text-1 truncate"
            title={skillDescription ?? run.skill_name}
          >
            {run.skill_name}
          </div>
          {skillDescription && (
            <div className="text-[11px] text-text-3 line-clamp-1 mt-0.5">
              {skillDescription}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-3 font-mono">
            <span data-testid="analysis-history-row-issue-count">
              📝 {run.issue_count} Issue{run.issue_count === 1 ? '' : 's'}
            </span>
            {run.finished_at && run.status === 'failed' && run.error && (
              <span
                data-testid="analysis-history-row-error"
                className="text-error-700 line-clamp-1"
                title={run.error}
              >
                ⚠ {run.error}
              </span>
            )}
          </div>
        </button>
        {/* 删除按钮(终态可点;running 隐藏) */}
        {deletable ? (
          <button
            type="button"
            data-testid="analysis-history-row-delete"
            aria-label={`删除 Analysis Run ${run.skill_name}`}
            onClick={() => onRequestDelete(run.run_id)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-3 hover:text-error hover:bg-error/10 transition-colors flex-shrink-0"
          >
            <span aria-hidden>🗑️</span>
          </button>
        ) : (
          <span
            data-testid="analysis-history-row-delete-disabled"
            aria-label="运行中的 Run 不可删除"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-3 opacity-30 flex-shrink-0"
          >
            <span aria-hidden>🔒</span>
          </span>
        )}
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// 删除二次确认对话框
// ---------------------------------------------------------------------------

export interface AnalysisDeleteRunDialogProps {
  requirementId: string
  /** 被删除的 Run(已确认处于终态) */
  run: AnalysisRunMeta | null
  /** 关闭对话框 */
  onCancel: () => void
  /** 用户点确认 → 父组件调 deleteAnalysisRun */
  onConfirm: (runId: string) => Promise<void> | void
}

/**
 * 删除确认对话框(issue 05 验收 9)。
 *
 * 明确告知用户(issue 05 acceptance #10):
 * - 该 Run 的 Issue / Response / Log 全部级联永久删除
 * - 如果该 Run 已有 Issue Response 被答复,这些答复在后续 Run 中不再作为
 *   上下文(避免用户事后才发现"我填的答复丢了")
 * - 当前选中 / 焦点:不切走焦点(由父组件在删除完成后做)
 *
 * 关于 hasResponses:实现层故意不引入这一 prop —— 父组件不必为此多发一次
 * GET /responses。Run 元数据本身不携带"是否有答复"信息;父组件若要更精确
 * 提示(只在该 Run 真正有 Response 时才显示上下文警告),可在 issue 09 等后续
 * 演进中扩展 Run 元数据 schema 或单独查询。文案使用中性表达,既不夸大也不
 * 隐瞒关键影响。
 */
export function AnalysisDeleteRunDialog({
  run,
  onCancel,
  onConfirm,
}: AnalysisDeleteRunDialogProps) {
  // 内部状态:提交中 + 错误
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 处理函数:放在 effect 外面,避免 stale closure 捕获旧的 run
  const handleConfirm = useCallback(async (): Promise<void> => {
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm(run?.run_id ?? '')
      // 成功 → 由父组件关闭对话框(unmount)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSubmitting(false)
    }
  }, [onConfirm, run?.run_id])

  // Esc 关闭 + Enter 提交:挂全局 keydown 监听(对话框打开时)
  useEffect(() => {
    if (!run) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
      else if (e.key === 'Enter' && !submitting) {
        void handleConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, submitting, onCancel, handleConfirm])

  if (!run) return null

  return (
    <div
      data-testid="analysis-delete-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="删除 Analysis Run"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel()
      }}
    >
      <div
        data-testid="analysis-delete-dialog-content"
        className="bg-bg-elevated border border-border-strong rounded-lg shadow-xl w-[460px] max-w-[92vw] flex flex-col"
      >
        <header className="px-5 py-3 border-b border-border flex items-center gap-2">
          <span aria-hidden className="text-lg">
            ⚠️
          </span>
          <h2 className="text-md font-semibold text-text-1">永久删除 Analysis Run?</h2>
        </header>
        <div className="px-5 py-4 flex flex-col gap-3 text-sm text-text-1">
          <p>
            即将永久删除 Run{' '}
            <code
              data-testid="analysis-delete-dialog-skill"
              className="px-1.5 py-0.5 rounded bg-bg-subtle text-xs font-mono"
            >
              {run.skill_name}
            </code>
            ,以下数据将一并消失:
          </p>
          <ul className="text-xs text-text-2 space-y-1 pl-4 list-disc">
            <li>
              <strong>{run.issue_count}</strong> 条 Analysis Issue
            </li>
            <li>该 Run 的所有 Issue Response(包括已答复的 Markdown 正文)</li>
            <li>完整 Run Log(模型文本 / 工具活动 / 工具输入输出)</li>
          </ul>
          <div
            data-testid="analysis-delete-dialog-context-warning"
            className="text-xs bg-warn/10 border border-warn/40 text-warn-700 rounded-md px-3 py-2 leading-relaxed"
          >
            ⚠ 如果该 Run 有 Issue Response 被答复,这些答复在下一次 Run
            的分析上下文中将不再出现(决策 80:被删除 Run 的 Response 不再
            进入任何后续 Analysis Run)。
          </div>
          <p className="text-xs text-text-3">
            此操作不可撤销。运行中的 Run 不可删除(本对话框只对终态 Run 打开)。
          </p>
          {error && (
            <div
              data-testid="analysis-delete-dialog-error"
              role="alert"
              className="text-xs text-error bg-error/10 border border-error/40 rounded-md px-3 py-2"
            >
              删除失败:{error}
            </div>
          )}
        </div>
        <footer className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="analysis-delete-dialog-cancel"
            onClick={onCancel}
            disabled={submitting}
            className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            data-testid="analysis-delete-dialog-confirm"
            onClick={handleConfirm}
            disabled={submitting}
            className="h-8 px-3 rounded-md text-sm font-medium bg-error text-white hover:bg-error/90 disabled:opacity-50"
          >
            {submitting ? '删除中…' : '确认删除'}
          </button>
        </footer>
      </div>
    </div>
  )
}