'use client'

/**
 * board 卡片详情页 — 右栏展开态 Chat Transcript Panel(issue 07 / ADR-0029)
 *
 * 这是 web 端 Claude Code CLI 可视化镜像 —— 集成 SDK session + SSE 实时事件
 * + 9 类事件 dispatch + 串起 UsageBar / MessageStream / PermissionPrompt /
 * PlanModePrompt / CostCapModal / SubAgentBlock / ToolCallBubble。
 *
 * 形态:
 * - 顶部:locked-by-other-tab banner(单 tab lock) + 旧 transcript 折叠 banner(D12)
 * - <UsageBar> 模型 / tokens / cost / turns + plan mode toggle + model dropdown
 * - <MessageStream> user/assistant 气泡 + 嵌入 SubAgent + ToolCallBubble
 * - <CardTranscriptInput> textarea + 发送
 *
 * Modal 由事件流驱动:
 * - chat_permission_request → <PermissionPrompt>
 * - chat_complete(cost >= $5) → <CostCapModal>
 * - 切昂贵 model → <ModelSwitchConfirm>
 *
 * 数据流:
 * - snapshot hook 拿 meta + 历史 events
 * - stream hook(send) 触发新 query,live events 累计
 * - mutations 触发后 invalidate snapshot,UI 重拉 meta
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ChatDecisionWithReason,
  ChatPermissionResolved,
  ChatSessionMeta,
  TaskCard,
} from '@ai-devspace/shared'
import { shortCardId } from '@/lib/board'
import {
  useChatSessionSnapshot,
  useChatSessionStream,
  useChatSessionLock,
  useChatSessionStart,
  useChatPermission,
  useChatModelSwitch,
  useChatPlanMode,
  useChatPermissionMode,
  useChatCostCap,
} from '@/lib/board-chat-hooks'
import { UsageBar } from './chat/UsageBar'
import { MessageStream } from './chat/MessageStream'
import {
  PermissionPrompt,
  type PermissionDecisionKind,
} from './chat/PermissionPrompt'
import { PlanModePrompt } from './chat/PlanModePrompt'
import { CostCapModal } from './chat/CostCapModal'
import { ModelSwitchConfirm } from './chat/ModelSwitchConfirm'
import { CardTranscriptInput } from './CardTranscriptInput'

const EXPENSIVE_MODEL_THRESHOLD = (m: string): boolean => m.includes('opus')

export interface CardTranscriptPanelProps {
  card: TaskCard
  requirementId: string
  onClose: () => void
  /** 旧 transcript.yaml 是否存在(用于折叠 banner) */
  hasLegacyTranscript?: boolean
  /** 初始 session meta(SSR 首屏注入,可选) */
  initialMeta?: ChatSessionMeta | null
}

export function CardTranscriptPanel({
  card,
  requirementId,
  onClose,
  hasLegacyTranscript = false,
  initialMeta = null,
}: CardTranscriptPanelProps): ReactNode {
  // ---- 数据 hooks ----
  const snapshotQ = useChatSessionSnapshot(requirementId, card.id)
  const startMutation = useChatSessionStart(requirementId, card.id)

  // 优先拿 snapshot.meta(initialMeta 仅作 fallback)
  const meta: ChatSessionMeta | null =
    snapshotQ.snapshot?.meta ?? initialMeta ?? null

  const stream = useChatSessionStream(requirementId, card.id, meta)
  const lock = useChatSessionLock(requirementId, card.id, stream.status)

  const permissionMutation = useChatPermission(
    requirementId,
    card.id,
    meta?.sessionId ?? null,
  )
  const modelMutation = useChatModelSwitch(
    requirementId,
    card.id,
    meta?.sessionId ?? null,
  )
  const planModeMutation = useChatPlanMode(
    requirementId,
    card.id,
    meta?.sessionId ?? null,
  )
  const permissionModeMutation = useChatPermissionMode(
    requirementId,
    card.id,
    meta?.sessionId ?? null,
  )
  const costCapMutation = useChatCostCap(
    requirementId,
    card.id,
    meta?.sessionId ?? null,
  )

  // ---- 合并 snapshot 历史 events + live events ----
  const allEvents = useMemo(() => {
    const snapshot = snapshotQ.snapshot?.events ?? []
    return [...snapshot, ...stream.events]
  }, [snapshotQ.snapshot?.events, stream.events])

  // ---- 派生 sub-agent tokens(本期简化:0;后续可解析 task_* 累计) ----
  const subAgentTokens = 0
  // ---- 派生 sub-agent cost(本期简化:0;后续从 task_completed 累计) ----
  const subAgentCost = 0

  // ---- session 累计 duration(自 createdAt 到 lastQueryAt 的毫秒数) ----
  const durationMs = useMemo(() => {
    if (!meta) return 0
    const t0 = Date.parse(meta.createdAt)
    const t1 = Date.parse(meta.lastQueryAt)
    if (Number.isNaN(t0) || Number.isNaN(t1)) return 0
    return Math.max(0, t1 - t0)
  }, [meta])

  // ---- Model switch confirm state ----
  const [pendingModel, setPendingModel] = useState<string | null>(null)

  const handleModelChange = useCallback(
    (next: string) => {
      if (!meta) return
      if (next === meta.model) return
      if (EXPENSIVE_MODEL_THRESHOLD(next) && !EXPENSIVE_MODEL_THRESHOLD(meta.model)) {
        setPendingModel(next)
      } else {
        void modelMutation.mutateAsync({
          model: next,
          expectedCostMultiplier: EXPENSIVE_MODEL_THRESHOLD(next) ? 5 : 1,
        })
      }
    },
    [meta, modelMutation],
  )

  const handleModelConfirm = useCallback(() => {
    if (!pendingModel) return
    void modelMutation
      .mutateAsync({
        model: pendingModel,
        expectedCostMultiplier: 5,
      })
      .finally(() => setPendingModel(null))
  }, [pendingModel, modelMutation])

  const handleModelCancel = useCallback(() => {
    setPendingModel(null)
  }, [])

  // ---- Plan mode toggle ----
  const handlePlanToggle = useCallback(
    (enabled: boolean) => {
      void planModeMutation.mutateAsync({ enabled })
    },
    [planModeMutation],
  )

  // ---- Auto-allow toggle(default ↔ bypassPermissions;与 plan 互斥) ----
  const handleAutoAllowChange = useCallback(
    (enabled: boolean) => {
      void permissionModeMutation.mutateAsync({ enabled })
    },
    [permissionModeMutation],
  )

  // ---- Permission resolve ----
  const handlePermissionResolve = useCallback(
    (
      _kind: PermissionDecisionKind,
      payload: {
        decision: ChatDecisionWithReason
        updatedPermissions: ChatPermissionResolved
      },
    ) => {
      if (!stream.pendingPermission) return
      void permissionMutation.mutateAsync({
        requestId: stream.pendingPermission.requestId,
        decision: payload.decision,
        updatedPermissions: payload.updatedPermissions,
      })
    },
    [permissionMutation, stream.pendingPermission],
  )

  // ---- Cost cap resolve ----
  const handleCostCapResolve = useCallback(
    (resolve: 'continue_once' | 'continue_session' | 'pause' | 'new_session') => {
      void costCapMutation.mutateAsync({ resolve })
    },
    [costCapMutation],
  )

  // ---- 发送消息:有 session → stream.send;无 session → 先 startMutation(同步触发
  // snapshot invalidate),然后 useEffect 监听 meta 出现再 stream.send —— 避免
  // refetch 后闭包内 meta 仍为 null 的 race ----
  const pendingStartRef = useRef<string | null>(null)
  const handleSend = useCallback(
    async (content: string): Promise<void> => {
      if (lock.lockedByOtherTab) return
      if (!meta) {
        // 启动 session 后 snapshot 会刷新;把内容记到 ref,等 meta 出现再 send
        // issue 12 —— /start schema 解耦:/start 不再处理 user content,
        // 只 bootstrap sessionId;真实 send 走下方 stream.send(/query)
        pendingStartRef.current = content
        await startMutation.mutateAsync({})
        // 注意:不要在 await 之后立即 stream.send(meta 仍是旧闭包值)
        return
      }
      await stream.send({ content, cardId: card.id })
    },
    [lock.lockedByOtherTab, meta, startMutation, stream, card.id],
  )

  // 监听 snapshot 拿到新 meta 后自动触发 send(start 模式)
  useEffect(() => {
    if (!pendingStartRef.current) return
    if (lock.lockedByOtherTab) return
    if (!meta) return
    const text = pendingStartRef.current
    pendingStartRef.current = null
    void stream.send({ content: text, cardId: card.id })
  }, [meta, lock.lockedByOtherTab, stream, card.id])

  // ---- plan mode modal:plan mode on + AI 给出 plan → PlanModePrompt 弹 ----
  // 触发条件:assistant message 含 kind:'plan' block(本期 agent SDK 不直接返
  // 这种 block,所以保留接口位,等 SDK 协议层补 plan 事件时再启用)
  const pendingPlan = useMemo(() => {
    const last = [...stream.events].reverse().find(
      (e) => e.kind === 'chat_message_assistant',
    )
    if (!last || last.kind !== 'chat_message_assistant') return null
    for (const c of last.content) {
      if (c.kind === 'text' && c.text.startsWith('## Plan\n')) {
        return c.text
      }
    }
    return null
  }, [stream.events])
  const handlePlanAccept = useCallback(() => {
    // 接受后切回 default mode(由 plan mode UI 控制;mutation 已暴露)
    void planModeMutation.mutateAsync({ enabled: false })
  }, [planModeMutation])
  const handlePlanReject = useCallback((_reason: string) => {
    // reject 反馈到 chat 流:在 tool result 路径里走(本期简化:不发送)
  }, [])
  const handlePlanModify = useCallback((newPrompt: string) => {
    void stream.send({ content: newPrompt, cardId: card.id })
  }, [stream, card.id])

  const planToggleDisabled =
    meta?.permissionMode === 'bypassPermissions' || lock.lockedByOtherTab
  const autoAllowDisabled =
    meta?.permissionMode === 'plan' || lock.lockedByOtherTab

  return (
    <div
      data-testid="board-chat-panel"
      data-card-id={card.id}
      data-requirement-id={requirementId}
      data-locked-by-other={lock.lockedByOtherTab ? 'true' : 'false'}
      className="p-4 bg-bg-elevated flex flex-col gap-2 min-h-[600px] min-w-0"
      style={{ animation: 'expand .25s ease-out' }}
    >
      {/* 单 tab lock banner */}
      {lock.lockedByOtherTab && (
        <div
          data-testid="board-chat-lock-banner"
          className="text-xs text-warning bg-warning/10 px-2 py-1 rounded"
        >
          ⚠️ 已在另一 tab 打开 —— 当前为只读模式;关闭其他 tab 后刷新可继续对话
        </div>
      )}

      {/* head */}
      <div
        data-testid="board-chat-head"
        className="flex items-center gap-2 pb-2 border-b border-border"
      >
        <h3 className="text-sm font-semibold flex-1">
          💬 AI 协作 · {shortCardId(card.id)} chat
        </h3>
        <span
          data-testid="board-chat-badge"
          className="text-[10px] text-text-3 bg-bg-subtle px-1.5 py-0.5 rounded-sm font-medium"
        >
          SDK session
        </span>
        <button
          type="button"
          data-testid="board-chat-close"
          onClick={onClose}
          aria-label="收起回到属性"
          title="收起回到属性"
          className="text-sm w-6 h-6 rounded-md border border-border bg-bg-elevated text-text-2 hover:border-text-3 hover:text-text-1 inline-flex items-center justify-center"
        >
          ✕
        </button>
      </div>

      {/* 顶部 banner:首次进入提示 + 旧 transcript 折叠 */}
      <div
        data-testid="board-chat-banner"
        className="text-xs text-text-3 bg-bg-subtle px-2 py-1.5 rounded flex items-start gap-2"
      >
        <span>📦</span>
        <span>
          这是 Claude Code SDK session,跟下方旧 transcript.yaml 是两套形态 —— chat 走 SDK
          sessionId 续接,旧 transcript 保持只读折叠。
        </span>
      </div>
      {hasLegacyTranscript && (
        <details
          data-testid="board-chat-legacy-fold"
          className="text-xs text-text-3 bg-bg-subtle px-2 py-1.5 rounded"
        >
          <summary className="cursor-pointer">
            📁 旧 transcript.yaml 存档(描述型,只读)
          </summary>
          <div className="mt-1 text-[11px] text-text-3">
            旧 transcript 物理路径仍在
            <code className="font-mono"> board/tasks/{shortCardId(card.id)}/transcript.yaml </code>
            ,可手动查阅但不参与 chat。
          </div>
        </details>
      )}

      {/* UsageBar */}
      {meta ? (
        <UsageBar
          meta={meta}
          planToggleDisabled={planToggleDisabled}
          autoAllowDisabled={autoAllowDisabled}
          subAgentTokens={subAgentTokens}
          subAgentCost={subAgentCost}
          durationMs={durationMs}
          onPlanToggle={handlePlanToggle}
          onAutoAllowChange={handleAutoAllowChange}
          onModelChange={handleModelChange}
        />
      ) : (
        <div
          data-testid="board-chat-usage-bar-loading"
          className="text-xs text-text-3 px-3 py-2 border border-border rounded-md bg-bg-elevated"
        >
          {snapshotQ.isLoading ? '加载 session…' : '尚无 session —— 发消息自动启动 SDK session'}
        </div>
      )}

      {/* 消息流 */}
      <MessageStream events={allEvents} />

      {/* 输入框 */}
      <CardTranscriptInput
        onSend={handleSend}
        isPending={
          stream.status === 'streaming' ||
          startMutation.isPending ||
          modelMutation.isPending ||
          planModeMutation.isPending ||
          permissionModeMutation.isPending
        }
        error={
          stream.error
            ? String(stream.error)
            : snapshotQ.isError
              ? '加载 session 失败,请刷新页面'
              : null
        }
        disabled={lock.lockedByOtherTab}
        placeholder={
          lock.lockedByOtherTab
            ? '已在另一 tab 打开,当前 tab 锁定'
            : meta
              ? '输入消息…⌘+↵ 发送'
              : '输入消息…首次发送会自动启动 SDK session'
        }
        testIdPrefix="board-chat"
      />

      {/* Modal:Permission */}
      {stream.pendingPermission && (
        <PermissionPrompt
          request={stream.pendingPermission}
          forced={stream.pendingPermission.forced}
          onResolve={handlePermissionResolve}
        />
      )}

      {/* Modal:CostCap */}
      {stream.pendingCostCap && meta && (
        <CostCapModal
          costUsd={meta.cumulativeUsage.cumulativeCostUsd}
          onResolve={handleCostCapResolve}
        />
      )}

      {/* Modal:ModelSwitchConfirm */}
      {pendingModel && meta && (
        <ModelSwitchConfirm
          from={meta.model}
          to={pendingModel}
          onConfirm={handleModelConfirm}
          onCancel={handleModelCancel}
        />
      )}

      {/* Modal:PlanModePrompt */}
      {pendingPlan && (
        <PlanModePrompt
          planMarkdown={pendingPlan}
          onAccept={handlePlanAccept}
          onReject={handlePlanReject}
          onModify={handlePlanModify}
        />
      )}
    </div>
  )
}