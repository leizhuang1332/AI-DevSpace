'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  type AnalyzingChunk,
  type AnalyzingChunkTone,
  type AnalyzingData,
  type AnalyzingStats,
  type AnalyzingToolbar,
  type AnalyzingToolbarAction,
} from '@/lib/analyzing'
import { EmptyState } from './empty-state'

/**
 * ANALYZING 工位组件(ADR-0011 §6 ANALYZING 布局 · issue 19)
 *
 * 视觉对照基线:[11e-stage-adaptive-analyzing.html](../../../../docs/design/pages/11e-stage-adaptive-analyzing.html)
 *
 * 布局(主区全宽,无资源树 / 无 Inline 栏 —— ZoneShell 自动 grid-cols-1):
 * ┌────────────────────────────────────────────────┐
 * │ Stage strip(ANALYZING 徽章 + 进度 + 状态)       │
 * ├────────────────────────────────────────────────┤
 * │ Toolbar(面包屑 + 复制/暂停/重置)                  │
 * ├────────────────────────────────────────────────┤
 * │ Top summary(大图标 + 标题 + 描述 + 三 stats)      │
 * ├────────────────────────────────────────────────┤
 * │ Thinking stream(打字机 20ms / 字,可跳过)          │
 * │  - 已完成 chunk 完整展示                          │
 * │  - 当前 chunk 逐字打字                            │
 * │  - 未来 chunk 占位显示                            │
 * │  - 完成时弹出"切到 CLARIFYING 吗?"(非自动跳转)    │
 * └────────────────────────────────────────────────┘
 *
 * 设计要点:
 * - 'use client':打字机 / 暂停 / 重置 / 完成提示都是客户端交互
 * - props.data 由 server 注入(从 getAnalyzingData),组件只关心渲染 + 客户端状态
 * - 打字机 20ms / 字(issue 19 验收 #2);chunk 间 200ms 间隔,模拟"思考停顿"
 * - 点击 ⏸ 暂停 / 继续;点击 ↶ 清空所有进度从 chunk-0 开始
 * - 点击思考流任意位置 → 当前 chunk 立即显示完整文字(issue 19 验收)
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

type Phase =
  | { kind: 'idle' }
  | { kind: 'typing'; chunkIndex: number; typedLen: number }
  | { kind: 'pausing'; chunkIndex: number; typedLen: number }
  | { kind: 'done' }

export function AnalyzingZone({ data }: AnalyzingZoneProps) {
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
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [showCompletePrompt, setShowCompletePrompt] = useState(false)

  const totalChunks = data.chunks.length

  // -------------------------------------------------------------------------
  // 打字机推进(state machine,useEffect 唯一驱动)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (paused) return

    if (phase.kind === 'idle') {
      // 起步:开始打第一个 chunk(typedLen=1 是为视觉上"已经有字")
      const first = data.chunks[0]
      if (!first) {
        setPhase({ kind: 'done' })
        return
      }
      setPhase({ kind: 'typing', chunkIndex: 0, typedLen: 1 })
      return
    }

    if (phase.kind === 'typing') {
      const chunk = data.chunks[phase.chunkIndex]
      if (!chunk) {
        setPhase({ kind: 'done' })
        return
      }
      if (phase.typedLen < chunk.text.length) {
        // 单次 setTimeout 推进一字符;effect 重跑会再设下一个。
        // 用 setTimeout(而非 setInterval)便于 fake-timer 测试精确推进。
        const id = window.setTimeout(() => {
          setPhase((p) => {
            if (p.kind !== 'typing') return p
            const c = data.chunks[p.chunkIndex]
            if (!c) return { kind: 'done' }
            if (p.typedLen >= c.text.length) return p
            return { ...p, typedLen: p.typedLen + 1 }
          })
        }, TYPEWRITER_INTERVAL_MS)
        return () => window.clearTimeout(id)
      }
      // 当前 chunk 字符打完 → 等 INTER_CHUNK_PAUSE_MS 再转 pausing(让用户看到完整文字)
      const id = window.setTimeout(() => {
        setPhase({ kind: 'pausing', chunkIndex: phase.chunkIndex, typedLen: chunk.text.length })
      }, INTER_CHUNK_PAUSE_MS)
      return () => window.clearTimeout(id)
    }

    if (phase.kind === 'pausing') {
      const id = window.setTimeout(() => {
        const nextIndex = phase.chunkIndex + 1
        if (nextIndex >= data.chunks.length) {
          setPhase({ kind: 'done' })
        } else {
          // 推进:下一 chunk typedLen 从 1 开始
          setPhase({ kind: 'typing', chunkIndex: nextIndex, typedLen: 1 })
        }
      }, INTER_CHUNK_PAUSE_MS)
      return () => window.clearTimeout(id)
    }

    // phase.kind === 'done' → 不需再做事
  }, [paused, phase, data.chunks])

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
    // 重置同时清 paused,避免"已重置但不动"的错觉(spec issue 19:重置清空当前分析,从头开始)
    setShowCompletePrompt(false)
    setPaused(false)
    setPhase({ kind: 'idle' })
  }, [])

  const dismissComplete = useCallback(() => {
    setShowCompletePrompt(false)
  }, [])

  const skipTypewriter = useCallback(() => {
    // 函数式 setState —— 不读 closure phase,直接基于当前 state 更新
    setPhase((p) => {
      if (p.kind !== 'typing') return p
      const chunk = data.chunks[p.chunkIndex]
      if (!chunk) return p
      if (p.typedLen >= chunk.text.length) return p
      return { ...p, typedLen: chunk.text.length }
    })
  }, [data.chunks])

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
      <div
        data-testid="analyzing-main"
        className="flex-1 overflow-auto px-6 py-6 flex flex-col gap-5"
      >
        <Summary summary={data.summary} stats={data.stats} />
        <ThinkingStream
          chunks={data.chunks}
          phase={phase}
          paused={paused}
          onSkip={skipTypewriter}
        />
      </div>

      {showCompletePrompt && (
        <CompletePrompt
          requirementId={data.requirementId}
          onDismiss={dismissComplete}
        />
      )}
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
// Thinking stream(打字机)
// ============================================================================

function ThinkingStream({
  chunks,
  phase,
  paused,
  onSkip,
}: {
  chunks: AnalyzingChunk[]
  phase: Phase
  paused: boolean
  onSkip: () => void
}) {
  return (
    <div
      data-testid="analyzing-stream"
      data-paused={paused ? 'true' : 'false'}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between">
        <span className="text-md font-semibold flex items-center gap-2">
          🧠 思考流
        </span>
        <span
          data-testid="analyzing-stream-progress"
          className="font-mono text-xs text-text-3"
        >
          {progressText(chunks.length, phase)}
          {paused && ' · 已暂停'}
        </span>
      </div>
      <button
        type="button"
        data-testid="analyzing-stream-body"
        onClick={onSkip}
        aria-label="点击跳过当前 chunk 打字"
        className="block w-full text-left px-5 py-4 text-sm text-text-1 leading-relaxed cursor-pointer hover:bg-brand-50/30 transition-colors"
      >
        {chunks.length === 0 ? (
          <p className="text-text-3">暂无思考流</p>
        ) : (
          chunks.map((c, i) => (
            <ChunkRow key={c.id} chunk={c} phase={phase} index={i} />
          ))
        )}
      </button>
    </div>
  )
}

function progressText(total: number, phase: Phase): string {
  if (phase.kind === 'idle') return `0/${total} chunks`
  if (phase.kind === 'done') return `${total}/${total} chunks`
  return `${phase.chunkIndex + 1}/${total} chunks`
}

function ChunkRow({
  chunk,
  phase,
  index,
}: {
  chunk: AnalyzingChunk
  phase: Phase
  index: number
}) {
  // future:还没进入流区
  if (
    phase.kind === 'idle' ||
    (phase.kind !== 'done' && index > phase.chunkIndex)
  ) {
    return (
      <div
        data-testid="analyzing-chunk-future"
        data-chunk-id={chunk.id}
        className="py-2 flex items-start gap-3 opacity-30"
      >
        <span className="font-mono text-xs text-text-3 min-w-[60px] mt-0.5">
          {chunk.ts}
        </span>
        <span className="flex-1 text-text-3 select-none">·</span>
      </div>
    )
  }

  // 当前正在打字(chunkIndex === index 且 phase.kind === 'typing')
  if (phase.kind === 'typing' && phase.chunkIndex === index) {
    return (
      <CurrentChunkRow chunk={chunk} typed={chunk.text.slice(0, phase.typedLen)} />
    )
  }

  // 已完成(phase.kind === 'done' 或 index < chunkIndex)
  return <DoneChunkRow chunk={chunk} />
}

const TONE_BG: Record<AnalyzingChunkTone, string> = {
  info: 'bg-brand-50 text-brand-700',
  success: 'bg-[#d1fae5] text-[#065f46]',
  warn: 'bg-[#fef3c7] text-[#92400e]',
  err: 'bg-[#fee2e2] text-[#991b1b]',
}

const TONE_BORDER: Record<AnalyzingChunkTone, string> = {
  info: 'border-l-brand',
  success: 'border-l-success',
  warn: 'border-l-warning',
  err: 'border-l-error',
}

function CurrentChunkRow({
  chunk,
  typed,
}: {
  chunk: AnalyzingChunk
  typed: string
}) {
  return (
    <div
      data-testid="analyzing-chunk-current"
      data-chunk-id={chunk.id}
      data-tone={chunk.tone}
      data-typed-len={typed.length}
      data-full-len={chunk.text.length}
      className="py-2 px-3 -mx-3 my-0.5 rounded-md bg-brand-50/60 border-l-[3px] border-l-brand flex items-start gap-3"
    >
      <span className="font-mono text-xs text-text-3 min-w-[60px] mt-0.5">
        {chunk.ts}
      </span>
      <div className="flex-1">
        <span
          className={`inline-block text-xs font-medium px-1.5 py-px rounded-sm mr-2 ${TONE_BG[chunk.tone]}`}
        >
          {chunk.label}
        </span>
        <span className="text-text-1">{typed}</span>
        <span
          data-testid="analyzing-typewriter-cursor"
          className="inline-block w-[1px] h-4 align-middle ml-0.5 bg-brand animate-pulse"
        />
      </div>
    </div>
  )
}

function DoneChunkRow({ chunk }: { chunk: AnalyzingChunk }) {
  return (
    <div
      data-testid="analyzing-chunk-done"
      data-chunk-id={chunk.id}
      data-tone={chunk.tone}
      className={`py-2 flex items-start gap-3 border-l-[3px] ${TONE_BORDER[chunk.tone]} pl-3 -ml-3`}
    >
      <span className="font-mono text-xs text-text-3 min-w-[60px] mt-0.5">
        {chunk.ts}
      </span>
      <div className="flex-1">
        <span
          className={`inline-block text-xs font-medium px-1.5 py-px rounded-sm mr-2 ${TONE_BG[chunk.tone]}`}
        >
          {chunk.label}
        </span>
        <span className="text-text-1">{chunk.text}</span>
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