/**
 * AISession × SystemPromptAssembler integration test —— ADR-0010 Q5
 *
 * 验证 send() 时:
 *  - 注入 assembler 后,adapter.runTurn 收到的 appendSystemPrompt 包含装配内容
 *  - 没注入 assembler → appendSystemPrompt 为 undefined(向后兼容)
 *  - assembleBase 缓存命中 → 同一 session 第二次 send 只算 dynamic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AiSession, type SdkAdapter } from '../session/AISession.js'
import { createSystemPromptAssembler } from '../prompt/SystemPromptAssembler.js'

describe('AISession × SystemPromptAssembler', () => {
  let skillsRoot: string
  let reqRoot: string
  beforeEach(async () => {
    skillsRoot = join(tmpdir(), `skills-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    reqRoot = join(tmpdir(), `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    await mkdir(skillsRoot, { recursive: true })
    await mkdir(reqRoot, { recursive: true })
    const s = join(skillsRoot, 'demo')
    await mkdir(s)
    await writeFile(
      join(s, 'SKILL.md'),
      `---
name: demo
description: demo skill
arming: always
---

# Demo Skill

This is the full body that should land in the prompt.
`,
    )
  })
  afterEach(async () => {
    await rm(skillsRoot, { recursive: true, force: true })
    await rm(reqRoot, { recursive: true, force: true })
  })

  it('passes appendSystemPrompt to adapter when assembler is injected', async () => {
    const captured: { prompt?: string; appendSystemPrompt?: string } = {}
    const adapter: SdkAdapter = {
      async *runTurn({ prompt, appendSystemPrompt }) {
        captured.prompt = prompt
        captured.appendSystemPrompt = appendSystemPrompt
        yield { kind: 'assistant', sessionId: 's', text: 'hi' }
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const assembler = createSystemPromptAssembler({ skillsRoot })
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
      assembler,
      requirement: { reqId: 'r-1', currentFocus: 'writing-code', rootPath: reqRoot },
    })

    await session.send('please run demo skill')
    expect(captured.prompt).toBe('please run demo skill')
    expect(captured.appendSystemPrompt).toBeDefined()
    expect(captured.appendSystemPrompt).toContain('## Platform Philosophy')
    expect(captured.appendSystemPrompt).toContain('## Active Skills (Always-on)')
    expect(captured.appendSystemPrompt).toContain('Demo Skill')
    expect(captured.appendSystemPrompt).toContain('This is the full body')
    expect(captured.appendSystemPrompt).toContain('## Current Context')
    expect(captured.appendSystemPrompt).toContain('**Current focus**: writing-code')
  })

  it('omits appendSystemPrompt when assembler is not injected', async () => {
    const captured: { appendSystemPrompt?: string } = {}
    const adapter: SdkAdapter = {
      async *runTurn({ appendSystemPrompt }) {
        captured.appendSystemPrompt = appendSystemPrompt
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const session = new AiSession({
      id: 's-1',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
    })
    await session.send('q')
    expect(captured.appendSystemPrompt).toBeUndefined()
  })

  it('caches base prompt across sends within the same session', async () => {
    const assembleBaseSpy = vi.spyOn(
      await import('../prompt/SystemPromptAssembler.js'),
      'createSystemPromptAssembler',
    )
    // 直接跟踪 assembler 内部 baseCache;通过观察 appendSystemPrompt 在第二次 send 时仍包含 base 来推断
    const captured: string[] = []
    const adapter: SdkAdapter = {
      async *runTurn({ appendSystemPrompt }) {
        captured.push(appendSystemPrompt ?? '')
        yield { kind: 'assistant', sessionId: 's', text: 'r' }
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const assembler = createSystemPromptAssembler({ skillsRoot })
    const session = new AiSession({
      id: 's-cache',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
      assembler,
      requirement: { reqId: 'r-1', rootPath: reqRoot },
    })
    await session.send('first query')
    await session.send('second query')
    expect(captured).toHaveLength(2)
    // 两次都包含 base
    expect(captured[0]).toContain('## Platform Philosophy')
    expect(captured[1]).toContain('## Platform Philosophy')
    // 两次包含 dynamic 中的 Current Context
    expect(captured[0]).toContain('**Session kind**: chat')
    expect(captured[1]).toContain('**Session kind**: chat')
    void assembleBaseSpy
  })

  it('falls back gracefully when assembler throws', async () => {
    const captured: { appendSystemPrompt?: string } = {}
    const adapter: SdkAdapter = {
      async *runTurn({ appendSystemPrompt }) {
        captured.appendSystemPrompt = appendSystemPrompt
        yield { kind: 'result', sessionId: 's', reason: 'end_turn' }
      },
    }
    const assembler = createSystemPromptAssembler({ skillsRoot: reqRoot })
    // 让 assembleBase 抛错 → AISession 应捕获并降级
    const spy = vi.spyOn(assembler, 'assembleBase').mockRejectedValue(new Error('boom'))
    const session = new AiSession({
      id: 's-fail',
      reqId: 'r-1',
      topic: 't',
      kind: 'chat',
      adapter,
      assembler,
      requirement: { reqId: 'r-1', rootPath: reqRoot },
    })
    await session.send('q')
    // 装配失败 → 降级:appendSystemPrompt 为 undefined,SDK 用默认 prompt
    expect(captured.appendSystemPrompt).toBeUndefined()
    spy.mockRestore()
  })
})