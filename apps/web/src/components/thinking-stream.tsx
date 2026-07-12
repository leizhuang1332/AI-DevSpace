'use client'

/**
 * ThinkingStream 组件 — ANALYZING 工位主区左侧"思考流"渲染器(ADR-0013 D2 ②)
 *
 * 视觉对照基线:docs/design/pages/11h-A-zone-multisession-tabs.html 左列
 *
 * 职责:
 * - 把 `chunks` 数组按 phase 渲染为三态:已完成 / 当前正在打字 / 未来占位
 * - 当前 chunk 行带脉动光标 + 整行高亮 + 完整 ts/label/text
 * - 点击流区任意位置 → 触发 onSkip(由父组件决定"立即完成当前 chunk")
 * - chunks 数组变化时(由父组件从 SSE 接收并 append),自动重渲整行
 *
 * 设计要点:
 * - 纯函数式组件:`chunks + phase + paused + onSkip` → DOM
 * - 不持打字机状态(phase 由父 analyzing-zone 拥有;这样新增 chunks 时
 *   typing 状态可继续,无需 reset)
 * - 不读 fake timer —— 打字机推进是父组件责任,本组件只渲染"已 typed 的长度"
 *
 * 状态机(由父组件驱动):
 *   idle     — 还没开始打字 → 全部 row 都走 future 形态
 *   typing   — chunkIndex 正在打 → 当前 chunk 走 current 形态(显示 typedLen 字符)
 *   pausing  — chunkIndex 完成 + 等 200ms → 整行显示完成态
 *   done     — 全部完成 → 全部 row 走 done 形态
 */

import type { AnalyzingChunk, AnalyzingChunkTone } from '@/lib/analyzing'

// ---------------------------------------------------------------------------
// Phase(由父 analyzing-zone 拥有,本组件只读)
// ---------------------------------------------------------------------------

export type ThinkingPhase =
  | { kind: 'idle' }
  | { kind: 'typing'; chunkIndex: number; typedLen: number }
  | { kind: 'pausing'; chunkIndex: number; typedLen: number }
  | { kind: 'done' }

// ---------------------------------------------------------------------------
// tone → 视觉样式(抽出到模块顶层,避免每次渲染重建表)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export interface ThinkingStreamProps {
  chunks: AnalyzingChunk[]
  phase: ThinkingPhase
  paused: boolean
  onSkip: () => void
}

export function ThinkingStream({ chunks, phase, paused, onSkip }: ThinkingStreamProps) {
  return (
    <div
      data-testid="analyzing-stream"
      data-paused={paused ? 'true' : 'false'}
      data-chunk-count={chunks.length}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden h-full flex flex-col"
    >
      <div className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between flex-shrink-0">
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
        className="block flex-1 w-full text-left px-5 py-4 text-sm text-text-1 leading-relaxed cursor-pointer hover:bg-brand-50/30 transition-colors overflow-auto"
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

function progressText(total: number, phase: ThinkingPhase): string {
  if (phase.kind === 'idle') return `0/${total} chunks`
  if (phase.kind === 'done') return `${total}/${total} chunks`
  return `${phase.chunkIndex + 1}/${total} chunks`
}

// ---------------------------------------------------------------------------
// 单 chunk 渲染:三态分支
// ---------------------------------------------------------------------------

function ChunkRow({
  chunk,
  phase,
  index,
}: {
  chunk: AnalyzingChunk
  phase: ThinkingPhase
  index: number
}) {
  // 还没进入流区:future 占位
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

  // 当前正在打字(phase=typing 且 chunkIndex === index)
  if (phase.kind === 'typing' && phase.chunkIndex === index) {
    return (
      <CurrentChunkRow chunk={chunk} typed={chunk.text.slice(0, phase.typedLen)} />
    )
  }

  // 已完成(phase=done 或 index < chunkIndex)
  return <DoneChunkRow chunk={chunk} />
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
