'use client'

/**
 * PermissionPrompt — 写工具拦截 modal(ADR-0029 D5 决策 24-27)
 *
 * 形态:
 * - 顶部:Auto-allow 开关(本期 UI 简化:不暴露 toggle,默认走 MCP tool 拦截)
 * - 中部:title + toolName + description + args 预览
 * - 底部:[Allow once] [Allow session] [Deny]
 * - forced=true(敏感模式):banner 红框强调
 */

import { useState, type ReactNode } from 'react'
import type {
  ChatDecisionWithReason,
  ChatPermissionRequest,
  ChatPermissionResolved,
} from '@ai-devspace/shared'

export type PermissionDecisionKind = 'allow-once' | 'allow-session' | 'deny'

export interface PermissionPromptProps {
  request: ChatPermissionRequest
  /**
   * 是否命中敏感模式(rm -rf /、chmod 777、mkfs、dd、git push --force、
   * curl | sh)—— 强制弹 modal,即使 auto-allow 开启也不跳过。
   *
   * 来自 SSE `chat_permission_request` 事件的 `forced` 字段
   * (packages/shared/src/board-chat.ts);父组件从 stream.pendingPermission.forced 透传。
   */
  forced?: boolean
  onResolve: (
    kind: PermissionDecisionKind,
    payload: {
      decision: ChatDecisionWithReason
      updatedPermissions: ChatPermissionResolved
    },
  ) => void
}

export function PermissionPrompt({
  request,
  forced = false,
  onResolve,
}: PermissionPromptProps): ReactNode {
  const [denyReason, setDenyReason] = useState('')
  // forced=true 的"敏感模式永弹"信号由 SSE 事件 chat_permission_request 携带
  // (见 board-chat.ts ChatSessionEventSchema);此处接父组件透传的 forced prop。
  const isForced = forced

  const handleAllowOnce = (): void => {
    onResolve('allow-once', {
      decision: { decision: 'allow' },
      updatedPermissions: { behavior: 'allow' },
    })
  }

  const handleAllowSession = (): void => {
    // 增量白名单:同 toolName 整个 session 放行
    onResolve('allow-session', {
      decision: { decision: 'allow' },
      updatedPermissions: {
        behavior: 'allow',
        updatedPermissions: [
          {
            type: 'addRules',
            rules: [{ toolName: request.toolName, ruleContent: '*' }],
            destination: 'session',
          },
        ],
      },
    })
  }

  const handleDeny = (): void => {
    onResolve('deny', {
      decision: { decision: 'deny', reason: denyReason.trim() || undefined },
      updatedPermissions: {
        behavior: 'deny',
        reason: denyReason.trim() || undefined,
      },
    })
  }

  return (
    <div
      data-testid="board-chat-permission-modal"
      data-request-id={request.requestId}
      data-forced={isForced ? 'true' : 'false'}
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
    >
      <div className="bg-bg-elevated border border-border rounded-lg p-4 max-w-lg w-full flex flex-col gap-3">
        {isForced && (
          <div
            data-testid="board-chat-permission-forced-banner"
            className="text-xs text-error bg-error/10 px-2 py-1 rounded"
          >
            ⚠️ 命中敏感模式(rm -rf /、chmod 777、mkfs、dd、git push --force、curl | sh)——
            即使 auto-allow 开启也强制弹 modal
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <h3 className="text-sm font-semibold flex-1 text-text-1">
            {request.title ?? `允许 ${request.toolName}?`}
          </h3>
        </div>
        {request.description && (
          <p className="text-xs text-text-2">{request.description}</p>
        )}
        <div className="text-xs text-text-3 font-mono break-all bg-bg-subtle px-2 py-1.5 rounded">
          <div className="mb-1 text-text-2 font-semibold">{request.toolName}</div>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(request.input, null, 2)}
          </pre>
        </div>
        <input
          data-testid="board-chat-permission-deny-reason"
          type="text"
          value={denyReason}
          onChange={(e) => setDenyReason(e.target.value)}
          placeholder="(可选)拒绝理由"
          className="text-xs border border-border rounded px-2 py-1 bg-bg-elevated text-text-1"
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            data-testid="board-chat-permission-allow-once"
            onClick={handleAllowOnce}
            className="px-3 py-1.5 text-xs rounded bg-brand text-white border border-brand hover:bg-brand-600"
          >
            Allow once
          </button>
          <button
            type="button"
            data-testid="board-chat-permission-allow-session"
            onClick={handleAllowSession}
            className="px-3 py-1.5 text-xs rounded border border-border bg-bg-elevated text-text-1 hover:border-text-3"
          >
            Allow session
          </button>
          <button
            type="button"
            data-testid="board-chat-permission-deny"
            onClick={handleDeny}
            className="px-3 py-1.5 text-xs rounded border border-error text-error hover:bg-error/10 ml-auto"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}