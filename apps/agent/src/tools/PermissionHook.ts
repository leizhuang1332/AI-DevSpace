/**
 * PermissionHook —— ADR-0010 Q6.1 (5 类高危 → SDK PreToolUse hook)
 *
 * 包装 SDK 原生 PreToolUse hook,把 HighRiskDetector 的检测结果翻译成 SDK 期望的:
 *   - hookSpecificOutput.permissionDecision = 'deny' → SDK 立即把工具结果当 error 返回给 AI
 *   - hookSpecificOutput.permissionDecision = 'allow' → 放行
 *   - hookSpecificOutput.permissionDecision = 'ask' → SDK 走 canUseTool 控制请求;本期不直接走
 *
 * SDK 形态(摘自 @anthropic-ai/claude-agent-sdk sdk.d.ts):
 *   type PreToolUseHookInput = { hook_event_name:'PreToolUse'; tool_name; tool_input; tool_use_id }
 *   type PreToolUseHookSpecificOutput = {
 *     hookEventName: 'PreToolUse'
 *     permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer'
 *     permissionDecisionReason?: string
 *   }
 *   type SyncHookJSONOutput = { hookSpecificOutput?: PreToolUseHookSpecificOutput | ... }
 *   type AsyncHookJSONOutput = { async: true; asyncTimeout?: number }
 *   type HookJSONOutput = AsyncHookJSONOutput | SyncHookJSONOutput
 *
 * 设计取舍:
 *  - **决策 46「4 级曝光」** = Inline / Toast / 模态 / 暂停;本期 P2 落地模态(Q6.3);
 *    模态交互的「approve / deny」响应通过 SseHub publish 推到 Web,Web 端点 confirm
 *    后由 S6 接入双向通道完成(本期先 deny + 推 SSE 通知,让 AI 看到错误)
 *  - **审批通道** —— 抽象为 PermissionPrompter;测试可注入 mock 同步决议
 *  - **失败降级** —— detect 抛错 → 默认 'deny'(决策 46 防线硬约束)
 */
import type { SseEvent } from '@ai-devspace/shared'
import type { SseHub } from '../sse/SseHub.js'
import { createHighRiskDetector, type HighRiskDetector, type RiskHit } from './HighRiskDetector.js'
import type { HighRiskDetectorDeps } from './HighRiskDetector.js'

/** SDK PreToolUse hook 的输入形态(精简;与 SDK 兼容) */
export interface PreToolUseInput {
  hook_event_name: 'PreToolUse'
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

/** SDK HookJSONOutput 中 hookSpecificOutput 的 PreToolUse 形态(简化) */
export interface PreToolUseSpecificOutput {
  hookEventName: 'PreToolUse'
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer'
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}

/** 同步 hook 输出的最小契约(SDK SyncHookJSONOutput) */
export interface PreToolUseOutput {
  hookSpecificOutput: PreToolUseSpecificOutput
}

/** 权限决议(由 prompter 决定,同步 / 异步都行) */
export type PermissionResolution = 'allow' | 'deny'

/**
 * 审批交互 —— 默认实现是把 permission_request 推进 SSE 通道。
 * 真实 Web 集成在 S6 (Web 工作台) 阶段落地双向通道;
 * 测试用 mock prompter 同步决议。
 */
export interface PermissionPrompter {
  ask(input: {
    toolName: string
    toolInput: unknown
    hits: ReadonlyArray<RiskHit>
    /** Web 端回复时调 resolve(decision);S6 接入 */
    resolve: (resolution: PermissionResolution) => void
    /** Web 端回复时附带理由 */
    resolveWithReason: (resolution: PermissionResolution, reason?: string) => void
  }): void
}

/** SSE prompter —— 默认实现 */
export function createSsePermissionPrompter(deps: {
  hub: SseHub
  /** reqId 用于 publish(reqId, ...);hook 调用时注入 */
  getReqId: () => string
  /** sessionId 用于 SSE 事件载荷 */
  getSessionId: () => string
}): PermissionPrompter {
  const { hub, getReqId, getSessionId } = deps
  return {
    ask(input) {
      const requestId = randomId()
      const event: SseEvent = {
        type: 'permission_request',
        reqId: getReqId(),
        sessionId: getSessionId(),
        ts: Date.now(),
        requestId,
        toolName: input.toolName,
        toolInput: input.toolInput,
        hits: input.hits,
      }
      hub.publish(getReqId(), event)
      // 本期决议回路:no-op resolve;S6 接入后由 Web 端 confirm 调用
      void input
    },
  }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface PermissionHookDeps {
  /** 5 类检测器;默认 createHighRiskDetector() */
  detector?: HighRiskDetector
  /** 审批交互;默认走 SSE prompter(hub + getReqId + getSessionId 都需传) */
  prompter?: PermissionPrompter
  /** 是否启用(默认 true);debug 关 */
  enabled?: boolean
  /** HighRiskDetector 自定义配置 —— detector 没传时生效 */
  detectorOpts?: HighRiskDetectorDeps
  /** SSE Hub —— prompter 没传时走 createSsePermissionPrompter(hub, ...) */
  hub?: SseHub
  /** 当前 reqId —— SSE prompter 用 */
  getReqId?: () => string
  /** 当前 sessionId —— SSE prompter 用 */
  getSessionId?: () => string
}

/** PreToolUse hook —— 直接给 SDK options.hooks.PreToolUse 用 */
export interface PermissionHook {
  readonly callback: (
    input: PreToolUseInput,
    toolUseID: string | undefined,
    options: { signal: AbortSignal },
  ) => Promise<PreToolUseOutput>
  shutdown(): void
}

export function createPermissionHook(deps: PermissionHookDeps = {}): PermissionHook {
  const enabled = deps.enabled ?? true
  const detector = deps.detector ?? createHighRiskDetector(deps.detectorOpts ?? {})
  const prompter: PermissionPrompter =
    deps.prompter
    ?? (deps.hub && deps.getReqId && deps.getSessionId
      ? createSsePermissionPrompter({
          hub: deps.hub,
          getReqId: deps.getReqId,
          getSessionId: deps.getSessionId,
        })
      : noopPrompter)

  const callback: PermissionHook['callback'] = async (input, _toolUseID, options) => {
    if (!enabled) {
      return {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      }
    }

    let hits: RiskHit[]
    try {
      hits = detector.detect(input.tool_name, input.tool_input)
    } catch (err) {
      // detect 抛错 → 默认 deny(决策 46 防线硬约束)
      const msg = err instanceof Error ? err.message : String(err)
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `risk detector crashed; default-deny: ${msg}`,
        },
      }
    }

    if (hits.length === 0) {
      return {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' },
      }
    }

    // 命中 → 通知 prompter(默认推 SSE 让 Web 弹模态)
    // 本期 P2:prompter 推送后,hook 默认返回 'deny',让 SDK 把工具失败回给 AI
    // S6 接入双向通道后改成 'ask',让 SDK 等用户回复
    // (signal 透传给 prompter 备用 —— prompter 当前不消费)
    prompter.ask({
      toolName: input.tool_name,
      toolInput: input.tool_input,
      hits,
      resolve: () => {
        /* S6 接入 */
      },
      resolveWithReason: () => {
        /* S6 接入 */
      },
    })

    const summary = hits.map((h) => `[${h.category}] ${h.reason}`).join('; ')
    void options
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `blocked by 5-class high-risk guard (${summary}); user confirmation required via web UI`,
      },
    }
  }

  return {
    callback,
    shutdown: () => {
      /* no-op(预留 prompter 资源清理) */
    },
  }
}

const noopPrompter: PermissionPrompter = {
  ask() {
    /* 默认 no-op;测试场景通常直接注入 mock */
  },
}