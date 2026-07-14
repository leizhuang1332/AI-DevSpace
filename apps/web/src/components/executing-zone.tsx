import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  type AIEvent,
  type AIEventTone,
  type DagTask,
  type DagTaskStatus,
  type DiffFile,
  type DiffLine,
  type DiffLineKind,
  type ExecutingData,
  type StageData,
  type ToolbarAction,
  type ToolbarCrumb,
  type ToolbarData,
  summarizeDagStats,
} from '@/lib/executing'
import { EmptyState } from './empty-state'
import { useExecutingSse, type ExecutingAiStatus } from '@/lib/useExecutingSse'
import { ToastHost } from './toast-host'
import type { ToastItem } from './toast'

/**
 * EXECUTING 工位组件(ADR-0011 §6 EXECUTING 布局 · issue 17 样板)
 *
 * 视觉对照基线:[11d-stage-adaptive-implementing.html](../../../../docs/design/pages/11d-stage-adaptive-implementing.html)
 *
 * 布局:
 * ┌────────────────────────────────────────────────┐
 * │ Stage strip(阶段徽章 + 进度 + 阻塞)              │
 * ├────────────────────────────────────────────────┤
 * │ Toolbar(面包屑 + 动作按钮)                       │
 * ├──────────┬──────────────────┬──────────────────┤
 * │ DAG 列   │ Diff 流列        │ AI 行为流列      │
 * │ (280px)  │ (1fr)            │ (320px)          │
 * │          │                  │                  │
 * │ stats    │ filter tabs      │ events           │
 * │ tasks    │ diff file cards  │ (时间倒序)        │
 * └──────────┴──────────────────┴──────────────────┘
 *
 * 这是 6 工位第一个实现的样板(issue 17),后续 5 工位(18-22)按此模式复制。
 * 因此组件结构刻意简洁:stage / toolbar / 三列 → 子组件,便于复用与扩展。
 *
 * 数据全部由 props 注入,组件本身纯渲染,便于单元测试覆盖各种数据组合。
 */
export function ExecutingZone({ data }: { data: ExecutingData }) {
  // 空态:无任务/无产物 → 引导去 DRAFTING 写 PRD
  if (data.empty) {
    return (
      <main
        data-testid="executing-zone"
        data-requirement-id={data.requirementId}
        data-empty="true"
        className="flex flex-col h-full overflow-hidden bg-bg-elevated"
      >
        <EmptyExecuting data={data} />
      </main>
    )
  }

  // P4 · Task 11:hook 接线 —— 仅当 sessionId 存在才订阅 SSE;否则保 idle
  const sessionId = data.sessionId ?? null
  const reqId = data.reqId ?? data.requirementId
  const { status, retry } = useExecutingSse({ reqId, sessionId, enabled: Boolean(sessionId) })

  // P4 · Task 11:toast 状态 —— retrying 进入时弹 warn,fail 弹 err
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    if (status.kind === 'retrying') {
      setToasts((cur) => [
        ...cur,
        {
          id: cryptoRandomId(),
          message: `⚠️ 连接异常,重试中 ${status.retry}/${status.maxRetries}`,
          tone: 'warn',
          durationMs: 3000,
        },
      ])
    }
  }, [status])

  const handleRetry = useCallback(async () => {
    try {
      await retry()
    } catch (err) {
      setToasts((cur) => [
        ...cur,
        {
          id: cryptoRandomId(),
          message: `❌ 重试请求失败:${err instanceof Error ? err.message : String(err)}`,
          tone: 'err',
          durationMs: 5000,
        },
      ])
    }
  }, [retry])

  const canRetry = status.kind === 'failed'
  const cancelledAt = status.kind === 'cancelled' ? status.cancelledAt : null

  return (
    <main
      data-testid="executing-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <StageStrip stage={data.stage} status={status} />
      <Toolbar toolbar={data.toolbar} onRetry={handleRetry} canRetry={canRetry} />
      <div
        data-testid="executing-mc-main"
        className="grid grid-cols-[280px_1fr_320px] flex-1 min-h-0 border-t border-border"
      >
        <DagColumn tasks={data.dag.tasks} block={data.dag.block} />
        <DiffColumn diff={data.diff} />
        <AIEventColumn events={data.aiEvents} cancelledAt={cancelledAt} />
      </div>
      <ToastHost items={toasts} onDismiss={(id) => setToasts((cur) => cur.filter((t) => t.id !== id))} />
    </main>
  )
}

/** 简易 uuid;toast 列表 keyed 用 */
function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ============================================================================
// 空态
// ============================================================================

function EmptyExecuting({ data }: { data: ExecutingData }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <EmptyState
        icon="⚡"
        title="EXECUTING 工位暂无任务"
        subtitle="这个需求还没有实施任务。先去 DRAFTING 工位写 PRD,系统会在 EXECUTING 阶段自动生成任务 DAG。"
        cta={{
          label: '→ 进入 DRAFTING 工位',
          href: `/requirements/${data.requirementId}/drafting/`,
        }}
      />
    </div>
  )
}

// ============================================================================
// Stage strip(顶部状态条)
// ============================================================================

function StageStrip({ stage, status }: { stage: StageData; status: ExecutingAiStatus }) {
  return (
    <div
      data-testid="executing-stage-strip"
      className="bg-gradient-to-r from-brand-50 to-brand-50/30 border-b border-border px-6 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2 font-semibold text-md text-brand-700">
        <span
          data-testid="executing-stage-badge"
          className="bg-brand text-white text-xs font-medium px-2 py-0.5 rounded"
        >
          {stage.badge}
        </span>
        <span data-testid="executing-stage-title">{stage.title}</span>
        <StatusBadge status={status} />
      </div>
      <div
        data-testid="executing-stage-meta"
        className="font-mono text-sm text-brand-600 flex items-center gap-3"
      >
        <span>{stage.metaLeft}</span>
        <span className="text-text-3">·</span>
        <span>{stage.metaCenter}</span>
        <span className="text-text-3">·</span>
        <span>{stage.metaRight}</span>
      </div>
    </div>
  )
}

/** P4 · Task 8:在 StageStrip 标题旁附加 query 状态徽章 */
function StatusBadge({ status }: { status: ExecutingAiStatus }): JSX.Element | null {
  if (status.kind === 'idle' || status.kind === 'running') return null
  if (status.kind === 'retrying') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="retrying"
        className="bg-[#fef3c7] text-[#92400e] text-xs font-medium px-2 py-0.5 rounded animate-pulse"
      >
        ⚠️ 重试中 {status.retry}/{status.maxRetries}({status.category})
      </span>
    )
  }
  if (status.kind === 'failed') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="failed"
        className="bg-[#fee2e2] text-[#991b1b] text-xs font-medium px-2 py-0.5 rounded"
      >
        ❌ 失败 · {status.category} · {status.code}
      </span>
    )
  }
  if (status.kind === 'cancelled') {
    return (
      <span
        data-testid="executing-stage-status"
        data-status="cancelled"
        className="bg-bg-subtle text-text-3 text-xs font-medium px-2 py-0.5 rounded"
      >
        ⏸ 已停止
      </span>
    )
  }
  return null
}

// ============================================================================
// Toolbar(面包屑 + 动作按钮)
// ============================================================================

function Toolbar({
  toolbar,
  onRetry,
  canRetry,
}: {
  toolbar: ToolbarData
  onRetry: () => void
  canRetry: boolean
}) {
  return (
    <div
      data-testid="executing-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3"
    >
      <ToolbarCrumbView crumb={toolbar.crumb} />
      <div className="flex gap-2">
        {toolbar.actions.map((a, i) => (
          <ToolbarActionButton key={`${a.label}-${i}`} action={a} />
        ))}
        {canRetry && (
          <button
            type="button"
            data-testid="executing-toolbar-retry"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-bg-elevated text-error border border-error hover:bg-[#fef2f2]"
          >
            🔄 重试
          </button>
        )}
      </div>
    </div>
  )
}

function ToolbarCrumbView({ crumb }: { crumb: ToolbarCrumb[] }) {
  return (
    <nav
      data-testid="executing-toolbar-crumb"
      aria-label="面包屑"
      className="flex items-center gap-1.5 text-sm text-text-3"
    >
      {crumb.map((c, i) => (
        <span
          key={`${c.label}-${i}`}
          data-testid={
            c.current ? 'executing-crumb-current' : 'executing-crumb-item'
          }
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
  )
}

function ToolbarActionButton({ action }: { action: ToolbarAction }) {
  const cls =
    action.variant === 'primary'
      ? 'bg-brand text-white hover:bg-brand-600'
      : action.variant === 'secondary'
        ? 'bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle'
        : action.variant === 'danger'
          ? 'bg-bg-elevated text-error border border-border hover:bg-[#fef2f2]'
          : 'bg-transparent text-text-2 hover:text-text-1 hover:bg-bg-subtle'
  return (
    <button
      type="button"
      data-testid="executing-toolbar-action"
      data-variant={action.variant}
      className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium ${cls}`}
    >
      {action.label}
    </button>
  )
}

// ============================================================================
// DAG 列(280px)
// ============================================================================

function DagColumn({
  tasks,
  block,
}: {
  tasks: DagTask[]
  block: { title: string; meta: string }
}) {
  const stats = summarizeDagStats(tasks)
  return (
    <aside
      data-testid="executing-dag-col"
      className="bg-bg-elevated border-r border-border overflow-auto p-4"
    >
      <header className="flex items-center justify-between mb-3">
        <h4 className="text-md font-semibold">{block.title}</h4>
        <span
          data-testid="executing-dag-meta"
          className="font-mono text-xs text-text-3"
        >
          {block.meta}
        </span>
      </header>

      <div
        data-testid="executing-dag-stats"
        className="grid grid-cols-4 gap-1.5 mb-4"
      >
        <DagStatCell n={stats.done} label="done" tone="done" />
        <DagStatCell n={stats.doing} label="doing" tone="doing" />
        <DagStatCell n={stats.wait} label="wait" tone="wait" />
        <DagStatCell n={stats.todo} label="todo" tone="todo" />
      </div>

      <ul
        data-testid="executing-dag-tasks"
        className="flex flex-col gap-2"
      >
        {tasks.map((t) => (
          <DagTaskCard key={t.id} task={t} />
        ))}
      </ul>
    </aside>
  )
}

function DagStatCell({
  n,
  label,
  tone,
}: {
  n: number
  label: string
  tone: 'done' | 'doing' | 'wait' | 'todo'
}) {
  const toneCls =
    tone === 'done'
      ? 'text-success'
      : tone === 'doing'
        ? 'text-brand'
        : tone === 'wait'
          ? 'text-warning'
          : 'text-text-3'
  return (
    <div
      data-testid={`executing-dag-stat-${tone}`}
      data-n={n}
      className="text-center py-1.5 bg-bg-subtle rounded-sm"
    >
      <div className={`text-md font-semibold font-mono ${toneCls}`}>{n}</div>
      <div className="text-[10px] text-text-3 uppercase tracking-wider">
        {label}
      </div>
    </div>
  )
}

const DAG_STATUS_CLASS: Record<DagTaskStatus, string> = {
  done: 'border-success bg-[#f0fdf4] text-success',
  doing: 'border-brand bg-brand-50 text-brand-700 ring-2 ring-brand-50',
  wait: 'border-warning bg-[#fffbeb] text-[#92400e]',
  todo: 'border-border-strong text-text-3',
}

const DAG_STATUS_SYMBOL: Record<DagTaskStatus, string> = {
  done: '✓',
  doing: '▶',
  wait: '⏸',
  todo: '○',
}

function DagTaskCard({ task }: { task: DagTask }) {
  const inner = (
    <>
      <div className="font-mono text-[10px] opacity-70">
        {task.id} {DAG_STATUS_SYMBOL[task.status]}
      </div>
      <div className="font-medium mt-0.5">{task.title}</div>
      {task.iteration && (
        <div className="text-[10px] opacity-70 mt-0.5">{task.iteration}</div>
      )}
      {task.sub && (
        <div className="text-[10px] opacity-70 mt-0.5">{task.sub}</div>
      )}
    </>
  )

  const baseCls = `block border-[1.5px] rounded-md px-2.5 py-2 text-xs ${DAG_STATUS_CLASS[task.status]} ${
    task.href ? 'cursor-pointer hover:shadow-md' : ''
  }`

  // 有 href → 渲染为 Link(spec 验收 #4: 资源树任务节点点击跳任务详情)
  if (task.href) {
    return (
      <li data-testid="executing-dag-task" data-task-id={task.id} data-task-status={task.status}>
        <Link
          href={task.href}
          data-testid="executing-dag-task-link"
          className={baseCls}
        >
          {inner}
        </Link>
      </li>
    )
  }

  return (
    <li
      data-testid="executing-dag-task"
      data-task-id={task.id}
      data-task-status={task.status}
      className={baseCls}
    >
      {inner}
    </li>
  )
}

// ============================================================================
// Diff 列(1fr)
// ============================================================================

const DIFF_FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'mod', label: '修改' },
  { key: 'add', label: '新增' },
  { key: 'del', label: '删除' },
] as const

function DiffColumn({
  diff,
}: {
  diff: { files: DiffFile[]; cumulativeText: string }
}) {
  return (
    <section
      data-testid="executing-diff-col"
      className="flex flex-col border-r border-border overflow-hidden bg-bg-elevated"
    >
      <header className="px-4 pt-4 pb-3 border-b border-border flex items-center justify-between">
        <h4
          data-testid="executing-diff-title"
          className="text-md font-semibold"
        >
          {diff.cumulativeText}
        </h4>
        <span className="font-mono text-xs text-text-3">
          ⌘⇧D 全量 · ↶ 回滚
        </span>
      </header>

      <nav
        data-testid="executing-diff-filters"
        aria-label="Diff 筛选"
        className="flex gap-1 px-4 pt-3"
      >
        {DIFF_FILTER_TABS.map((t, i) => (
          <button
            key={t.key}
            type="button"
            data-testid={`executing-diff-filter-${t.key}`}
            data-active={i === 0 ? 'true' : 'false'}
            className={
              i === 0
                ? 'px-3 py-1.5 text-sm rounded-md bg-brand-50 text-brand-700 font-medium'
                : 'px-3 py-1.5 text-sm rounded-md text-text-2 hover:bg-bg-subtle'
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div
        data-testid="executing-diff-body"
        className="flex-1 overflow-auto px-4 py-4 font-mono text-xs leading-relaxed"
      >
        {diff.files.length === 0 ? (
          <p className="text-text-3">暂无变更</p>
        ) : (
          diff.files.map((f, i) => <DiffFileCard key={`${f.path}-${i}`} file={f} />)
        )}
      </div>
    </section>
  )
}

function DiffFileCard({ file }: { file: DiffFile }) {
  return (
    <article
      data-testid="executing-diff-file"
      data-file-path={file.path}
      data-added={file.added}
      data-removed={file.removed}
      data-badge={file.badge ?? ''}
      className="mb-4"
    >
      <header className="flex items-center gap-2 px-3 py-1.5 bg-bg-subtle border border-border rounded-t-md font-mono text-xs font-semibold text-text-1">
        <span>{file.icon}</span>
        <span className="flex-1 truncate">{file.path}</span>
        <span className="text-text-3 font-normal">
          +<span className="text-success">{file.added}</span>{' '}
          <span className="opacity-50">/</span>{' '}
          -<span className="text-error">{file.removed}</span>
          {file.badge && (
            <span className="ml-2 text-error">({file.badge})</span>
          )}
        </span>
      </header>
      <div className="border border-border border-t-0 rounded-b-md overflow-hidden">
        {file.lines.map((l, i) => (
          <DiffLineRow key={`${l.kind}-${i}`} line={l} />
        ))}
      </div>
    </article>
  )
}

const DIFF_LINE_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-[#f0fdf4] text-[#15803d]',
  rem: 'bg-[#fef2f2] text-[#b91c1c]',
  ctx: 'bg-bg-elevated text-text-2',
}

const DIFF_LINE_GUTTER_CLASS: Record<DiffLineKind, string> = {
  add: 'bg-[#dcfce7] text-[#15803d]',
  rem: 'bg-[#fee2e2] text-[#b91c1c]',
  ctx: 'text-text-3',
}

const DIFF_LINE_PREFIX: Record<DiffLineKind, string> = {
  add: '+',
  rem: '-',
  ctx: ' ',
}

function DiffLineRow({ line }: { line: DiffLine }) {
  return (
    <div
      data-testid="executing-diff-line"
      data-line-kind={line.kind}
      className={`grid grid-cols-[40px_1fr] px-2 ${DIFF_LINE_CLASS[line.kind]}`}
    >
      <span
        className={`text-right pr-3 select-none text-[10px] ${DIFF_LINE_GUTTER_CLASS[line.kind]}`}
      >
        {line.gutter ?? ''}
      </span>
      <span className="whitespace-pre">
        <span aria-hidden className="select-none">
          {DIFF_LINE_PREFIX[line.kind]}
        </span>
        {line.content}
      </span>
    </div>
  )
}

// ============================================================================
// AI 行为流列(320px)
// ============================================================================

function AIEventColumn({
  events,
  cancelledAt,
}: {
  events: AIEvent[]
  cancelledAt: string | null
}) {
  return (
    <aside
      data-testid="executing-ai-col"
      className="bg-bg-elevated overflow-auto p-4 flex flex-col gap-3"
    >
      <header className="flex items-center justify-between mb-1">
        <h4 className="text-md font-semibold flex items-center gap-1.5">
          🤖 AI 行为流
        </h4>
        <span
          data-testid="executing-ai-time-range"
          className="font-mono text-xs text-text-3"
        >
          {events.length > 0
            ? `${events[events.length - 1].ts}–${events[0].ts}`
            : '—'}
        </span>
      </header>
      {events.length === 0 && cancelledAt === null ? (
        <p className="text-text-3 text-sm">暂无 AI 事件</p>
      ) : (
        <>
          {events.map((e) => <AIEventCard key={e.id} event={e} />)}
          {cancelledAt !== null && (
            <article
              data-testid="executing-ai-event-cancelled-marker"
              data-tone="warn"
              className="bg-bg-subtle rounded-md p-3 text-sm border-l-[3px] border-l-warning"
            >
              <div className="font-mono text-xs text-text-3 mb-0.5">{cancelledAt}</div>
              <div className="font-medium text-text-1 flex items-center gap-1.5">
                ⏸ 已停止
              </div>
            </article>
          )}
        </>
      )}
    </aside>
  )
}

const AI_TONE_BORDER: Record<AIEventTone, string> = {
  info: 'border-l-brand',
  success: 'border-l-success',
  warn: 'border-l-warning',
  err: 'border-l-error',
}

function AIEventCard({ event }: { event: AIEvent }) {
  return (
    <article
      data-testid="executing-ai-event"
      data-event-id={event.id}
      data-tone={event.tone}
      className={`bg-bg-subtle rounded-md p-3 text-sm border-l-[3px] ${AI_TONE_BORDER[event.tone]}`}
    >
      <div className="font-mono text-xs text-text-3 mb-0.5 flex items-center gap-1.5">
        <span>{event.ts}</span>
        <span className="bg-bg-elevated px-1.5 py-px rounded-sm text-[10px] font-medium text-text-2 border border-border">
          {event.tag}
        </span>
      </div>
      <div className="font-medium text-text-1 mb-0.5 flex items-center gap-1.5">
        <span>{event.icon}</span>
        <span>{event.action}</span>
      </div>
      {event.desc && (
        <div className="text-text-2 text-xs leading-relaxed">{event.desc}</div>
      )}
      {event.stats && (
        <div
          data-testid="executing-ai-event-stats"
          data-added={event.stats.added}
          data-removed={event.stats.removed}
          className="font-mono text-xs mt-1"
        >
          +<span className="text-success font-medium">{event.stats.added}</span>{' '}
          / -
          <span className="text-error font-medium">
            {event.stats.removed}
          </span>
        </div>
      )}
      {event.acts && event.acts.length > 0 && (
        <div className="flex gap-1.5 mt-1.5">
          {event.acts.map((a, i) => (
            <button
              key={`${a}-${i}`}
              type="button"
              data-testid="executing-ai-event-act"
              className="text-xs px-2 py-0.5 bg-bg-elevated border border-border-strong rounded-sm text-text-1 hover:border-brand hover:text-brand-600"
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

// Re-export so other modules can import zone-related types from one place if needed
export type { ExecutingData } from '@/lib/executing'