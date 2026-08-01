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
 */

import type { AIProvider } from '../../../providers/AIProvider.js'

/** 单条 SDK 消息(简化形态) */
export type FakeSdkMessage = Record<string, unknown>

export interface FakeAnalysisProviderHandle {
  provider: AIProvider
  /** 业务工具调用的所有调用记录(便于测试断言) */
  businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }>
}

export function createFakeAnalysisProvider(opts: {
  messages?: FakeSdkMessage[]
  /**
   * 是否在 SDK 流结束时自动调 `complete_analysis` 业务工具。
   * - `true`(默认)→ 适合"success but zero issues"场景;Run 顺利进入 succeeded
   * - `false`→ 适合测试"SDK 成功但未调 complete → Run failed"门禁
   */
  autoComplete?: boolean
} = {}): FakeAnalysisProviderHandle {
  const messages = opts.messages ?? []
  const autoComplete = opts.autoComplete ?? true
  const businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }> = []

  let mcpCounter = 0

  const provider: AIProvider = {
    name: 'fake-analysis',
    async createSession() {
      throw new Error('fake-analysis: createSession not used (runAnalysisQuery path)')
    },
    async shutdown() {},
    async runAnalysisQuery(input) {
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
      if (autoComplete) {
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
      return { ok: true }
    },
  }
  return { provider, businessToolCalls }
}