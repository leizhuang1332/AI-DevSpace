/**
 * fakePrdSplitProvider —— PRD 拆解 Run 测试 fake provider(issue 05)
 *
 * 镜像 `fakeAnalysisQueryProvider.ts`,但语义更简:
 * - `runAnalysisQuery` 同步调 `input.businessTools.propose_card` N 次(用 fixture
 *   cards),每次合成 `toolUseId = mcp-propose_card-<n>`,然后返 `{ ok: true }`
 * - **无** `complete_analysis`(PRD 拆解无完成门禁,SDK turn 结束即完成)
 * - 暴露 `businessToolCalls` 便于断言"调用了 N 次"
 *
 * 经 `buildServer({ provider: handle.provider })` 注入(server.ts:225 honors
 * `opts.provider`)。fire-and-forget 块在 microtask resolve;route 的 POST 201
 * 返后,测试 GET /runs/:runId 拉已落盘 cards(事件循环 drain microtask)。
 */

import type { AIProvider } from '../../../providers/AIProvider.js'

/** 单张 fixture 卡片(模型本应通过 propose_card 提交的 args) */
export interface FixtureCard {
  title: string
  content?: string
  suggested_priority?: 'low' | 'medium' | 'high' | 'urgent' | null
  labels?: string[]
}

export interface FakePrdSplitProviderOptions {
  /** fixture 卡片;runAnalysisQuery 调用后逐条调 propose_card */
  cards?: ReadonlyArray<FixtureCard>
  /** 本次 runAnalysisQuery 返回(默认 ok:true) */
  result?: 'ok' | 'fail' | 'pending'
  /** result='fail' 时的错误字符串 */
  error?: string
  /** result='pending' 时,resolve 此函数后才返回(用于测 409 in-flight) */
  resolvePending?: () => void
}

export interface FakePrdSplitProviderHandle {
  provider: AIProvider
  /** 业务工具调用的所有记录(便于测试断言) */
  businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }>
  /** runAnalysisQuery 被调用的次数 */
  attemptCount: number
}

export function createFakePrdSplitProvider(
  opts: FakePrdSplitProviderOptions = {},
): FakePrdSplitProviderHandle {
  const cards = opts.cards ?? []
  const resultKind = opts.result ?? 'ok'
  const failError = opts.error ?? 'fake_failure'
  const businessToolCalls: Array<{ toolUseId: string; name: string; args: unknown }> = []
  let mcpCounter = 0
  let attemptCount = 0

  const provider: AIProvider = {
    name: 'fake-prd-split',
    async createSession() {
      throw new Error('fake-prd-split: createSession not used (runAnalysisQuery path)')
    },
    async shutdown() {},
    async runAnalysisQuery(input) {
      attemptCount++
      // 逐条调 propose_card handler(模拟模型逐张提交)
      for (const card of cards) {
        const toolUseId = `mcp-propose_card-${++mcpCounter}`
        const args: Record<string, unknown> = { title: card.title }
        if (card.content !== undefined) args.content = card.content
        if (card.suggested_priority !== undefined) args.suggested_priority = card.suggested_priority
        if (card.labels !== undefined) args.labels = card.labels
        businessToolCalls.push({ toolUseId, name: 'propose_card', args })
        const handler = input.businessTools['propose_card']
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
      if (resultKind === 'pending') {
        // 永不 resolve(直到 opts.resolvePending 被外部调);用于测 in-flight 409
        return new Promise<{ ok: true } | { ok: false; error: string }>(() => {})
      }
      if (resultKind === 'fail') {
        return { ok: false, error: failError }
      }
      return { ok: true }
    },
  }

  return {
    provider,
    businessToolCalls,
    get attemptCount() {
      return attemptCount
    },
  }
}
