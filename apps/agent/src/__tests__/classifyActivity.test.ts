/**
 * classifyStreamKind tests —— ADR-0010 Q10.3 + 决策 43b 活动流折叠
 *
 * 验证 AIEvent → StreamKind 映射与决策 49 的 UI 边界一致:
 *  - chat:用户能读的对话内容(text/thinking)→ 直接显示在 chat 主气泡
 *  - activity:AI 内部操作(tool_use/tool_result/file_written/permission_request)
 *    → 折叠在 assistant 气泡下,12px 灰字 1 行 + hover 展开 3 行
 *  - lifecycle:控制流(error/done/retrying)→ 驱动 StatusBar 状态色码 + 计数器
 */

import { describe, it, expect } from 'vitest'
import { classifyStreamKind } from '../sse/classifyActivity.js'

describe('classifyStreamKind', () => {
  it('text → chat', () => {
    expect(classifyStreamKind({ type: 'text', text: 'hello' })).toBe('chat')
    expect(classifyStreamKind({ type: 'text', text: 'delta', delta: true })).toBe('chat')
  })

  it('thinking → chat', () => {
    expect(classifyStreamKind({ type: 'thinking', text: 'pondering' })).toBe('chat')
  })

  it('tool_use → activity', () => {
    expect(classifyStreamKind({ type: 'tool_use', name: 'Read', input: { path: '/x' } })).toBe('activity')
    expect(classifyStreamKind({ type: 'tool_use', name: 'Bash', input: { cmd: 'ls' } })).toBe('activity')
  })

  it('tool_result → activity', () => {
    expect(classifyStreamKind({ type: 'tool_result', name: 'Read', output: 'ok' })).toBe('activity')
  })

  it('file_written → activity', () => {
    expect(classifyStreamKind({ type: 'file_written', path: '/x', lines: 10 })).toBe('activity')
  })

  it('permission_request → activity', () => {
    expect(classifyStreamKind({ type: 'permission_request', tool: 'Bash', input: {} })).toBe('activity')
  })

  it('error → lifecycle (drives StatusBar red color)', () => {
    expect(classifyStreamKind({ type: 'error', code: 'x', message: 'y', recoverable: false })).toBe(
      'lifecycle',
    )
    expect(
      classifyStreamKind({
        type: 'error',
        code: 'x',
        message: 'y',
        recoverable: false,
        category: 'A',
      }),
    ).toBe('lifecycle')
  })

  it('done → lifecycle (drives StatusBar idle reset)', () => {
    expect(classifyStreamKind({ type: 'done', reason: 'end_turn' })).toBe('lifecycle')
    expect(classifyStreamKind({ type: 'done', reason: 'cancelled' })).toBe('lifecycle')
    expect(classifyStreamKind({ type: 'done', reason: 'error' })).toBe('lifecycle')
    expect(classifyStreamKind({ type: 'done', reason: 'max_tokens' })).toBe('lifecycle')
  })

  it('retrying → lifecycle (drives 「重试中 N/M」 indicator)', () => {
    expect(
      classifyStreamKind({
        type: 'retrying',
        category: 'A',
        retry: 1,
        maxRetries: 3,
        delayMs: 1000,
        message: 'r',
      }),
    ).toBe('lifecycle')
  })

  it('全部分类无遗漏(decision 49 chat/activity/lifecycle 三栏收口)', () => {
    const allTypes = [
      'text',
      'thinking',
      'tool_use',
      'tool_result',
      'file_written',
      'permission_request',
      'error',
      'done',
      'retrying',
    ] as const
    for (const type of allTypes) {
      // 每个 type 都必须被映射到 chat/activity/lifecycle 之一
      const kind = classifyStreamKind({ type, ...rest(type) } as never)
      expect(['chat', 'activity', 'lifecycle']).toContain(kind)
    }
  })
})

/** 给全分类测试构造 dummy event payload 的辅助 —— 补齐必填字段即可 */
function rest(type: string): Record<string, unknown> {
  switch (type) {
    case 'text':
      return { text: '' }
    case 'thinking':
      return { text: '' }
    case 'tool_use':
      return { name: 'X', input: null }
    case 'tool_result':
      return { name: 'X', output: null }
    case 'file_written':
      return { path: '', lines: 0 }
    case 'permission_request':
      return { tool: 'X', input: null }
    case 'error':
      return { code: 'x', message: 'y', recoverable: false }
    case 'done':
      return { reason: 'end_turn' }
    case 'retrying':
      return { category: 'A', retry: null, maxRetries: null, delayMs: null, message: '' }
    default:
      return {}
  }
}