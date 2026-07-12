'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  type DesigningCandidate,
  type DesigningCandidateId,
  type DesigningCandidateMetric,
  type DesigningCandidateTag,
  type DesigningData,
  type DesigningRegeneratePayload,
  type DesigningSelectPayload,
  type DesigningTocItem,
  type DesigningTradeoffRow,
} from '@/lib/designing'
import { EmptyState } from './empty-state'

/**
 * DESIGNING 工位组件(ADR-0011 §6 DESIGNING 布局 · issue 21)
 *
 * 视觉对照基线:[11c-stage-adaptive-designing.html](../../../../docs/design/pages/11c-stage-adaptive-designing.html)
 *
 * 布局(主区全宽,无资源树 / 无 Inline 栏 —— ZoneShell 自动 grid-cols-1):
 * ┌──────────────────────────────────────────────────────────────┐
 * │ Stage strip(④ 设计 + DESIGNING · Compare)                       │
 * ├──────────────────────────────────────────────────────────────┤
 * │ Toolbar(面包屑 + 形态标签 + [↻ 让 AI 重新生成])                  │
 * ├──────────────────────────────────────────────────────────────┤
 * │ Compare 主区(两栏:左设计文档 / 右 3 候选卡片):                     │
 * │   ┌─ 设计文档 ─────────┬─ 候选 A ─┬─ 候选 B(推荐) ─┬─ 候选 C ─┐│
 * │   │ · TOC 锚点           │ ✓ 实现简 │ ✓ 容错好         │ ✓ 一致 ││
 * │   │ · markdown 多段      │ ✗ 性能差 │ ✓ 性能好         │ ✗ 成本 ││
 * │   │                     │ 250ms   │ 80ms             │ 320ms  ││
 * │   │                     │ [✓ 采纳] │ [✓ 采纳]         │ [✓ 采纳]││
 * │   └────────────────────┴──────────┴─────────────────┴──────────┘│
 * ├──────────────────────────────────────────────────────────────┤
 * │ 底部"取舍点详情 + AI 建议"卡                                      │
 * ├──────────────────────────────────────────────────────────────┤
 * │ ✏️ 自定义调整输入框 + 提交                                         │
 * └──────────────────────────────────────────────────────────────┘
 *
 * 选中后:右下弹"切到 EXECUTING 吗?"决策卡(非自动跳转,决策 15 反对状态机)
 *
 * 设计要点:
 * - 'use client':采纳 / 重做 / 自定义 / 关闭决策卡都是客户端交互
 * - selectedCandidateId 同时支持 server 预置(SSR 兜底)和 useState 维护
 * - ZoneBar 黄点已由 zones.ts['designing'].status_color='yellow' 渲染(决策 22)
 * - 默认 no-op 回调:server 直接渲染组件时不会抛错(空回退)
 */
export interface DesigningZoneProps {
  data: DesigningData
  /** 采纳候选方案触发(payload.candidateId);page 层接 AI / 路由跳转 */
  onSelect?: (payload: DesigningSelectPayload) => void
  /** 让 AI 重新生成(payload.hint 可选);page 层接 AI Skill 触发 */
  onRegenerate?: (payload: DesigningRegeneratePayload) => void
}

/** 默认 no-op 回调 —— server component 直接渲染时使用 */
const NOOP_SELECT = (_payload: DesigningSelectPayload) => {}
const NOOP_REGENERATE = (_payload: DesigningRegeneratePayload) => {}

export function DesigningZone({
  data,
  onSelect = NOOP_SELECT,
  onRegenerate = NOOP_REGENERATE,
}: DesigningZoneProps) {
  if (data.empty) {
    return <EmptyDesigning data={data} />
  }

  return (
    <DesigningContent
      data={data}
      onSelect={onSelect}
      onRegenerate={onRegenerate}
    />
  )
}

// ============================================================================
// 空态(引导去 ANALYZING — DESIGNING 需要先有 AI 分析流才能产出方案)
// ============================================================================

function EmptyDesigning({ data }: { data: DesigningData }) {
  return (
    <main
      data-testid="designing-zone"
      data-requirement-id={data.requirementId}
      data-empty="true"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="🎨"
          title="DESIGNING 工位暂无方案"
          subtitle="这个需求还没有候选方案。先去 ANALYZING 工位让 AI 解析需求,分析完成后会自动生成候选方案。"
          cta={{
            label: '→ 进入 ANALYZING 工位',
            href: `/requirements/${data.requirementId}/analyzing`,
          }}
        />
      </div>
    </main>
  )
}

// ============================================================================
// 主内容
// ============================================================================

function DesigningContent({
  data,
  onSelect,
  onRegenerate,
}: Required<Pick<DesigningZoneProps, 'data' | 'onSelect' | 'onRegenerate'>>) {
  // 已选 id(允许 server 预置作 SSR 兜底)
  const [selectedId, setSelectedId] = useState<DesigningCandidateId | null>(
    data.selectedCandidateId,
  )
  const [dismissDecision, setDismissDecision] = useState(false)
  // 决策卡只在 selectedId 变化后未关闭时显示;切换选择不清空(连续选)
  const showDecisionBar = selectedId !== null && !dismissDecision

  const handleAdopt = (candidateId: DesigningCandidateId) => {
    setSelectedId(candidateId)
    setDismissDecision(false)
    onSelect({ candidateId })
  }

  return (
    <main
      data-testid="designing-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      data-selected={selectedId ?? ''}
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <StageStrip stage={data.stage} selectedId={selectedId} />
      <Toolbar
        toolbar={data.toolbar}
        onRegenerate={() => onRegenerate({})}
      />
      <div
        data-testid="designing-main"
        className="flex-1 overflow-auto px-6 py-6 flex flex-col gap-5"
      >
        <CompareHeader
          candidates={data.candidates}
          selectedId={selectedId}
        />
        <div className="grid grid-cols-[minmax(0,_320px)_1fr] gap-5">
          <DesignDocPanel doc={data.designDoc} />
          <div
            data-testid="designing-candidates"
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {data.candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                selected={selectedId === c.id}
                onAdopt={() => handleAdopt(c.id)}
              />
            ))}
          </div>
        </div>

        <Tradeoff tradeoff={data.tradeoff} />
        <CustomTune onRegenerate={onRegenerate} />
      </div>

      {showDecisionBar && selectedId && (
        <DecisionBar
          requirementId={data.requirementId}
          candidateId={selectedId}
          candidates={data.candidates}
          onStay={() => setDismissDecision(true)}
        />
      )}
    </main>
  )
}

// ============================================================================
// Stage strip(顶部状态条)
// ============================================================================

function StageStrip({
  stage,
  selectedId,
}: {
  stage: DesigningData['stage']
  selectedId: DesigningCandidateId | null
}) {
  return (
    <div
      data-testid="designing-stage-strip"
      className="bg-gradient-to-r from-brand-50 to-brand-50/30 border-b border-border px-6 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2 font-semibold text-md text-brand-700">
        <span
          data-testid="designing-stage-badge"
          className="bg-brand text-white text-xs font-medium px-2 py-0.5 rounded"
        >
          {stage.badge}
        </span>
        <span data-testid="designing-stage-title">{stage.title}</span>
      </div>
      <div
        data-testid="designing-stage-meta"
        className="font-mono text-sm text-brand-600 flex items-center gap-3"
      >
        <span>
          {selectedId ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />
              已选 {selectedId} · 待切工位
            </span>
          ) : (
            <span>{stage.meta}</span>
          )}
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// Toolbar(面包屑 + 形态标签 + 重新生成按钮)
// ============================================================================

function Toolbar({
  toolbar,
  onRegenerate,
}: {
  toolbar: DesigningData['toolbar']
  onRegenerate: () => void
}) {
  return (
    <div
      data-testid="designing-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="designing-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={
              c.current ? 'designing-crumb-current' : 'designing-crumb-item'
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
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="designing-toolbar-regenerate"
          onClick={onRegenerate}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          ↻ 让 AI 重新生成
        </button>
        <span className="font-mono text-xs text-text-3">形态:⚖️ Compare</span>
      </div>
    </div>
  )
}

// ============================================================================
// Compare header(标题 + 已选提示)
// ============================================================================

function CompareHeader({
  candidates,
  selectedId,
}: {
  candidates: DesigningCandidate[]
  selectedId: DesigningCandidateId | null
}) {
  return (
    <div
      data-testid="designing-compare-header"
      className="flex items-center justify-between"
    >
      <div className="text-xl font-bold flex items-center gap-2">
        候选方案对比
        <span
          data-testid="designing-compare-count"
          className="bg-brand-50 text-brand-600 px-2 py-0.5 rounded-full text-sm font-mono"
        >
          {candidates.length}
        </span>
      </div>
      <div
        data-testid="designing-compare-subtitle"
        className="text-sm text-text-3"
      >
        {selectedId
          ? `已选 ${selectedId} · 可"留在此处"或切到 EXECUTING`
          : '选定后进入「实施」工位(非自动跳转,符合决策 15)'}
      </div>
    </div>
  )
}

// ============================================================================
// 设计文档面板(左侧)
// ============================================================================

function DesignDocPanel({ doc }: { doc: DesigningData['designDoc'] }) {
  return (
    <section
      data-testid="designing-design-doc"
      className="bg-bg-elevated border border-border rounded-xl overflow-hidden flex flex-col h-full"
    >
      <header className="px-4 py-3 border-b border-border bg-bg-subtle">
        <h2
          data-testid="designing-design-doc-title"
          className="text-md font-semibold flex items-center gap-2"
        >
          📄 {doc.title}
        </h2>
      </header>
      <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">
        <Toc items={doc.toc} />
        <DocBody markdown={doc.markdown} />
      </div>
    </section>
  )
}

/**
 * heading 文本 → 锚点 id 的 slug 规则。
 * 与 DocBody 内的 h2 id 必须使用同一函数,否则 TOC 锚点跳不到位置。
 * 简单实现:去空格,保留中英文与数字(HTML5 id 允许任意字符,但用 ASCII 更通用)。
 */
function headingSlug(heading: string): string {
  return heading.replace(/\s+/g, '-').toLowerCase()
}

/**
 * 简易 markdown → React 节点转换(适配 issue 21 DESIGNING 设计文档):
 * - `## heading` → `<h2 id={slug(heading)}>`(供 TOC 锚点用)
 * - 空行 → 段落分隔
 * - 其它行 → `<p>` 段落
 *
 * 不引第三方 markdown 库(避免给本期 mock 数据增加无关依赖);
 * 后续接 DesignDoc Skill 写正式文档时,改用 ReactMarkdown。
 */
function DocBody({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n')
  const blocks: React.ReactNode[] = []
  let paragraphBuffer: string[] = []

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return
    const text = paragraphBuffer.join(' ').trim()
    paragraphBuffer = []
    if (!text) return
    blocks.push(
      <p
        key={`p-${blocks.length}`}
        className="text-sm text-text-1 leading-relaxed"
      >
        {text}
      </p>,
    )
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flushParagraph()
      const heading = line.slice(3).trim()
      blocks.push(
        <h2
          key={`h-${blocks.length}`}
          id={headingSlug(heading)}
          data-doc-heading
          data-heading-slug={headingSlug(heading)}
          className="text-md font-semibold text-text-1 mt-2 first:mt-0 scroll-mt-2"
        >
          {heading}
        </h2>,
      )
    } else if (line.trim() === '') {
      flushParagraph()
    } else {
      paragraphBuffer.push(line.trim())
    }
  }
  flushParagraph()

  return (
    <div
      data-testid="designing-design-doc-body"
      className="flex flex-col gap-2"
    >
      {blocks}
    </div>
  )
}

function Toc({ items }: { items: DesigningTocItem[] }) {
  if (items.length === 0) return null
  return (
    <nav
      data-testid="designing-doc-toc"
      aria-label="设计文档目录"
      className="text-xs border border-border rounded-md p-2 bg-bg-subtle"
    >
      <div className="text-text-3 uppercase tracking-wider mb-1.5 px-1">目录</div>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li
            key={item.id}
            data-testid="designing-toc-item"
            data-toc-id={item.id}
            data-toc-level={item.level}
            style={{ paddingLeft: `${item.level * 12}px` }}
          >
            <a
              href={`#${item.id}`}
              className="block px-2 py-1 rounded text-text-2 hover:bg-bg-elevated hover:text-brand-600"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// ============================================================================
// 候选方案卡片(对比面板右侧)
// ============================================================================

function CandidateCard({
  candidate,
  selected,
  onAdopt,
}: {
  candidate: DesigningCandidate
  selected: boolean
  onAdopt: () => void
}) {
  const { id, title, tag, pros, cons, metrics, recommended } = candidate
  return (
    <article
      data-testid="designing-candidate-card"
      data-candidate-id={id}
      data-recommended={recommended ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      className={`bg-bg-elevated border rounded-xl overflow-hidden flex flex-col ${
        selected
          ? 'border-brand shadow-[0_0_0_3px_var(--brand-50)]'
          : recommended
            ? 'border-brand bg-brand-50/30'
            : 'border-border'
      }`}
    >
      <header
        className={`px-4 py-3 border-b border-border flex items-center gap-2 font-bold text-md ${
          selected || recommended ? 'bg-brand-50 text-brand-700' : ''
        }`}
      >
        <span data-testid="designing-candidate-id-label">{id} ·</span>
        <span>{title}</span>
        <TagBadge tag={tag} />
      </header>

      {/* 等待决策状态点:Yellow(决策 22);selected 后切到绿色"已选"点 */}
      <div
        data-testid="designing-card-status"
        data-status={selected ? 'chosen' : 'awaiting'}
        className="px-4 py-1.5 flex items-center gap-1.5 text-xs bg-bg-subtle border-b border-border text-text-3"
      >
        <span
          aria-hidden
          className={`w-1.5 h-1.5 rounded-full ${
            selected ? 'bg-success' : 'bg-yellow-500'
          }`}
        />
        <span>{selected ? `已选 ${id}` : '等待决策'}</span>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-3">
        <ProsCons pros={pros} cons={cons} />
        <Metrics metrics={metrics} />
      </div>

      <footer className="px-4 py-3 border-t border-border">
        <button
          type="button"
          data-testid="designing-candidate-adopt"
          onClick={onAdopt}
          className={
            selected || recommended
              ? 'w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600'
              : 'w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle'
          }
        >
          {selected ? `✓ 已选 ${id}` : `✓ 采纳 ${id}`}
        </button>
      </footer>
    </article>
  )
}

/**
 * 候选 tag variant → tailwind 类映射(集中维护避免 Shotgun Surgery)。
 * 对齐 clarifying-zone 的 HISTORY_STATUS_VIEW / analyzing-zone 的 TONE_BG 模式:
 * Record<Variant, string>,新增 variant 只改这张表。
 */
const CANDIDATE_TAG_CLASS: Record<DesigningCandidateTag['variant'], string> = {
  simple: 'bg-bg-subtle text-text-2 font-medium',
  recommended: 'bg-brand text-white font-semibold',
  strict: 'bg-warning text-white font-semibold',
}

function TagBadge({ tag }: { tag: DesigningCandidateTag }) {
  return (
    <span
      data-testid="designing-candidate-tag"
      data-variant={tag.variant}
      className={`ml-auto text-xs px-2 py-0.5 rounded-full ${CANDIDATE_TAG_CLASS[tag.variant]}`}
    >
      {tag.label}
    </span>
  )
}

function ProsCons({ pros, cons }: { pros: string[]; cons: string[] }) {
  return (
    <ul data-testid="designing-candidate-tradeoff-list" className="flex flex-col gap-1.5 text-sm">
      {pros.map((p, i) => (
        <li
          key={`p-${i}`}
          data-testid="designing-pros-item"
          className="flex gap-1.5 items-start text-success"
        >
          <span aria-hidden>✓</span>
          <span className="text-text-1">{p}</span>
        </li>
      ))}
      {cons.map((c, i) => (
        <li
          key={`c-${i}`}
          data-testid="designing-cons-item"
          className="flex gap-1.5 items-start text-error"
        >
          <span aria-hidden>✗</span>
          <span className="text-text-1">{c}</span>
        </li>
      ))}
    </ul>
  )
}

function Metrics({ metrics }: { metrics: DesigningCandidateMetric[] }) {
  return (
    <dl
      data-testid="designing-candidate-metrics"
      className="border-t border-dashed border-border pt-3 flex flex-col gap-1.5"
    >
      {metrics.map((m, i) => (
        <div
          key={`${m.label}-${i}`}
          data-testid="designing-metric-row"
          className="flex items-center justify-between text-sm"
        >
          <dt className="text-text-3">{m.label}</dt>
          <dd
            data-testid="designing-metric-value"
            data-tone={m.tone ?? 'normal'}
            className={`font-mono font-medium ${
              m.tone === 'good' ? 'text-success' : 'text-text-1'
            }`}
          >
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ============================================================================
// 取舍点详情 + AI 推荐(底部卡)
// ============================================================================

function Tradeoff({ tradeoff }: { tradeoff: DesigningData['tradeoff'] }) {
  return (
    <section
      data-testid="designing-tradeoff"
      className="bg-bg-elevated border border-border rounded-xl px-5 py-4"
    >
      <header className="text-xs text-text-3 uppercase tracking-wider font-bold mb-3">
        取舍点详情
      </header>
      <div className="flex flex-col gap-1.5">
        {tradeoff.rows.map((row) => (
          <TradeoffRow key={row.candidateId} row={row} />
        ))}
      </div>
      <div
        data-testid="designing-recommendation"
        data-candidate-id={tradeoff.recommendation.candidateId}
        className="mt-4 px-4 py-3 bg-brand-50 rounded-md text-brand-700 text-sm font-medium flex items-center gap-2"
      >
        <span aria-hidden>🤖</span>
        <span>
          <strong>AI 建议:</strong>
          {tradeoff.recommendation.reason}
        </span>
      </div>
    </section>
  )
}

function TradeoffRow({ row }: { row: DesigningTradeoffRow }) {
  return (
    <div
      data-testid="designing-tradeoff-row"
      data-candidate-id={row.candidateId}
      className="text-sm text-text-2 leading-relaxed"
    >
      <strong className="text-text-1">{row.candidateId} ·</strong> {row.summary}
    </div>
  )
}

// ============================================================================
// 自定义调整(让 AI 重做带 hint)
// ============================================================================

function CustomTune({
  onRegenerate,
}: {
  onRegenerate: (payload: DesigningRegeneratePayload) => void
}) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const canSubmit = trimmed.length > 0

  const submit = () => {
    if (!canSubmit) return
    onRegenerate({ hint: trimmed })
    setText('')
  }

  return (
    <section className="bg-bg-elevated border border-border rounded-xl px-5 py-4">
      <header className="text-xs text-text-3 uppercase tracking-wider font-bold mb-3">
        ✏️ 自定义调整
      </header>
      <label className="flex items-center gap-2 text-xs text-text-3">
        <span className="sr-only">让 AI 重做的提示</span>
        <input
          type="text"
          data-testid="designing-custom-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="给 AI 一句话约束(如:把方案 B 改造一下,降低运维成本)"
          className="flex-1 px-3 py-1.5 text-sm bg-bg border border-border-strong rounded-md text-text-1 placeholder:text-text-3 focus:outline-none focus:border-brand"
        />
        <button
          type="button"
          data-testid="designing-custom-submit"
          disabled={!canSubmit}
          onClick={submit}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border-strong text-text-1 hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        >
          ↻ 让 AI 重做
        </button>
      </label>
    </section>
  )
}

// ============================================================================
// 决策卡(选中后:切到 EXECUTING?非自动跳转,决策 15)
// ============================================================================

function DecisionBar({
  requirementId,
  candidateId,
  candidates,
  onStay,
}: {
  requirementId: string
  candidateId: DesigningCandidateId
  candidates: DesigningCandidate[]
  onStay: () => void
}) {
  const chosen = candidates.find((c) => c.id === candidateId)
  return (
    <div
      data-testid="designing-decision-bar"
      data-candidate-id={candidateId}
      role="dialog"
      aria-label="已选方案,是否切到 EXECUTING"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 bg-bg-elevated border-2 border-brand rounded-xl shadow-lg px-5 py-4 flex items-center gap-4 max-w-[560px]"
    >
      <div className="text-2xl">✅</div>
      <div className="flex-1">
        <div className="font-semibold text-text-1">
          已选 {candidateId} · {chosen?.title ?? ''}
        </div>
        <div className="text-sm text-text-2">
          切到 EXECUTING 工位让 AI 开始实施?(默认留在 DESIGNING)
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="designing-decision-stay"
          onClick={onStay}
          className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          留在此处
        </button>
        <Link
          href={`/requirements/${requirementId}/executing`}
          data-testid="designing-decision-go"
          className="inline-flex items-center h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600"
        >
          切到 EXECUTING →
        </Link>
      </div>
    </div>
  )
}
