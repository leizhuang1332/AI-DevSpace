'use client'

/**
 * board 卡片详情页 — 右栏展开态 CardTranscriptPanel(issue 08 / ADR-0028 D5)
 *
 * 视觉对照基线:`docs/design/pages/board-detail-final.html` .side-toggled 块。
 *
 * 结构:
 * - head:「💬 AI 协作 · {shortCardId} transcript」+ 物理独立 badge + ✕ 收起
 * - 消息流(transcript.messages → .msg.user / .msg.assistant)
 *   - refs 用 renderRef 简单渲染(📎 Run #id / 📄 PRD §x-y / 🖼️ Asset name)
 * - 底部 <CardTranscriptInput>(textarea + 📎 引用 + 发送 ⌘+↵)
 *
 * 守门(ADR-0028 D2):
 * - 本面板**不渲染 [+ Run] 按钮**(只发文本)
 * - assistant 消息只读(来自历史 transcript.yaml,UI 不生成 assistant)
 */

import type { TaskCard, TaskCardTranscript, TranscriptRef } from '@ai-devspace/shared'
import { shortCardId } from '@/lib/board'
import { CardTranscriptInput } from './CardTranscriptInput'

export interface CardTranscriptPanelProps {
  card: TaskCard
  transcript: TaskCardTranscript | null
  /** 发送消息(走 useSendTranscriptMessage) */
  onSend: (content: string) => void | Promise<void>
  /** 收起 → 回默认态 */
  onClose: () => void
  /** 发送中 */
  isPending?: boolean
  /** 发送错误 */
  error?: string | null
}

/** 渲染 TranscriptRef 为可读字符串(镜像 agent 端 renderRefAsReadable,web 端不引 agent 包)。 */
function renderRef(ref: TranscriptRef): string {
  switch (ref.kind) {
    case 'run_id': {
      const id = ref.run_id.startsWith('run-')
        ? ref.run_id.slice('run-'.length)
        : ref.run_id
      return `📎 Run #${id}`
    }
    case 'prd_section': {
      const [start, end] = ref.line_range ?? [0, 0]
      return `📄 PRD §${start}-${end}`
    }
    case 'asset': {
      return `🖼️ Asset ${ref.name}`
    }
  }
}

export function CardTranscriptPanel({
  card,
  transcript,
  onSend,
  onClose,
  isPending,
  error,
}: CardTranscriptPanelProps) {
  const messages = transcript?.messages ?? []

  return (
    <div
      data-testid="board-detail-transcript-panel"
      className="p-4 bg-bg-elevated flex flex-col gap-2 min-h-[600px] min-w-0"
      style={{ animation: 'expand .25s ease-out' }}
    >
      {/* head */}
      <div
        data-testid="board-detail-transcript-head"
        className="flex items-center gap-2 pb-2 border-b border-border"
      >
        <h3 className="text-sm font-semibold flex-1">
          💬 AI 协作 · {shortCardId(card.id)} transcript
        </h3>
        <span
          data-testid="board-detail-transcript-badge"
          className="text-[10px] text-text-3 bg-bg-subtle px-1.5 py-0.5 rounded-sm font-medium"
        >
          物理独立 · 仅描述
        </span>
        <button
          type="button"
          data-testid="board-detail-transcript-close"
          onClick={onClose}
          aria-label="收起回到属性"
          title="收起回到属性"
          className="text-sm w-6 h-6 rounded-md border border-border bg-bg-elevated text-text-2 hover:border-text-3 hover:text-text-1 inline-flex items-center justify-center"
        >
          ✕
        </button>
      </div>

      {/* 消息流 */}
      <div
        data-testid="board-detail-transcript-msgs"
        className="flex flex-col gap-3 flex-1 py-3 overflow-auto"
      >
        {messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-text-3 text-center px-4">
            还没有对话。在下方输入框继续对话 —— 只能描述 / 提问,不可发 Run。
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={`${msg.ts}-${idx}`}
              data-testid="board-detail-transcript-msg"
              data-role={msg.role}
              className={`p-3 rounded-md text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-bg-subtle'
                  : 'bg-brand-50 text-text-2'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5 text-xs text-text-3">
                <span
                  className="font-semibold uppercase tracking-wide"
                  style={{
                    color: msg.role === 'user' ? 'var(--brand-700)' : 'var(--brand-700)',
                  }}
                >
                  {msg.role === 'user' ? '用户' : 'AI'}
                </span>
                <span className="ml-auto font-mono text-[10px]">
                  {msg.ts.slice(11, 16)}
                </span>
              </div>
              <div className="text-text-2 whitespace-pre-wrap">{msg.content}</div>
              {msg.refs.length > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-border flex flex-col gap-0.5">
                  {msg.refs.map((ref, ridx) => (
                    <span
                      key={ridx}
                      data-testid="board-detail-transcript-ref"
                      className="text-brand-600 text-xs font-mono"
                    >
                      {renderRef(ref)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* 输入框 */}
      <CardTranscriptInput onSend={onSend} isPending={isPending} error={error} />
    </div>
  )
}
