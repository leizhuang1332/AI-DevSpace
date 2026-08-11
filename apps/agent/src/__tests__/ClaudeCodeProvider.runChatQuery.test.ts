/**
 * ClaudeCodeProvider.runChatQuery 测试 —— issue 14
 *
 * 真实调用栈(2026-08-11 抓):
 *   SDK 调 `claude -p --resume sdk-fake-001 ...`
 *   → CLI 找不到该 sessionId(因为是 FakeChatProvider 留下的假 id,非 UUID)
 *   → CLI 退出码非 0,stderr 写 `--resume requires a valid session ID...`
 *   → SDK 把错误当 result event emit(reason='error')
 *      然后 throw 包好的 Error 到 Provider catch 分支
 *   → Provider 必须 catch 时识别"resume session not found"模式并标
 *      isSessionExpired=true,让路由层走端到端自愈
 *
 * issue 13 只覆盖了 ok=true 路径(SDK 不 throw 时);issue 14 补 ok=false 路径。
 */

import { describe, it, expect } from 'vitest'
import { createClaudeCodeProvider } from '../providers/ClaudeCodeProvider.js'
import type { CcSwitchClient, ProviderIndex } from '../providers/CcSwitchClient.js'
import type { ChatQueryInput, ChatQueryResult } from '../providers/AIProvider.js'

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

function makeFakeCcSwitch(): CcSwitchClient {
  return {
    getCurrent: () => currentProvider,
    getAll: () => [currentProvider],
    getById: () => currentProvider,
    getModel: (_id, role) => ({
      providerId: 'p-current',
      providerName: 'Current',
      role,
      modelId: 'current-main',
    }),
    close: () => {},
  }
}

function makeBaseInput(overrides: Partial<ChatQueryInput> = {}): ChatQueryInput {
  return {
    prompt: 'hello',
    cwd: '/workspace/test/chat',
    additionalDirectories: [],
    model: 'claude-sonnet-5',
    permissionMode: 'default',
    resumeSessionId: 'sdk-fake-001',
    frozenCwd: '/workspace/test/chat',
    userConfirmHandler: async () => ({ behavior: 'allow' }),
    onEvent: () => {},
    ...overrides,
  }
}

describe('ClaudeCodeProvider.runChatQuery - issue 14 session-expired catch path', () => {
  it('SDK CLI throw "requires a valid session ID" + resumeSessionId 非空 → catch 返 ok=false + isSessionExpired=true', async () => {
    // 模拟 SDK 在 for-await 内部 throw(CLI 找不到 session 时)
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        // SDK 通常先 emit 一个 result event 再 throw(模拟)
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          session_id: '4d042f6d-18da-464e-b47c-8992be72401b',
        }
        // 然后 throw 包好的 Error
        throw new Error(
          'Claude Code returned an error result: Error: --resume requires a valid ' +
            'session ID or session title when used with --print. Usage: claude -p ' +
            '--resume <session-id|title>. Provided value "sdk-fake-001" is not a ' +
            'UUID and does not match any session title.',
        )
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch(),
      queryFn,
    })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(makeBaseInput({ resumeSessionId: 'sdk-fake-001' }))

    expect(result.ok).toBe(false)
    expect(result.isSessionExpired).toBe(true)
    expect(result.error).toMatch(/requires a valid session ID/)
  })

  it('SDK CLI throw "is not a UUID" 模式 + resumeSessionId 非空 → isSessionExpired=true', async () => {
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        throw new Error(
          'Claude Code returned an error result: Error: --resume <id>. ' +
            'Provided value "sdk-fake-001" is not a UUID and does not match any session title.',
        )
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch(),
      queryFn,
    })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(makeBaseInput({ resumeSessionId: 'sdk-fake-001' }))
    expect(result.ok).toBe(false)
    expect(result.isSessionExpired).toBe(true)
  })

  it('SDK throw 非 session-expired 错误(rate limit) + resumeSessionId 非空 → isSessionExpired=false', async () => {
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        throw new Error('rate limit exceeded')
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch(),
      queryFn,
    })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(makeBaseInput({ resumeSessionId: 'sdk-fake-001' }))
    expect(result.ok).toBe(false)
    expect(result.isSessionExpired).toBe(false)
    expect(result.error).toMatch(/rate limit/)
  })

  it('SDK throw session-expired 错误但 resumeSessionId 为空(首次 query 路径)→ isSessionExpired=false', async () => {
    // 首次 query 不传 resumeSessionId;即使错误 message 形似,也不应标 session-expired
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        throw new Error(
          'Claude Code returned an error result: Error: --resume requires a valid session ID',
        )
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch(),
      queryFn,
    })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(makeBaseInput({ resumeSessionId: undefined }))
    expect(result.ok).toBe(false)
    expect(result.isSessionExpired).toBe(false)
  })

  it('ok=true 路径(SDK 不 throw,正常 emit result success) → result.ok=true 且无 isSessionExpired', async () => {
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'real-uuid-001' }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'real-uuid-001',
          usage: { input_tokens: 10, output_tokens: 20 },
        }
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({
      ccSwitch: makeFakeCcSwitch(),
      queryFn,
    })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(makeBaseInput({ resumeSessionId: 'real-uuid-001' }))
    expect(result.ok).toBe(true)
    expect(result.sessionId).toBe('real-uuid-001')
    expect(result.isSessionExpired).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// issue 15 —— SDK type=assistant 事件处理
//
// 真实调用栈(2026-08-11 抓):SDK 0.3.206 调真 LLM 跑 1 turn(26k tokens,
// end_turn),实际 emit 序列是 system/init → system/thinking_tokens ×N
// → assistant(content=[{type:'text', text:'...'}]) → result(success)。
// 但 chatQuery 之前 for-await 循环里没 case 处理 type=assistant,导致
// assistant 文本被静默丢弃 → SSE 流只有 chat_session_init + chat_complete,
// 无 chat_message_assistant → web 端"AI 没回复"。
// ---------------------------------------------------------------------------

describe('ClaudeCodeProvider.runChatQuery - issue 15 assistant event handling', () => {
  it('SDK 1 个 assistant event(content 含 1 个 text 块)→ onEvent 收到 1 次 message_assistant(text, partial:false)', async () => {
    const events: unknown[] = []
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'real-uuid' }
        yield {
          type: 'assistant',
          session_id: 'real-uuid',
          message: {
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello, I am Claude.' }],
            model: 'claude-sonnet-5',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 8 },
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'real-uuid',
          usage: { input_tokens: 10, output_tokens: 8 },
        }
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({ ccSwitch: makeFakeCcSwitch(), queryFn })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(
      makeBaseInput({
        onEvent: (e) => events.push(e),
        resumeSessionId: undefined,
      }),
    )
    expect(result.ok).toBe(true)

    const assistantEvents = events.filter(
      (e) => (e as { kind?: string }).kind === 'message_assistant',
    )
    expect(assistantEvents).toHaveLength(1)
    const evt = assistantEvents[0] as { text: string; partial: boolean }
    expect(evt.text).toBe('Hello, I am Claude.')
    expect(evt.partial).toBe(false)
  })

  it('SDK 1 个 assistant event 含多个 text 块 → 合并为 1 个 emit(顺序拼接)', async () => {
    const events: unknown[] = []
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'real-uuid' }
        yield {
          type: 'assistant',
          session_id: 'real-uuid',
          message: {
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'text', text: 'Part 1. ' },
              { type: 'tool_use', id: 't-1', name: 'Read', input: { file: 'x' } },
              { type: 'text', text: 'Part 2.' },
            ],
            model: 'claude-sonnet-5',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 8 },
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'real-uuid',
          usage: { input_tokens: 10, output_tokens: 8 },
        }
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({ ccSwitch: makeFakeCcSwitch(), queryFn })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(
      makeBaseInput({
        onEvent: (e) => events.push(e),
        resumeSessionId: undefined,
      }),
    )
    expect(result.ok).toBe(true)

    const assistantEvents = events.filter(
      (e) => (e as { kind?: string }).kind === 'message_assistant',
    )
    expect(assistantEvents).toHaveLength(1)
    const evt = assistantEvents[0] as { text: string }
    expect(evt.text).toBe('Part 1. Part 2.')
  })

  it('SDK assistant event 的 content 不是数组 / block 非 text / text 非 string → 静默跳过,不抛错', async () => {
    const events: unknown[] = []
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'real-uuid' }
        // content 不是数组
        yield {
          type: 'assistant',
          session_id: 'real-uuid',
          message: { id: 'msg-1', type: 'message', role: 'assistant', content: 'not-array', model: 'x' },
        }
        // content 是数组但 block 都不合法
        yield {
          type: 'assistant',
          session_id: 'real-uuid',
          message: {
            id: 'msg-2',
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 't', name: 'X', input: {} },
              { type: 'text', text: 123 }, // text 不是 string
              { type: 'unknown' },
            ],
            model: 'x',
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'real-uuid',
          usage: { input_tokens: 10, output_tokens: 8 },
        }
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({ ccSwitch: makeFakeCcSwitch(), queryFn })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(
      makeBaseInput({
        onEvent: (e) => events.push(e),
        resumeSessionId: undefined,
      }),
    )
    expect(result.ok).toBe(true)

    // 应该没有任何 message_assistant 事件(所有 assistant event 的 text 块都不合法)
    const assistantEvents = events.filter(
      (e) => (e as { kind?: string }).kind === 'message_assistant',
    )
    expect(assistantEvents).toHaveLength(0)
  })

  it('完整 SDK 流程:system/init → assistant("hi") → result(success) → 断言 onEvent 收到 3 个 event(session_init + message_assistant + complete)', async () => {
    const events: unknown[] = []
    const queryFn = ((_params: { prompt: string; options?: Record<string, unknown> }) => {
      return (async function* () {
        yield { type: 'system', subtype: 'init', session_id: 'real-uuid' }
        yield {
          type: 'assistant',
          session_id: 'real-uuid',
          message: {
            id: 'msg-1',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
            model: 'claude-sonnet-5',
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 8 },
          },
        }
        yield {
          type: 'result',
          subtype: 'success',
          session_id: 'real-uuid',
          usage: { input_tokens: 10, output_tokens: 8 },
        }
      })()
    }) as unknown as Parameters<typeof createClaudeCodeProvider>[0]['queryFn']

    const provider = createClaudeCodeProvider({ ccSwitch: makeFakeCcSwitch(), queryFn })
    const cap = provider as unknown as {
      runChatQuery: (input: ChatQueryInput) => Promise<ChatQueryResult>
    }

    const result = await cap.runChatQuery(
      makeBaseInput({
        onEvent: (e) => events.push(e),
        resumeSessionId: undefined,
      }),
    )
    expect(result.ok).toBe(true)

    const kinds = events.map((e) => (e as { kind: string }).kind)
    expect(kinds).toEqual(['session_init', 'message_assistant', 'complete'])
  })
})
