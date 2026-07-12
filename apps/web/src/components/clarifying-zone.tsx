'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  type ClarifyingAnswerPayload,
  type ClarifyingBackPayload,
  type ClarifyingCandidateOption,
  type ClarifyingCurrentQuestion,
  type ClarifyingData,
  type ClarifyingHistoryItem,
} from '@/lib/clarifying'
import { EmptyState } from './empty-state'

/**
 * CLARIFYING 工位组件(ADR-0011 §6 CLARIFYING 布局 · issue 20)
 *
 * 视觉对照基线:[11b-stage-adaptive-clarifying.html](../../../../docs/design/pages/11b-stage-adaptive-clarifying.html)
 *
 * 布局(主区全宽,无资源树 / 无 Inline 栏 —— ZoneShell 自动 grid-cols-1):
 * ┌────────────────────────────────────────────────┐
 * │ Stage strip(③ 澄清 + CLARIFYING · Q&A)            │
 * ├────────────────────────────────────────────────┤
 * │ Toolbar(面包屑 + 形态标签)                        │
 * ├────────────────────────────────────────────────┤
 * │ Q&A 主区(max-w 820px 居中):                        │
 * │   1. 进度条(Q4/5 + 80% 进度)                       │
 * │   2. 焦点卡:当前提问 + 候选答案 + 上下文            │
 * │   3. 历史澄清(可折叠,按时间倒序,可"回到那一步")     │
 * └────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - 'use client':候选答案点击 / 自定义输入 / 历史折叠 / 回到那一步都是客户端交互
 * - props.data 由 server 注入(从 getClarifyingData),组件只关心渲染 + 客户端状态
 * - 回答 / 回到那一步是回调,page.tsx 通过 props 注入(避免硬编码副作用)
 * - ZoneBar 紫点带红圈 已由 zones.ts['clarifying'].status_color='purple-warn' 渲染(决策 22)
 * - AI 完成 ANALYZING 后弹出"切到 CLARIFYING"提示(由 ANALYZING 工位实现),
 *   本工位不主动跳回 ANALYZING(决策 15 / 决策 25 反对状态机)
 */
export interface ClarifyingZoneProps {
  data: ClarifyingData
  /** 用户回答回调(candidate / custom);page 层接 AI Skill 触发 */
  onAnswer?: (payload: ClarifyingAnswerPayload) => void
  /** "回到那一步" 回调;page 层触发 AI 重新思考 */
  onBack?: (payload: ClarifyingBackPayload) => void
}

/** 默认 no-op 回调 —— server component 直接渲染时使用 */
const NOOP_ANSWER = (_payload: ClarifyingAnswerPayload) => {}
const NOOP_BACK = (_payload: ClarifyingBackPayload) => {}

export function ClarifyingZone({
  data,
  onAnswer = NOOP_ANSWER,
  onBack = NOOP_BACK,
}: ClarifyingZoneProps) {
  if (data.empty) {
    return <EmptyClarifying data={data} />
  }

  return (
    <ClarifyingContent
      data={data}
      onAnswer={onAnswer}
      onBack={onBack}
    />
  )
}

// ============================================================================
// 空态
// ============================================================================

function EmptyClarifying({ data }: { data: ClarifyingData }) {
  return (
    <main
      data-testid="clarifying-zone"
      data-requirement-id={data.requirementId}
      data-empty="true"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          icon="❓"
          title="CLARIFYING 工位暂无问题"
          subtitle="这个需求还没有 AI 提问。先去 DRAFTING 工位写需求文档,AI 分析后会在这里向你提问。"
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
// 主内容:Stage + Toolbar + Q&A
// ============================================================================

function ClarifyingContent({
  data,
  onAnswer,
  onBack,
}: Required<Pick<ClarifyingZoneProps, 'data' | 'onAnswer' | 'onBack'>>) {
  return (
    <main
      data-testid="clarifying-zone"
      data-requirement-id={data.requirementId}
      data-empty="false"
      className="flex flex-col h-full overflow-hidden bg-bg-elevated"
    >
      <StageStrip stage={data.stage} progress={data.progress} />
      <Toolbar toolbar={data.toolbar} />
      <div
        data-testid="clarifying-main"
        className="flex-1 overflow-auto px-6 py-6"
      >
        <div className="max-w-[820px] mx-auto">
          <Progress progress={data.progress} />
          {data.currentQuestion ? (
            <FocusCard
              question={data.currentQuestion}
              onAnswer={onAnswer}
            />
          ) : (
            <AllDoneCard />
          )}
          <History
            items={data.history}
            onBack={onBack}
          />
        </div>
      </div>
    </main>
  )
}

// ============================================================================
// Stage strip(顶部状态条)
// ============================================================================

function StageStrip({
  stage,
  progress,
}: {
  stage: ClarifyingData['stage']
  progress: ClarifyingData['progress']
}) {
  return (
    <div
      data-testid="clarifying-stage-strip"
      className="bg-gradient-to-r from-brand-50 to-brand-50/30 border-b border-border px-6 py-3 flex items-center justify-between"
    >
      <div className="flex items-center gap-2 font-semibold text-md text-brand-700">
        <span
          data-testid="clarifying-stage-badge"
          className="bg-brand text-white text-xs font-medium px-2 py-0.5 rounded"
        >
          {stage.badge}
        </span>
        <span data-testid="clarifying-stage-title">{stage.title}</span>
      </div>
      <div
        data-testid="clarifying-stage-meta"
        className="font-mono text-sm text-brand-600 flex items-center gap-3"
      >
        <span data-testid="clarifying-progress-meta">
          Q{progress.current} / {progress.total}
        </span>
        <span className="text-text-3">·</span>
        <span className="text-text-3 text-xs">{stage.meta}</span>
      </div>
    </div>
  )
}

// ============================================================================
// Toolbar(面包屑)
// ============================================================================

function Toolbar({ toolbar }: { toolbar: ClarifyingData['toolbar'] }) {
  return (
    <div
      data-testid="clarifying-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="clarifying-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={
              c.current ? 'clarifying-crumb-current' : 'clarifying-crumb-item'
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
      <span className="font-mono text-xs text-text-3">形态:💬 Q&A</span>
    </div>
  )
}

// ============================================================================
// 进度条
// ============================================================================

function Progress({ progress }: { progress: ClarifyingData['progress'] }) {
  return (
    <div
      data-testid="clarifying-progress"
      data-current={String(progress.current)}
      data-total={String(progress.total)}
      className="flex items-center gap-3 mb-5 text-sm text-text-2"
    >
      <span>澄清进度</span>
      <div className="flex-1 h-1.5 bg-bg-subtle rounded-full overflow-hidden">
        <div
          data-testid="clarifying-progress-bar"
          data-pct={String(progress.pct)}
          className="h-full bg-brand rounded-full"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
      <span className="font-mono text-xs">
        Q{progress.current} / {progress.total}
      </span>
    </div>
  )
}

// ============================================================================
// 焦点卡(当前提问 + 候选答案 + 上下文)
// ============================================================================

function FocusCard({
  question,
  onAnswer,
}: {
  question: ClarifyingCurrentQuestion
  onAnswer: (payload: ClarifyingAnswerPayload) => void
}) {
  return (
    <div
      data-testid="clarifying-focus"
      data-question-id={question.id}
      className="bg-bg-elevated border border-brand rounded-xl shadow-[0_0_0_4px_var(--brand-50)] p-6 mb-6"
    >
      <div
        data-testid="clarifying-focus-kicker"
        className="text-xs text-brand-600 font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5"
      >
        <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
        当前提问 · {question.id.toUpperCase()}
      </div>
      <div className="text-xl font-semibold leading-relaxed mb-5 flex gap-2.5">
        <span className="text-brand">💬</span>
        <span data-testid="clarifying-focus-question">{question.text}</span>
      </div>

      <Candidates
        questionId={question.id}
        options={question.candidates}
        onAnswer={onAnswer}
      />

      <ContextLinks links={question.contextLinks} />

      <CustomAnswer questionId={question.id} onAnswer={onAnswer} />
    </div>
  )
}

function AllDoneCard() {
  return (
    <div
      data-testid="clarifying-focus-done"
      className="bg-bg-elevated border border-success rounded-xl p-6 mb-6 text-center"
    >
      <div className="text-3xl mb-2">✅</div>
      <div className="text-lg font-semibold text-success">
        所有问题已答完
      </div>
      <div className="text-sm text-text-2 mt-1">
        AI 已收到所有回答,正在整理上下文。可以切到其他工位继续,或留在此处等待 AI 提示。
      </div>
    </div>
  )
}

function Candidates({
  questionId,
  options,
  onAnswer,
}: {
  questionId: string
  options: ClarifyingCandidateOption[]
  onAnswer: (payload: ClarifyingAnswerPayload) => void
}) {
  // 已提交的候选 id;展示"✓ 已提交"反馈(spec 验收:点击候选 → 提交回答)
  const [submittedOptionId, setSubmittedOptionId] = useState<string | null>(null)

  return (
    <div
      data-testid="clarifying-candidates"
      className="flex flex-wrap gap-3 mb-4"
    >
      {options.map((opt) => {
        const isSubmitted = submittedOptionId === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            data-testid="clarifying-candidate-option"
            data-option-id={opt.id}
            data-variant={opt.variant}
            data-submitted={isSubmitted ? 'true' : 'false'}
            disabled={submittedOptionId !== null}
            onClick={() => {
              setSubmittedOptionId(opt.id)
              onAnswer({
                kind: 'candidate',
                questionId,
                optionId: opt.id,
                label: opt.label,
              })
            }}
            className={candidateClass(opt.variant, isSubmitted)}
          >
            {isSubmitted ? `✓ 已提交 · ${opt.label}` : opt.label}
          </button>
        )
      })}
    </div>
  )
}

function candidateClass(
  variant: ClarifyingCandidateOption['variant'],
  submitted: boolean,
): string {
  // 已提交态统一用 success 视觉(候选被选定的"已锁定"语义)
  if (submitted) {
    return 'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-md font-medium border-[1.5px] border-success bg-[#f0fdf4] text-success cursor-default'
  }
  const base =
    'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-md font-medium cursor-pointer border-[1.5px] disabled:opacity-50 disabled:cursor-not-allowed'
  if (variant === 'yes') {
    return `${base} border-success text-success hover:bg-[#f0fdf4]`
  }
  if (variant === 'no') {
    return `${base} border-error text-error hover:bg-[#fef2f2]`
  }
  return `${base} border-border-strong text-text-1 hover:bg-bg-subtle`
}

function ContextLinks({
  links,
}: {
  links: ClarifyingCurrentQuestion['contextLinks']
}) {
  if (links.length === 0) return null
  return (
    <div className="text-xs text-text-3 border-t border-dashed border-border pt-3 font-mono">
      📎 上下文：
      {links.map((l, i) => (
        <span key={l.href}>
          {i > 0 && ' · '}
          <Link
            href={l.href}
            data-testid="clarifying-focus-ctx-link"
            className="text-brand-600 hover:underline"
          >
            {l.label}
          </Link>
        </span>
      ))}
    </div>
  )
}

// ============================================================================
// 自定义回答输入框
// ============================================================================

function CustomAnswer({
  questionId,
  onAnswer,
}: {
  questionId: string
  onAnswer: (payload: ClarifyingAnswerPayload) => void
}) {
  const [text, setText] = useState('')
  const trimmed = text.trim()
  const canSubmit = trimmed.length > 0

  const submit = () => {
    if (!canSubmit) return
    onAnswer({ kind: 'custom', questionId, text: trimmed })
    setText('')
  }

  return (
    <div className="mt-4 pt-3 border-t border-dashed border-border">
      <label className="flex items-center gap-2 text-xs text-text-3">
        <span>✏️ 自定义回答</span>
        <input
          type="text"
          data-testid="clarifying-custom-answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="说点儿别的…（回车提交）"
          className="flex-1 px-3 py-1.5 text-sm bg-bg border border-border-strong rounded-md text-text-1 placeholder:text-text-3 focus:outline-none focus:border-brand"
        />
        <button
          type="button"
          data-testid="clarifying-custom-submit"
          disabled={!canSubmit}
          onClick={submit}
          className="px-3 py-1.5 text-sm font-medium rounded-md border border-border-strong text-text-1 hover:bg-bg-subtle disabled:opacity-50 disabled:cursor-not-allowed"
        >
          提交
        </button>
      </label>
    </div>
  )
}

// ============================================================================
// 历史澄清(可折叠,按时间倒序)
// ============================================================================

function History({
  items,
  onBack,
}: {
  items: ClarifyingHistoryItem[]
  onBack: (payload: ClarifyingBackPayload) => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section
      data-testid="clarifying-history"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <button
        type="button"
        data-testid="clarifying-history-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="w-full px-4 py-3 bg-bg-subtle border-b border-border flex items-center justify-between text-left hover:bg-bg"
      >
        <span className="text-md font-semibold flex items-center gap-2">
          📜 历史澄清
          <span className="bg-bg-elevated text-text-2 px-2 py-px rounded-full text-xs font-normal">
            已答 {items.filter((i) => i.status === 'done').length} · 待答{' '}
            {items.filter((i) => i.status !== 'done').length}
          </span>
        </span>
        <span className="text-text-3 text-xs">
          {collapsed ? '▶ 展开' : '▼ 折叠'}
        </span>
      </button>

      {!collapsed && (
        <div className="p-3 flex flex-col gap-2">
          {items.length === 0 ? (
            <div
              data-testid="clarifying-history-empty"
              className="text-text-3 text-sm text-center py-4"
            >
              暂无历史澄清记录
            </div>
          ) : (
            // 按时间倒序:list 已经按"最新在 last"排列(创建顺序 = 时间顺序),
            // 这里 reverse 后最新的在最上(issue 20 验收:按时间倒序)
            [...items].reverse().map((item) => (
              <HistoryItem key={item.id} item={item} onBack={onBack} />
            ))
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 集中定义 HistoryItem 的 per-status 视觉(避免 Repeated Switches)。
 * UI 仅从此处取数据,新增状态只改这一张表。
 */
interface HistoryStatusView {
  symbol: string
  symbolColorCls: string
  cardExtraCls: string
  /** 根据 item 派生右侧文案(避免硬编码 mock 形状,如 q-5 === 'q-5') */
  rightText: (item: ClarifyingHistoryItem) => string
  /** 阻塞题目无"回到那一步"按钮 */
  showBack: boolean
}

const HISTORY_STATUS_VIEW: Record<
  ClarifyingHistoryItem['status'],
  HistoryStatusView
> = {
  done: {
    symbol: '✓',
    symbolColorCls: 'text-success',
    cardExtraCls: '',
    rightText: (item) => `→ ${item.answer}`,
    showBack: true,
  },
  doing: {
    symbol: '▶',
    symbolColorCls: 'text-brand',
    cardExtraCls: 'border-brand bg-brand-50',
    rightText: () => '← 正在回答',
    showBack: true,
  },
  blocked: {
    symbol: '⏸',
    symbolColorCls: 'text-text-3',
    cardExtraCls: 'opacity-60',
    rightText: (item) => {
      const dep = item.blockedReason?.dependsOn
      return dep ? `→ 阻塞于 ${dep.toUpperCase()}` : '→ 阻塞'
    },
    showBack: false,
  },
}

const HISTORY_BASE_CLS =
  'flex items-center gap-3 px-3 py-2.5 bg-bg border border-border rounded-lg text-sm hover:border-border-strong hover:shadow-sm transition-colors'

function HistoryItem({
  item,
  onBack,
}: {
  item: ClarifyingHistoryItem
  onBack: (payload: ClarifyingBackPayload) => void
}) {
  const view = HISTORY_STATUS_VIEW[item.status]
  return (
    <div
      data-testid="clarifying-history-item"
      data-question-id={item.questionId}
      data-status={item.status}
      className={`${HISTORY_BASE_CLS} ${view.cardExtraCls}`}
    >
      <span
        data-testid="clarifying-history-symbol"
        className={view.symbolColorCls}
      >
        {view.symbol}
      </span>
      <span className="flex-1 text-text-1">
        {item.questionId.toUpperCase()} · {item.question}
      </span>
      <span className="text-text-3 font-mono text-xs">{view.rightText(item)}</span>
      {view.showBack && (
        <button
          type="button"
          data-testid="clarifying-history-back"
          onClick={() => onBack({ questionId: item.questionId })}
          className="text-text-3 hover:text-brand-600 text-xs font-medium"
          aria-label={`回到 ${item.questionId.toUpperCase()} 那一步`}
        >
          回到那一步 ›
        </button>
      )}
    </div>
  )
}
