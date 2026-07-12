import Link from 'next/link'
import {
  ZONE_META,
  ZONE_LIFECYCLE_ORDER,
  ZONE_STATUS_COLOR_CLASS,
} from '@/lib/zones'
import type { ZoneMeta } from '@/lib/zones'
import type {
  OverviewAIActivity,
  OverviewData,
  OverviewMilestone,
  OverviewProgress,
  OverviewZoneCard,
} from '@/lib/requirement-overview'
import type { RequirementStatus } from '@/app/(workspace)/data/mock'
import { EmptyState } from './empty-state'

/**
 * Overview 概览页主区(ADR-0011 §1 + §4 · ADR-0012 §5)。
 *
 * 视觉对照基线:[12-requirement-overview.html](../../docs/design/pages/12-requirement-overview.html)
 *
 * 内容布局:
 * ┌──────────────────────────────────────┐
 * │ 顶部 banner(面包屑 / 标题 / 元数据)   │
 * ├────────────────────┬─────────────────┤
 * │ 完成进度(左上)      │ 工作台地图(右上)│
 * ├────────────────────┼─────────────────┤
 * │ 关键里程碑(左下)    │ AI 活动概览(右下)│
 * └────────────────────┴─────────────────┘
 *
 * 无 ZoneBar(ADR-0012 §5 · Overview 是仪表板不是工作台)。
 * 无资源树 / Inline 栏(同上)。
 *
 * 数据全部由 props 注入 —— 组件本身纯渲染,不直接读文件系统 / API,
 * 便于在单元测试里覆盖各种聚合结果(满数据 / 空数据 / 部分数据)。
 */
export function OverviewPage({ data }: { data: OverviewData }) {
  // 空状态:新建需求(无产物)→ 引导去 DRAFTING 工位
  if (data.empty) {
    return (
      <main
        data-testid="overview-page"
        data-requirement-id={data.requirementId}
        data-empty="true"
        className="overflow-auto p-6 lg:p-8"
      >
        <OverviewHeader data={data} />
        <EmptyState
          icon="📋"
          title="暂无数据"
          subtitle="这个需求还没有产物。先去 DRAFTING 工位写 PRD,系统会自动汇总到这里。"
          cta={{
            label: '→ 进入 DRAFTING 工位',
            href: `/requirements/${data.requirementId}/drafting/`,
          }}
        />
      </main>
    )
  }

  return (
    <main
      data-testid="overview-page"
      data-requirement-id={data.requirementId}
      data-empty="false"
      className="overflow-auto p-6 lg:p-8"
    >
      <OverviewHeader data={data} />
      <div
        data-testid="overview-grid"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        <ProgressCard progress={data.progress} />
        <ZoneMapCard requirementId={data.requirementId} zones={data.zoneCards} />
        <MilestonesCard milestones={data.milestones} />
        <AIActivityCard aiActivity={data.aiActivity} />
      </div>
    </main>
  )
}

// ============================================================================
// 顶部 banner
// ============================================================================

function OverviewHeader({ data }: { data: OverviewData }) {
  const { meta } = data
  return (
    <header
      data-testid="overview-header"
      className="max-w-[1400px] w-full mb-6"
    >
      {/* 面包屑 */}
      <nav
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3 mb-3"
      >
        <Link href="/requirements/" className="hover:text-text-2">
          📋 需求列表
        </Link>
        <span>›</span>
        <span className="text-text-1 font-medium">
          {meta.reqIdLabel || data.requirementId} · Overview
        </span>
      </nav>

      {/* 标题 + req-id */}
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {meta.title || '未命名需求'}
        </h1>
        {meta.reqIdLabel && (
          <span className="font-mono text-sm text-text-3 bg-bg-subtle px-2 py-0.5 rounded">
            {meta.reqIdLabel}
          </span>
        )}
      </div>

      {/* 元数据栏 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-2">
        <MetaItem label="状态">
          <StatusDot status={meta.status} />
          <span className="text-text-1 font-medium">
            {meta.status.toUpperCase()}
          </span>
        </MetaItem>
        <MetaItem label="关联仓库">
          <span className="text-brand-600 font-medium">
            {meta.repos.length > 0
              ? `${meta.repos.slice(0, 2).join(' · ')}${meta.repos.length > 2 ? ` · ${meta.repos[2]}` : ''} ${meta.repos.length > 3 ? `(${meta.repos.length})` : ''}`
              : '—'}
          </span>
        </MetaItem>
        <MetaItem label="负责人">
          <span className="text-text-1 font-medium">{meta.owner || '—'}</span>
        </MetaItem>
        <MetaItem label="创建">
          <span className="text-text-1 font-medium">
            {meta.createdAt || '—'}
          </span>
        </MetaItem>
        <MetaItem label="最近更新">
          <span className="text-text-1 font-medium">
            {meta.updatedAt || '—'}
          </span>
        </MetaItem>
      </div>
    </header>
  )
}

function MetaItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-text-3 text-xs uppercase tracking-wider">
        {label}
      </span>
      {children}
    </div>
  )
}

// 与 status-badge.tsx 的语义对齐 —— 简化版(只点 + 文字)
function StatusDot({ status }: { status: RequirementStatus }) {
  // 复用 STATUS_DOT 颜色策略,内联简化版避免组件耦合
  const dotColor =
    status === 'done'
      ? 'bg-success'
      : status === 'archived'
        ? 'bg-[#64748b]'
        : status === 'submitting'
          ? 'bg-warning'
          : status === 'implementing'
            ? 'bg-brand'
            : 'bg-[#a5b4fc]'
  return (
    <span
      data-testid="overview-status-dot"
      data-status={status}
      className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`}
    />
  )
}

// ============================================================================
// 左上 · 完成进度卡片
// ============================================================================

function ProgressCard({ progress }: { progress: OverviewProgress }) {
  return (
    <section
      data-testid="overview-progress-card"
      className="bg-bg-elevated border border-border rounded-lg p-4 shadow-sm"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold flex items-center gap-2">
          📈 完成进度
        </h3>
        <span className="font-mono text-xs text-text-3">{progress.percent}%</span>
      </header>

      {/* 4 stat cell */}
      <div
        data-testid="overview-progress-stats"
        className="grid grid-cols-4 gap-3 mb-4"
      >
        <StatCell n={progress.done} label="已完成" tone="success" />
        <StatCell n={progress.inProgress} label="进行中" tone="brand" />
        <StatCell n={progress.waiting} label="等待中" tone="warning" />
        <StatCell n={progress.todo} label="待办" tone="muted" />
      </div>

      {/* 进度条 */}
      <div
        className="relative h-6 bg-bg-subtle rounded-md overflow-hidden mb-3"
        data-testid="overview-progress-bar"
        data-percent={progress.percent}
      >
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-brand to-brand-600 rounded-md"
          style={{ width: `${progress.percent}%` }}
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white font-medium font-mono">
          {progress.percent}% · {progress.done}/{progress.total} 任务
        </div>
      </div>

      {/* 详情段 */}
      <div
        data-testid="overview-progress-detail"
        className="flex gap-4 text-xs text-text-2"
      >
        <DetailSeg
          dotColor="bg-success"
          text={`代码 +${progress.codeLinesAdded}/-${progress.codeLinesRemoved} 行`}
        />
        <DetailSeg
          dotColor="bg-brand"
          text={`产物 ${progress.artifactCount} 件`}
        />
        {progress.prStatus && (
          <DetailSeg dotColor="bg-warning" text={progress.prStatus} />
        )}
      </div>
    </section>
  )
}

function StatCell({
  n,
  label,
  tone,
}: {
  n: number
  label: string
  tone: 'success' | 'brand' | 'warning' | 'muted'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'brand'
        ? 'text-brand'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-text-3'
  return (
    <div className="p-3 bg-bg-subtle rounded-md text-center">
      <div className={`text-xl font-semibold font-mono ${toneClass}`}>{n}</div>
      <div className="text-xs text-text-3 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  )
}

function DetailSeg({ dotColor, text }: { dotColor: string; text: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span>{text}</span>
    </div>
  )
}

// ============================================================================
// 右上 · 工位地图卡片
// ============================================================================

function ZoneMapCard({
  requirementId,
  zones,
}: {
  requirementId: string
  zones: OverviewZoneCard[]
}) {
  // 按 lifecycle 顺序对齐(原型的视觉顺序)
  const sorted = ZONE_LIFECYCLE_ORDER.map((id) => {
    const meta = ZONE_META.find((z) => z.id === id)!
    const card = zones.find((z) => z.zoneId === id)
    return { meta, card }
  })

  return (
    <section
      data-testid="overview-zone-map-card"
      className="bg-bg-elevated border border-border rounded-lg p-4 shadow-sm"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold flex items-center gap-2">
          🗺️ 工作台地图
        </h3>
        <span className="font-mono text-xs text-text-3">6 工位 · 点击进入</span>
      </header>

      <div
        data-testid="overview-zone-map"
        className="grid grid-cols-3 gap-2"
      >
        {sorted.map(({ meta, card }) => (
          <ZoneMapItem
            key={meta.id}
            requirementId={requirementId}
            meta={meta}
            card={card ?? null}
          />
        ))}
      </div>
    </section>
  )
}

function ZoneMapItem({
  requirementId,
  meta,
  card,
}: {
  requirementId: string
  meta: ZoneMeta
  card: OverviewZoneCard | null
}) {
  const isCur = card?.state === 'cur'
  const stateClass = isCur
    ? 'bg-brand-50 border-brand'
    : 'bg-bg-subtle border-border hover:border-brand hover:shadow-md hover:bg-bg-elevated'
  return (
    <Link
      data-testid={`overview-zone-${meta.id}`}
      data-zone-id={meta.id}
      data-zone-state={card?.state ?? 'todo'}
      href={`/requirements/${requirementId}/${meta.route_segment}/`}
      className={`block border rounded-md p-3 text-left transition-all ${stateClass}`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{meta.icon}</span>
        <span className="text-sm font-semibold text-text-1 flex-1">
          {meta.name}
        </span>
        <span
          data-testid={`overview-zone-dot-${meta.id}`}
          data-status-color={meta.status_color}
          className={`w-2 h-2 rounded-full ${ZONE_STATUS_COLOR_CLASS[meta.status_color]}`}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-text-3 font-mono mt-1">
        <span>{card?.caption ?? '—'}</span>
        <span>{card?.meta ?? '—'}</span>
      </div>
    </Link>
  )
}

// ============================================================================
// 左下 · 关键里程碑时间线卡片
// ============================================================================

function MilestonesCard({
  milestones,
}: {
  milestones: OverviewMilestone[]
}) {
  const doneCount = milestones.filter((m) => m.state === 'done').length
  const curName = milestones.find((m) => m.state === 'cur')?.name ?? ''
  return (
    <section
      data-testid="overview-milestones-card"
      className="bg-bg-elevated border border-border rounded-lg p-4 shadow-sm"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold flex items-center gap-2">
          ⏱ 关键里程碑
        </h3>
        <span className="font-mono text-xs text-text-3">
          {doneCount}/{milestones.length} 已完成{curName ? ` · 当前 ${curName.split(' · ')[0]}` : ''}
        </span>
      </header>

      <ol
        data-testid="overview-timeline"
        className="relative pl-6"
      >
        {/* 中心线 */}
        <span
          aria-hidden
          className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-border"
        />
        {milestones.map((m) => (
          <TimelineNode key={m.id} node={m} />
        ))}
      </ol>
    </section>
  )
}

function TimelineNode({ node }: { node: OverviewMilestone }) {
  const dotClass =
    node.state === 'done'
      ? 'bg-success border-success'
      : node.state === 'cur'
        ? 'bg-brand border-brand ring-4 ring-brand-50'
        : 'bg-bg-elevated border-border-strong'
  return (
    <li
      data-testid={`overview-milestone-${node.id}`}
      data-milestone-state={node.state}
      className="relative pb-4 last:pb-0"
    >
      <span
        aria-hidden
        className={`absolute -left-[22px] top-1 w-3.5 h-3.5 rounded-full border-2 ${dotClass}`}
      />
      <div className="flex items-center justify-between">
        <span
          className={`text-sm font-medium ${node.state === 'todo' ? 'text-text-3' : 'text-text-1'}`}
        >
          {node.name}
        </span>
        <span className="font-mono text-xs text-text-3">{node.ts ?? '—'}</span>
      </div>
      <div className="text-xs text-text-2 mt-0.5">{node.sub}</div>
    </li>
  )
}

// ============================================================================
// 右下 · AI 活动概览卡片
// ============================================================================

function AIActivityCard({ aiActivity }: { aiActivity: OverviewAIActivity }) {
  const hours = Math.floor(aiActivity.totalActiveMinutes / 60)
  const mins = aiActivity.totalActiveMinutes % 60
  const totalText = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`
  return (
    <section
      data-testid="overview-ai-card"
      className="bg-bg-elevated border border-border rounded-lg p-4 shadow-sm"
    >
      <header className="flex items-center justify-between mb-3">
        <h3 className="text-md font-semibold flex items-center gap-2">
          🤖 AI 活动概览
        </h3>
        <span
          data-testid="overview-ai-total"
          className="font-mono text-xs text-text-3"
        >
          总活跃 {totalText}
        </span>
      </header>

      {/* 3 stat cell */}
      <div
        data-testid="overview-ai-stats"
        className="grid grid-cols-3 gap-3"
      >
        <AIStatCell n={aiActivity.totalLinesWritten} label="总写入行" />
        <AIStatCell n={aiActivity.skillCalls} label="Skill 调用" />
        <AIStatCell n={aiActivity.snapshotCount} label="快照数" />
      </div>

      {/* 工位活跃度 */}
      <div className="mt-4">
        <div className="text-xs text-text-3 uppercase tracking-wider font-medium mb-2">
          AI 在各工位活跃度
        </div>
        <ul
          data-testid="overview-ai-zones"
          className="flex flex-col gap-2"
        >
          {aiActivity.zones.map((z) => (
            <ZoneActivityRow key={z.zoneId} zoneId={z.zoneId} percent={z.percent} />
          ))}
        </ul>
      </div>
    </section>
  )
}

function AIStatCell({ n, label }: { n: number; label: string }) {
  return (
    <div className="p-3 bg-bg-subtle rounded-md text-center">
      <div className="text-lg font-semibold font-mono text-text-1">{n}</div>
      <div className="text-xs text-text-3 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  )
}

function ZoneActivityRow({
  zoneId,
  percent,
}: {
  zoneId: string
  percent: number
}) {
  const meta = ZONE_META.find((z) => z.id === zoneId)
  return (
    <li
      data-testid={`overview-ai-zone-${zoneId}`}
      data-percent={percent}
      className="flex items-center gap-2 text-xs"
    >
      <span className="w-[90px] text-text-2">{meta?.name ?? zoneId}</span>
      <span className="flex-1 h-1.5 bg-bg-subtle rounded-full overflow-hidden">
        <span
          className="block h-full bg-brand rounded-full"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="font-mono text-text-3 w-[30px] text-right">
        {percent}%
      </span>
    </li>
  )
}