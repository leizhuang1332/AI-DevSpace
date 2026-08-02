/**
 * 共享 fake Provider —— 复刻 ClaudeCodeProvider.runAnalysisQuery 接口,
 * 测试时通过 `provider.runAnalysisQuery` 注入可控 SDK 流。
 *
 * 行为(按 eventsByTurn 一一对应):
 * - 收到 `assistant` 事件 → 落 text log + publish SSE
 * - 收到 `content_block_start`(type=tool_use) → 落 tool_use log + 调业务工具 handler
 * - 收到 `user`(content:tool_result) → 落 tool_result log
 * - 收到 `result`(subtype=success) → 流关闭,Run 进入 succeeded 门禁
 *
 * 业务工具 handler 接受 tool_use_id + args → 返回 CallToolResult 形态,
 * 与 ClaudeCodeProvider.runAnalysisQuery 的真实封装一致。
 *
 * issue 07 扩展:
 * - `behaviorPerAttempt` 支持按 attempt 1-based 查表决定本次 runAnalysisQuery
 *   返 ok / fail,超出表长 fallback 到第 1 项
 * - `attemptCount` 在 handle 上可读,用于测试断言"只调用了 1 次"或"调用了 3 次"
 */

import type { AIProvider } from '../../../providers/AIProvider.js'

/** 单条 SDK 消息(简化形态) */
export type FakeSdkMessage = Record<string, unknown>

/** 单次 attempt 的结果指令(issue 07 验收 1 / 2 / 3) */
export type FakeAttemptBehavior = {
  result: 'ok' | 'fail'
  /** 仅在 result='fail' 时生效;原样作为 {ok:false, error} 传给上层 */
  error?: string
  /** 是否在 messages 流结束后自动调 complete_analysis 业务工具。默认 true */
  autoComplete?: boolean
}

export interface FakeAnalysisProviderOptions {
  messages?: FakeSdkMessage[]
  /**
   * 是否在 SDK 流结束时自动调 `complete_analysis` 业务工具。
   * - `true`(默认)→ 适合"success but zero issues"场景;Run 顺利进入 succeeded
   * - `false`→ 适合测试"SDK 成功但未调 complete → Run failed"门禁
   */
  autoComplete?: boolean
  /**
   * issue 07:按 attempt 控制 runAnalysisQuery 返回结果。
   * 不传 → 与原行为一致(根据 autoComplete 决定)。
   * 传入 → 第 i 次调用查 `behaviorPerAttempt[i-1]`;超出表长 fallback 到表[0]。
   */
  behaviorPerAttempt?: ReadonlyArray<FakeAttemptBehavior>
}

export interface FakeAnalysisProviderHandle {
  provider: AIProvider
  /** 业务工具调用的所有调用记录(便于测试断言) */
  businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }>
  /** issue 07:runAnalysisQuery 被调用的次数(测试断言 retry 行为) */
  attemptCount: number
  /** issue 07:每次 attempt 的 result 与 error(供测试回溯) */
  attemptHistory: Array<{ attempt: number; result: 'ok' | 'fail'; error?: string }>
}

export function createFakeAnalysisProvider(
  opts: FakeAnalysisProviderOptions = {},
): FakeAnalysisProviderHandle {
  const messages = opts.messages ?? []
  const autoComplete = opts.autoComplete ?? true
  const businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }> = []

  let mcpCounter = 0
  const attemptHistory: Array<{ attempt: number; result: 'ok' | 'fail'; error?: string }> = []
  let attemptCount = 0

  const provider: AIProvider = {
    name: 'fake-analysis',
    async createSession() {
      throw new Error('fake-analysis: createSession not used (runAnalysisQuery path)')
    },
    async shutdown() {},
    async runAnalysisQuery(input) {
      attemptCount++
      // 决定本次 attempt 的结果:有 behaviorPerAttempt 按 1-based 查表,否则用 autoComplete
      const behavior: FakeAttemptBehavior | undefined =
        opts.behaviorPerAttempt !== undefined
          ? opts.behaviorPerAttempt[attemptCount - 1] ?? opts.behaviorPerAttempt[0]
          : undefined

      const effectiveAutoComplete = behavior?.autoComplete ?? autoComplete
      // 默认语义:有 behaviorPerAttempt 走查表;否则按 autoComplete 决定
      // - autoComplete=true (默认):流完后自动调 complete_analysis,本次 ok
      // - autoComplete=false:不调 complete,本次仍返 ok 但 Run 走门禁失败
      //   (issue 02 acceptance 已有 fixture 用例依赖此行为)
      const effectiveResult: 'ok' | 'fail' =
        behavior?.result ?? (autoComplete ? 'ok' : 'ok')

      for (const m of messages) {
        input.onEvent(m)
        // 业务工具调用:content_block_start + tool_use 块 → 调 handler
        if (m['type'] === 'content_block_start') {
          const block = m['content_block'] as Record<string, unknown> | undefined
          if (block && block['type'] === 'tool_use') {
            const toolUseId = String(block['id'] ?? `mcp-${++mcpCounter}`)
            const name = String(block['name'] ?? '')
            const args = block['input']
            businessToolCalls.push({ toolUseId, name, args })
            const handler = input.businessTools[name]
            if (handler) {
              await handler(toolUseId, args)
            }
            // 同步喂回 tool_result envelope(模拟 SDK 内部行为)
            input.onEvent({
              type: 'user',
              message: {
                content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
              },
            })
          }
        }
      }
      // 自动调 complete_analysis 让 Run succeeded(测试可控)
      if (effectiveAutoComplete) {
        const toolUseId = `mcp-complete-${++mcpCounter}`
        const handler = input.businessTools['complete_analysis']
        if (handler) {
          businessToolCalls.push({ toolUseId, name: 'complete_analysis', args: {} })
          await handler(toolUseId, {})
          input.onEvent({
            type: 'user',
            message: {
              content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }],
            },
          })
        }
      }
      // 决定本次最终返回
      if (effectiveResult === 'fail') {
        attemptHistory.push({
          attempt: attemptCount,
          result: 'fail',
          error: behavior?.error ?? 'fake_failure',
        })
        return { ok: false, error: behavior?.error ?? 'fake_failure' }
      }
      attemptHistory.push({ attempt: attemptCount, result: 'ok' })
      return { ok: true }
    },
  }
  return { provider, businessToolCalls, get attemptCount() { return attemptCount }, attemptHistory }
}
