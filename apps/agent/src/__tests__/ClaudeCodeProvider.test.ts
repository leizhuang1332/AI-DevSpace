/**
 * ClaudeCodeProvider tests —— ADR-0010 Q9 wiring
 *
 * 覆盖 createOpts.model → SDK options.model 的透传路径(issue 04 P3 review 漏掉的接线)。
 *
 * 设计:
 * - 注入 mock queryFn 捕获 SDK options
 * - 注入 fake CcSwitchClient 提供可控的 provider 索引
 * - 验证 model id 解析符合 Q9.1:
 *     1. createOpts.model 指定 (providerId, role) → 用该 provider 的 role 对应 model id
 *     2. createOpts.model 未指定 → current provider 的 main model id
 *     3. createOpts.model 指向不存在的 provider → fallback 到 current provider 的 main
 */

import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '../providers/ClaudeCodeProvider.js'
import type { CcSwitchClient, ProviderIndex } from '../providers/CcSwitchClient.js'

function makeFakeCcSwitch(providers: ProviderIndex[]): CcSwitchClient {
  const current = providers.find((p) => p.is_current)
  return {
    getCurrent: () => current,
    getAll: () => providers,
    getById: (id: string) => providers.find((p) => p.id === id),
    getModel: (providerId: string, role) => {
      const p = providers.find((pr) => pr.id === providerId)
      const modelId = p?.models[role]
      if (!p || !modelId) return undefined
      return { providerId, providerName: p.name, role, modelId }
    },
    close: () => {},
  }
}

function makeQueryFn(capture: { options?: Record<string, unknown> }) {
  return ((params: { prompt: string; options?: Record<string, unknown> }) => {
    capture.options = params.options
    return (async function* () {
      yield { type: 'result', subtype: 'success', session_id: 's-1' }
    })()
  }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']
}

const currentProvider: ProviderIndex = {
  id: 'p-current',
  name: 'Current',
  is_current: true,
  baseUrl: '',
  apiKey: '',
  models: {
    main: 'current-main',
    haiku: null,
    sonnet: null,
    opus: null,
    fable: null,
    reasoning: null,
  },
}

const otherProvider: ProviderIndex = {
  id: 'p-other',
  name: 'Other',
  is_current: false,
  baseUrl: '',
  apiKey: '',
  models: {
    main: 'other-main',
    haiku: null,
    sonnet: 'special-sonnet-x',
    opus: null,
    fable: null,
    reasoning: null,
  },
}

describe('createClaudeCodeProvider - Q9 model selection wiring', () => {
  it('uses the (providerId, role) model id when createOpts.model is set', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider, otherProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
      model: { providerId: 'p-other', role: 'sonnet' },
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('special-sonnet-x')
  })

  it('falls back to current provider main when createOpts.model is undefined', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('current-main')
  })

  it('falls back to current provider when createOpts.model points to unknown provider', async () => {
    const capture: { options?: Record<string, unknown> } = {}
    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch([currentProvider]),
      queryFn: makeQueryFn(capture),
    })
    const session = await provider.createSession('r-1', {
      topic: 't',
      kind: 'chat',
      model: { providerId: 'p-unknown', role: 'sonnet' },
    })
    await session.send('hi')

    expect(capture.options?.['model']).toBe('current-main')
  })
})