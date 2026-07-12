'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  type WrapupAc,
  type WrapupAIActivity,
  type WrapupArchive,
  type WrapupArchivePayload,
  type WrapupArtifact,
  type WrapupArtifactKind,
  type WrapupChangeStats,
  type WrapupData,
  type WrapupDecision,
  type WrapupHero,
  type WrapupPr,
  type WrapupReopenPayload,
  type WrapupReportStat,
} from '@/lib/wrapup'
import { EmptyState } from './empty-state'

/**
 * WRAP-UP 工位组件(ADR-0011 §6 WRAP-UP 布局 · issue 22)
 *
 * 视觉对照基线:[11f-stage-adaptive-archive.html](../../../../docs/design/pages/11f-stage-adaptive-archive.html)
 *
 * 布局(资源树 + 主区 —— ZoneShell 自动 grid-cols-[240px_1fr]):
 * ┌────────┬──────────────────────────────────────────────────────┐
 * │ 资源树 │ Stage strip(⑥ 完成 + WRAP-UP · Archive)               │
 * │ 240px  ├──────────────────────────────────────────────────────┤
 * │        │ Toolbar(面包屑 + [📊导出][📚沉淀][📤分享][📦归档])        │
 * │ 产物   ├──────────────────────────────────────────────────────┤
 * │ PR     │ 主区:                                                    │
 * │ 决策   │   1. 顶部回顾报告 hero(✓ + 起始/完成/耗时 + 4 个数字)    │
 * │        │   2. AC 通过情况(验收标准 · 3/3 通过)                      │
 * │        │   3. 产物清单卡片网格(6 张)                                │
 * │        │   4. 关联 PR(4 已合并)                                    │
 * │        │   5. 关键决策回顾(5 次 AI 提问)                            │
 * │        │   6. 变更统计 + AI 活动                                   │
 * │        │   7. 归档操作([📦 归档] / [🔄 重新打开])                  │
 * └────────┴──────────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - 'use client':归档 / 重新打开是客户端交互
 * - archive.archived 同时支持 server 预置(SSR 兜底)和 useState 维护
 * - ZoneBar WRAP-UP 灰点 已由 zones.ts['wrapup'].status_color='gray' 渲染
 * - ThinkBar minimal 已由 ThinkBarSlot 根据 zone.thinking_bar='minimal' 渲染
 * - 资源树 240px 由 ZoneShell 自动渲染(WRAP-UP has_resource_tree=true)
 * - 默认 no-op 回调:server 直接渲染组件时不会抛错(空回退)
 */

export interface WrapupZoneProps {
  data: WrapupData
  /** 归档触发 —— page 层接 API:把需求状态改为 ARCHIVED */
  onArchive?: (payload: WrapupArchivePayload) => void
  /** 重新打开触发 —— 从 ARCHIVED → EXECUTING(或 designing) */
  onReopen?: (payload: WrapupReopenPayload) => void
}

/** 默认 no-op 回调 —— server component 直接渲染时使用 */
const NOOP_ARCHIVE = (_payload: WrapupArchivePayload) => {}
const NOOP_REOPEN = (_payload: WrapupReopenPayload) => {}

export function WrapupZone({
  data,
  onArchive = NOOP_ARCHIVE,
  onReopen = NOOP_REOPEN,
}: WrapupZoneProps) {
  if (data.empty) {
    return <EmptyWrapup data={data} />
  }

  return (
    <WrapupContent
      data={data}
      onArchive={onArchive}
      onReopen={onReopen}
    />
  )
}

// ============================================================================
// 空态(引导去 EXECUTING)
// ============================================================================

function EmptyWrapup({ data }: { data: WrapupData }) {
  return (
    <main
      data-testid="wrapup-zone"
      data-requirement-id={data.requirementId}
      data-empty="true"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="📦"
          title="WRAP-UP 工位暂无可归档内容"
          subtitle="这个需求还没有完成。先去 EXECUTING 工位让 AI 完成实施,完成后再来这里归档复盘。"
          cta={{
            label: '→ 进入 EXECUTING 工位',
            href: `/requirements/${data.requirementId}/executing`,
          }}
        />
      </div>
    </main>
  )
}

// ============================================================================
// 主内容
// ============================================================================

function WrapupContent({
  data,
  onArchive,
  onReopen,
}: Required<Pick<WrapupZoneProps, 'data' | 'onArchive' | 'onReopen'>>) {
  // archive.archived 状态由组件 useState 维护(也允许 server 预置作 SSR 兜底)
  const [archived, setArchived] = useState<boolean>(data.archive.archived)

  const handleArchive = () => {
    if (archived) return
    setArchived(true)
    onArchive({})
  }

  const handleReopen = () => {
    if (!archived) return
    setArchived(false)
    onReopen({ toZone: 'executing' })
  }

  return (
    <main
      data-testid="wrapup-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      data-archived={archived ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <StageStrip stage={data.stage} />
      <Toolbar toolbar={data.toolbar} archived={archived} />
      <div
        data-testid="wrapup-main"
        className="flex-1 overflow-auto px-6 py-6 flex flex-col gap-4"
      >
        <ReportHero
          hero={data.hero}
          reportStats={data.reportStats}
          archived={archived}
        />
        <AcSection acs={data.acs} />
        <ArtifactGrid artifacts={data.artifacts} />
        <PrSection prs={data.prs} />
        <DecisionSection decisions={data.decisions} />
        <StatsFooter changes={data.changes} ai={data.ai} />
        <ArchiveActions
          requirementId={data.requirementId}
          archived={archived}
          onArchive={handleArchive}
          onReopen={handleReopen}
        />
      </div>
    </main>
  )
}

// ============================================================================
// Stage strip(顶部状态条 · 绿色基调表示成功状态)
// ============================================================================

function StageStrip({ stage }: { stage: WrapupData['stage'] }) {
  return (
    <div
      data-testid="wrapup-stage-strip"
      className="bg-gradient-to-r from-[#f0fdf4] to-[#f0fdf4]/40 border-b border-border px-6 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2 font-semibold text-md text-[#15803d]">
        <span
          data-testid="wrapup-stage-badge"
          className="bg-success text-white text-xs font-medium px-2 py-0.5 rounded"
        >
          {stage.badge}
        </span>
        <span data-testid="wrapup-stage-title">{stage.title}</span>
      </div>
      <div
        data-testid="wrapup-stage-meta"
        className="font-mono text-sm text-[#15803d] flex items-center gap-3"
      >
        <span data-testid="wrapup-stage-meta-text">{stage.meta}</span>
      </div>
    </div>
  )
}

// ============================================================================
// Toolbar(面包屑 + 操作按钮)
// ============================================================================

function Toolbar({
  toolbar,
  archived,
}: {
  toolbar: WrapupData['toolbar']
  archived: boolean
}) {
  return (
    <div
      data-testid="wrapup-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="wrapup-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={
              c.current ? 'wrapup-crumb-current' : 'wrapup-crumb-item'
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="wrapup-toolbar-export"
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-transparent text-text-2 hover:bg-bg-subtle"
        >
          📊 导出报告
        </button>
        <button
          type="button"
          data-testid="wrapup-toolbar-distill"
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          📚 沉淀到知识库
        </button>
        <button
          type="button"
          data-testid="wrapup-toolbar-share"
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          📤 分享给团队
        </button>
        <button
          type="button"
          data-testid="wrapup-toolbar-archive"
          disabled={archived}
          onClick={() => {
            /* 由 ArchiveActions 的 handleArchive 负责;toolbar 按钮聚焦到该 section */
          }}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-success text-white hover:bg-[#15803d] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          📦 归档此需求
        </button>
        <span className="font-mono text-xs text-text-3">形态:📦 Archive</span>
      </div>
    </div>
  )
}

// ============================================================================
// Report hero(顶部回顾报告)
// ============================================================================

function ReportHero({
  hero,
  reportStats,
  archived,
}: {
  hero: WrapupHero
  reportStats: WrapupReportStat[]
  archived: boolean
}) {
  return (
    <section
      data-testid="wrapup-hero"
      data-archived={archived ? 'true' : 'false'}
      className="bg-gradient-to-br from-[#f0fdf4] to-[#f0fdf4]/40 border border-[#bbf7d0] rounded-xl px-6 py-5 flex items-center gap-6"
    >
      <div
        data-testid="wrapup-hero-check"
        className="w-[72px] h-[72px] rounded-full bg-success text-white flex items-center justify-center text-3xl shrink-0 shadow-[0_0_0_6px_rgba(22,163,74,.15)]"
      >
        ✓
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="wrapup-hero-title"
          className="text-xl font-semibold text-[#15803d] mb-1"
        >
          {hero.title}
        </div>
        <div
          data-testid="wrapup-hero-desc"
          className="text-text-2 text-sm leading-relaxed"
        >
          起始 <strong className="text-text-1">{hero.startDate}</strong> · 完成{' '}
          <strong className="text-text-1">{hero.endDate}</strong> · 耗时{' '}
          <strong className="text-text-1">{hero.duration}</strong>
          · 验收标准 <strong className="text-text-1">{hero.acPassRate}</strong> ·
          AI 自动完成 <strong className="text-text-1">{hero.aiPercent}%</strong> ·
          人工介入{' '}
          <strong className="text-text-1">
            {hero.manualInterventions} 次
          </strong>
        </div>
        <div
          data-testid="wrapup-hero-stats"
          className="grid grid-cols-4 gap-3 mt-3"
        >
          {reportStats.map((s) => (
            <div
              key={s.label}
              data-testid="wrapup-hero-stat"
              className="text-center px-2 py-2 bg-white/60 rounded-md"
            >
              <div className="text-xl font-semibold text-[#15803d] font-mono leading-tight">
                {s.value}
              </div>
              <div className="text-xs text-text-3 uppercase tracking-wider mt-0.5">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ============================================================================
// AC 通过情况
// ============================================================================

function AcSection({ acs }: { acs: WrapupAc[] }) {
  const passedCount = acs.filter((a) => a.passed).length
  return (
    <section
      data-testid="wrapup-ac-section"
      data-passed-count={String(passedCount)}
      data-total-count={String(acs.length)}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
        <h2 className="text-md font-semibold flex items-center gap-2">
          🎯 验收标准 · {passedCount}/{acs.length} 通过
        </h2>
        <span className="font-mono text-xs text-text-3">⌘⇧A AC 配置</span>
      </header>
      <div className="p-4 flex flex-col gap-2">
        {acs.map((ac) => (
          <AcItem key={ac.id} ac={ac} />
        ))}
      </div>
    </section>
  )
}

function AcItem({ ac }: { ac: WrapupAc }) {
  return (
    <div
      data-testid="wrapup-ac-item"
      data-ac-id={ac.id}
      data-passed={ac.passed ? 'true' : 'false'}
      className={`flex items-start gap-3 p-3 rounded-md border-l-[3px] ${
        ac.passed
          ? 'border-l-success bg-bg-subtle'
          : 'border-l-error bg-bg-subtle'
      }`}
    >
      <div
        data-testid="wrapup-ac-checkbox"
        className={`w-[18px] h-[18px] rounded-full text-white flex items-center justify-center text-[11px] shrink-0 mt-px ${
          ac.passed ? 'bg-success' : 'bg-error'
        }`}
      >
        {ac.passed ? '✓' : '✗'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-text-1 mb-0.5">
          {ac.id} · {ac.title}
        </div>
        <div
          data-testid="wrapup-ac-metrics"
          className="font-mono text-xs text-text-3 flex items-center gap-3 flex-wrap"
        >
          <span>
            实测{' '}
            <span
              className={`font-semibold ${
                ac.passed ? 'text-success' : 'text-error'
              }`}
            >
              {ac.measured}
            </span>
          </span>
          {ac.metrics.map((m) => (
            <span key={m.label} className="flex items-center gap-1.5">
              <span className="text-text-3">·</span>
              <span>{m.label}</span>
              <span
                className={`font-semibold ${
                  m.tone === 'good'
                    ? 'text-success'
                    : m.tone === 'bad'
                      ? 'text-error'
                      : 'text-text-1'
                }`}
              >
                {m.value}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// 产物清单(卡片网格)
// ============================================================================

const ARTIFACT_KIND_BG: Record<WrapupArtifactKind, string> = {
  sql: 'bg-sky-500',
  api: 'bg-violet-500',
  config: 'bg-amber-500',
  doc: 'bg-emerald-500',
  sequence: 'bg-emerald-500',
  markdown: 'bg-emerald-500',
}

function ArtifactGrid({ artifacts }: { artifacts: WrapupArtifact[] }) {
  return (
    <section
      data-testid="wrapup-artifact-section"
      data-count={String(artifacts.length)}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
        <h2 className="text-md font-semibold flex items-center gap-2">
          📦 产物清单 · {artifacts.length}
        </h2>
        <span className="font-mono text-xs text-text-3">⌘⇧F 产物列表</span>
      </header>
      <div className="p-4">
        <div
          data-testid="wrapup-artifact-grid"
          className="grid gap-3"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          }}
        >
          {artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      </div>
    </section>
  )
}

function ArtifactCard({ artifact }: { artifact: WrapupArtifact }) {
  const { id, kind, typeLabel, name, href, preview, status, date, prSha } =
    artifact
  return (
    <a
      href={href}
      data-testid="wrapup-artifact-card"
      data-artifact-id={id}
      data-kind={kind}
      data-status={status}
      className="bg-bg-subtle border border-border rounded-md p-3 transition-all hover:border-brand hover:shadow-md hover:-translate-y-px block"
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          data-testid="wrapup-artifact-type"
          data-kind={kind}
          className={`w-8 h-8 rounded-sm flex items-center justify-center text-sm text-white font-semibold shrink-0 ${ARTIFACT_KIND_BG[kind]}`}
        >
          {typeLabel}
        </span>
        <span
          data-testid="wrapup-artifact-name"
          className="font-mono text-sm font-medium text-text-1 truncate"
        >
          {name}
        </span>
      </div>
      <div
        data-testid="wrapup-artifact-preview"
        className="bg-bg-elevated rounded-sm p-2 font-mono text-[11px] text-text-2 leading-snug max-h-[60px] overflow-hidden my-2 whitespace-pre-wrap"
      >
        {preview}
      </div>
      <div className="flex items-center justify-between text-xs text-text-3 pt-2 border-t border-border">
        <span
          data-testid="wrapup-artifact-card-status"
          data-status={status}
          className={`flex items-center gap-1 ${
            status === 'ok' ? 'text-[#15803d]' : 'text-[#92400e]'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              status === 'ok' ? 'bg-success' : 'bg-warning'
            }`}
          />
          {status === 'ok' ? '已采纳' : '已审'}
        </span>
        <span data-testid="wrapup-artifact-date" className="font-mono">
          {date}
          {prSha ? ` · ${prSha}` : ''}
        </span>
      </div>
    </a>
  )
}

// ============================================================================
// 关联 PR / Commit
// ============================================================================

function PrSection({ prs }: { prs: WrapupPr[] }) {
  return (
    <section
      data-testid="wrapup-pr-section"
      data-count={String(prs.length)}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
        <h2 className="text-md font-semibold flex items-center gap-2">
          📤 关联 PR · {prs.length} 已合并
        </h2>
        <span className="font-mono text-xs text-text-3">⌘⇧P PR 列表</span>
      </header>
      <div className="p-4 flex flex-col gap-2">
        {prs.map((p) => (
          <PrItem key={p.id} pr={p} />
        ))}
      </div>
    </section>
  )
}

function PrItem({ pr }: { pr: WrapupPr }) {
  return (
    <div
      data-testid="wrapup-pr-item"
      data-pr-id={pr.id}
      data-sha={pr.sha}
      className="bg-bg-subtle border border-border rounded-md p-3 flex items-center gap-3"
    >
      <div
        data-testid="wrapup-pr-status"
        className="w-6 h-6 rounded-full bg-[#d1fae5] text-[#065f46] flex items-center justify-center text-sm shrink-0"
      >
        ✓
      </div>
      <div className="flex-1 min-w-0">
        <div
          data-testid="wrapup-pr-title"
          className="text-sm text-text-1 font-medium mb-0.5 truncate"
        >
          {pr.title}
        </div>
        <div
          data-testid="wrapup-pr-meta"
          className="text-xs text-text-3 flex items-center gap-3 flex-wrap font-mono"
        >
          <span>{pr.sha}</span>
          <span className="text-text-3">·</span>
          <span>{pr.repo}</span>
          <span className="text-text-3">·</span>
          <span>
            <span className="text-success font-medium">+{pr.added}</span>{' '}
            <span className="text-error font-medium">/-{pr.removed}</span>
          </span>
          <span className="text-text-3">·</span>
          <span>{pr.tests} tests ✓</span>
          <span className="text-text-3">·</span>
          <span>{pr.reviews} review</span>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        {pr.diffHref && (
          <a
            href={pr.diffHref}
            data-testid="wrapup-pr-diff"
            className="text-xs px-2 py-1 bg-bg-elevated border border-border rounded-sm text-text-1 hover:border-brand hover:text-brand-600"
          >
            📄 看 Diff
          </a>
        )}
        {pr.href && (
          <a
            href={pr.href}
            data-testid="wrapup-pr-open"
            className="text-xs px-2 py-1 bg-bg-elevated border border-border rounded-sm text-text-1 hover:border-brand hover:text-brand-600"
          >
            🔗 打开 PR
          </a>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// 关键决策回顾(用户在 CLARIFYING / DESIGNING 的选择记录)
// ============================================================================

function DecisionSection({ decisions }: { decisions: WrapupDecision[] }) {
  return (
    <section
      data-testid="wrapup-decision-section"
      data-count={String(decisions.length)}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
        <h2 className="text-md font-semibold flex items-center gap-2">
          💬 关键决策回顾 · {decisions.length} 次 AI 提问
        </h2>
        <span className="font-mono text-xs text-text-3">⌘⇧D 对话历史</span>
      </header>
      <div className="p-4 flex flex-col gap-2">
        {decisions.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </div>
    </section>
  )
}

function DecisionRow({ decision }: { decision: WrapupDecision }) {
  return (
    <div
      data-testid="wrapup-decision-row"
      data-decision-id={decision.id}
      className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-3 py-2 bg-bg-subtle rounded-md text-sm"
    >
      <span
        data-testid="wrapup-decision-qid"
        className="font-mono text-xs text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded-sm font-medium"
      >
        {decision.id}
      </span>
      <span
        data-testid="wrapup-decision-question"
        className="text-text-1"
      >
        {decision.question}
      </span>
      <span
        data-testid="wrapup-decision-answer"
        className="text-text-2 text-xs"
      >
        采纳:{' '}
        <strong className="text-text-1 font-medium">{decision.answer}</strong> · ⏱{' '}
        {decision.duration}
      </span>
    </div>
  )
}

// ============================================================================
// 底部变更统计 + AI 活动
// ============================================================================

function StatsFooter({
  changes,
  ai,
}: {
  changes: WrapupChangeStats
  ai: WrapupAIActivity
}) {
  return (
    <section
      data-testid="wrapup-stats-footer"
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <div
        data-testid="wrapup-changes"
        className="grid grid-cols-4 gap-3 p-4 border-b border-border"
      >
        <Stat
          testId="wrapup-changes-added"
          label="新增"
          value={`+${changes.added}`}
          tone="good"
        />
        <Stat
          testId="wrapup-changes-removed"
          label="删除"
          value={`-${changes.removed}`}
          tone="bad"
        />
        <Stat
          testId="wrapup-changes-files"
          label="文件数"
          value={String(changes.files)}
          tone="normal"
        />
        <Stat
          testId="wrapup-changes-repos"
          label="仓库数"
          value={String(changes.repos)}
          tone="normal"
        />
      </div>
      <div
        data-testid="wrapup-ai-activity"
        className="grid grid-cols-4 gap-3 p-4 bg-bg-subtle"
      >
        <Stat
          testId="wrapup-ai-writes"
          label="总写入"
          value={String(ai.totalWrites)}
        />
        <Stat
          testId="wrapup-ai-thinking"
          label="思考时长"
          value={`${ai.thinkingTimeMinutes}m`}
        />
        <Stat
          testId="wrapup-ai-snapshots"
          label="快照数"
          value={String(ai.snapshotCount)}
        />
        <Stat
          testId="wrapup-ai-skills"
          label="Skill 调用"
          value={String(ai.skillInvocations)}
        />
      </div>
    </section>
  )
}

function Stat({
  testId,
  label,
  value,
  tone = 'normal',
}: {
  testId: string
  label: string
  value: string
  tone?: 'good' | 'bad' | 'normal'
}) {
  const valueCls =
    tone === 'good'
      ? 'text-success'
      : tone === 'bad'
        ? 'text-error'
        : 'text-text-1'
  return (
    <div data-testid={testId} className="text-center">
      <div className={`text-2xl font-mono font-semibold ${valueCls}`}>
        {value}
      </div>
      <div className="text-xs text-text-3 uppercase tracking-wider mt-0.5">
        {label}
      </div>
    </div>
  )
}

// ============================================================================
// 归档操作([📦 归档] / [🔄 重新打开])
// ============================================================================

function ArchiveActions({
  requirementId,
  archived,
  onArchive,
  onReopen,
}: {
  requirementId: string
  archived: boolean
  onArchive: () => void
  onReopen: () => void
}) {
  return (
    <section
      data-testid="wrapup-archive-actions"
      data-archived={archived ? 'true' : 'false'}
      className="bg-bg-elevated border border-border rounded-lg p-5 flex items-center justify-between gap-4"
    >
      <div className="flex-1 min-w-0">
        <div className="text-md font-semibold flex items-center gap-2">
          {archived ? '✅ 已归档' : '📦 准备归档'}
        </div>
        <div className="text-sm text-text-3 mt-1">
          {archived
            ? '需求已归档到只读区。可重新打开回到 EXECUTING 工位继续。'
            : '归档后只读,不可编辑。可同步沉淀知识库条目(可选)。'}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {archived ? (
          <>
            <Link
              href={`/requirements/${requirementId}/executing`}
              data-testid="wrapup-archive-go-executing"
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
            >
              → 跳到 EXECUTING
            </Link>
            <button
              type="button"
              data-testid="wrapup-reopen"
              onClick={onReopen}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600"
            >
              🔄 重新打开
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid="wrapup-archive"
            onClick={onArchive}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-sm font-medium bg-success text-white hover:bg-[#15803d]"
          >
            📦 归档此需求
          </button>
        )}
      </div>
    </section>
  )
}
