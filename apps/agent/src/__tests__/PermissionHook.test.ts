/**
 * PermissionHook tests —— ADR-0010 Q6.1
 *
 * 覆盖:
 *  - clean tool_use → 'allow'
 *  - 5 类高危 → 'deny' + permissionDecisionReason
 *  - SSE prompter 在命中时 publish(reqId, permission_request event)
 *  - detect 抛错 → 默认 deny(防线硬约束)
 *  - enabled: false → 直接 allow(debug 关)
 *  - 自定义 prompter 接收 ask() 调用
 *  - 自定义 detector 替换默认 detector
 */

import { describe, it, expect, vi } from 'vitest'
import { createSseHub, type SseHub, type SseEvent } from '../sse/SseHub.js'
import {
  createPermissionHook,
  type PermissionPrompter,
  type PreToolUseInput,
} from '../tools/PermissionHook.js'
import type { HighRiskDetector, RiskHit } from '../tools/HighRiskDetector.js'

function bashCmd(command: string): PreToolUseInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    tool_use_id: 'tu-1',
  }
}

function writeInput(content: string, filePath = 'src/Foo.ts'): PreToolUseInput {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
    tool_use_id: 'tu-2',
  }
}

function hookInput(
  toolName: string,
  toolInput: unknown,
  toolUseId = 'tu-x',
): PreToolUseInput {
  return { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId }
}

describe('PermissionHook (default detector)', () => {
  it('allows clean Bash', async () => {
    const hook = createPermissionHook()
    const out = await hook.callback(bashCmd('ls -la'), 'tu-1', { signal: new AbortController().signal })
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow')
  })

  it('denies git push --force with reason', async () => {
    const hook = createPermissionHook()
    const out = await hook.callback(bashCmd('git push --force origin feature/x'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('force-push')
  })

  it('denies Write with api_key', async () => {
    const hook = createPermissionHook()
    const out = await hook.callback(
      writeInput('api_key=abcdefghijklmnop1234567890', 'config/app.yaml'),
      'tu-2',
      { signal: new AbortController().signal },
    )
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('secret-leak')
  })

  it('denies Edit to protected path', async () => {
    const hook = createPermissionHook({ detectorOpts: { protectedPaths: ['.git/'] } })
    const out = await hook.callback(
      hookInput('Edit', { file_path: '.git/HEAD', new_string: 'ref: refs/heads/x' }),
      'tu-3',
      { signal: new AbortController().signal },
    )
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('delete-business-file')
  })

  it('aggregates multiple risks into single deny reason', async () => {
    const hook = createPermissionHook()
    const out = await hook.callback(bashCmd('git push -f origin main'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('force-push')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('push-to-main')
  })

  it('returns allow when enabled=false', async () => {
    const hook = createPermissionHook({ enabled: false })
    const out = await hook.callback(bashCmd('git push --force origin main'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(out.hookSpecificOutput.permissionDecision).toBe('allow')
  })
})

describe('PermissionHook (custom detector)', () => {
  it('uses injected detector instead of default', async () => {
    const customHits: RiskHit[] = [
      { category: 'force-push', reason: 'custom reason', snippet: 'custom snippet' },
    ]
    const customDetector: HighRiskDetector = { detect: () => customHits }
    const hook = createPermissionHook({ detector: customDetector })
    const out = await hook.callback(bashCmd('echo hello'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('custom reason')
  })

  it('default-denies when custom detector throws', async () => {
    const crashingDetector: HighRiskDetector = {
      detect: () => {
        throw new Error('boom')
      },
    }
    const hook = createPermissionHook({ detector: crashingDetector })
    const out = await hook.callback(bashCmd('ls'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain('boom')
  })
})

describe('PermissionHook (custom prompter)', () => {
  it('invokes prompter.ask on high-risk hit', async () => {
    const askSpy = vi.fn()
    const prompter: PermissionPrompter = { ask: askSpy }
    const hook = createPermissionHook({ prompter })
    await hook.callback(bashCmd('git push --force origin main'), 'tu-1', {
      signal: new AbortController().signal,
    })
    expect(askSpy).toHaveBeenCalledOnce()
    const arg = askSpy.mock.calls[0]?.[0] as { toolName: string; hits: ReadonlyArray<RiskHit> }
    expect(arg.toolName).toBe('Bash')
    expect(arg.hits.length).toBeGreaterThanOrEqual(2)
    expect(arg.hits.some((h) => h.category === 'force-push')).toBe(true)
    expect(arg.hits.some((h) => h.category === 'push-to-main')).toBe(true)
  })

  it('does not invoke prompter on clean input', async () => {
    const askSpy = vi.fn()
    const prompter: PermissionPrompter = { ask: askSpy }
    const hook = createPermissionHook({ prompter })
    await hook.callback(bashCmd('ls -la'), 'tu-1', { signal: new AbortController().signal })
    expect(askSpy).not.toHaveBeenCalled()
  })
})

describe('PermissionHook (SSE prompter)', () => {
  it('publishes permission_request to SseHub on hit', async () => {
    const hub: SseHub = createSseHub()
    const events: SseEvent[] = []
    hub.subscribe('r-1', (e) => events.push(e))
    const hook = createPermissionHook({
      hub,
      getReqId: () => 'r-1',
      getSessionId: () => 'sess-1',
    })
    await hook.callback(bashCmd('git push --force origin main'), 'tu-1', {
      signal: new AbortController().signal,
    })
    const req = events.find((e) => e.type === 'permission_request')
    expect(req).toBeDefined()
    if (req && req.type === 'permission_request') {
      expect(req.reqId).toBe('r-1')
      expect(req.sessionId).toBe('sess-1')
      expect(req.toolName).toBe('Bash')
      expect(req.hits.length).toBeGreaterThan(0)
    }
    await hub.close()
  })

  it('does not publish on clean input', async () => {
    const hub: SseHub = createSseHub()
    const events: SseEvent[] = []
    hub.subscribe('r-1', (e) => events.push(e))
    const hook = createPermissionHook({
      hub,
      getReqId: () => 'r-1',
      getSessionId: () => 'sess-1',
    })
    await hook.callback(bashCmd('ls'), 'tu-1', { signal: new AbortController().signal })
    expect(events.find((e) => e.type === 'permission_request')).toBeUndefined()
    await hub.close()
  })
})