import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, CONFIG_KEYS } from '../config-defaults.js'

describe('DEFAULT_CONFIG', () => {
  it('包含 6 个预期 key', () => {
    expect(CONFIG_KEYS).toEqual([
      'theme',
      'typewriterSpeed',
      'silentWindowSeconds',
      'agentEndpoint',
      'workspaceRoot',
      'ai.provider',
    ])
  })

  it('theme 默认值为 system', () => {
    expect(DEFAULT_CONFIG.theme).toBe('system')
  })

  it('typewriterSpeed 默认值为 medium', () => {
    expect(DEFAULT_CONFIG.typewriterSpeed).toBe('medium')
  })

  it('silentWindowSeconds 默认值为 30', () => {
    expect(DEFAULT_CONFIG.silentWindowSeconds).toBe(30)
  })

  it('agentEndpoint 默认值为 http://localhost:7777', () => {
    expect(DEFAULT_CONFIG.agentEndpoint).toBe('http://localhost:7777')
  })

  it('workspaceRoot 默认值为空字符串', () => {
    expect(DEFAULT_CONFIG.workspaceRoot).toBe('')
  })

  it('ai.provider 默认值为 claude-code', () => {
    expect(DEFAULT_CONFIG['ai.provider']).toBe('claude-code')
  })

  it('所有 DEFAULT_CONFIG 的 key 都在 CONFIG_KEYS 里', () => {
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      expect(CONFIG_KEYS).toContain(k)
    }
  })
})
