/**
 * CcSwitchClient tests —— ADR-0010 Q9
 *
 * 覆盖:
 *  - 解析 settings_config.env 字段
 *  - getCurrent / getAll / getById / getModel 行为
 *  - 容错:settings_config 坏 JSON → 不让单条数据坏掉整个 index
 *  - factory 注入:不依赖真实 sqlite3
 */

import { describe, it, expect, vi } from 'vitest'
import { createCcSwitchClient, type DatabaseFactory } from '../providers/CcSwitchClient.js'

/** 模拟 better-sqlite3 Database:只暴露 .prepare() 返回的 stub */
interface FakeDb {
  prepare: (sql: string) => {
    all: () => unknown[]
  }
  close: () => void
}

function makeFakeDb(rows: Array<{ id: string; name: string; is_current: number; settings_config: string }>): FakeDb {
  return {
    prepare: () => ({ all: () => rows }),
    close: () => {},
  }
}

function makeFactory(db: FakeDb): DatabaseFactory {
  return (() => db as never) as DatabaseFactory
}

describe('createCcSwitchClient', () => {
  it('parses settings_config.env and exposes getAll()', async () => {
    const fakeDb = makeFakeDb([
      {
        id: 'p-1',
        name: 'MiniMax',
        is_current: 1,
        settings_config: JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
            ANTHROPIC_AUTH_TOKEN: 'sk-test-123',
            ANTHROPIC_MODEL: 'MiniMax-M3',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'MiniMax-M3[1M]',
          },
        }),
      },
    ])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    const all = client.getAll()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: 'p-1',
      name: 'MiniMax',
      is_current: true,
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-test-123',
      models: {
        main: 'MiniMax-M3',
        sonnet: 'MiniMax-M3[1M]',
        haiku: null,
        opus: null,
        fable: null,
        reasoning: null,
      },
    })
  })

  it('getCurrent() returns the provider with is_current=1', async () => {
    const fakeDb = makeFakeDb([
      { id: 'p-1', name: 'A', is_current: 0, settings_config: JSON.stringify({ env: {} }) },
      { id: 'p-2', name: 'B', is_current: 1, settings_config: JSON.stringify({ env: {} }) },
    ])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    expect(client.getCurrent()?.id).toBe('p-2')
    expect(client.getCurrent()?.name).toBe('B')
  })

  it('getById() returns the matching provider or undefined', async () => {
    const fakeDb = makeFakeDb([
      { id: 'p-1', name: 'A', is_current: 1, settings_config: JSON.stringify({ env: {} }) },
      { id: 'p-2', name: 'B', is_current: 0, settings_config: JSON.stringify({ env: {} }) },
    ])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    expect(client.getById('p-2')?.name).toBe('B')
    expect(client.getById('nope')).toBeUndefined()
  })

  it('getModel() resolves (providerId, role) → model id', async () => {
    const fakeDb = makeFakeDb([
      {
        id: 'p-1',
        name: 'MiniMax',
        is_current: 1,
        settings_config: JSON.stringify({
          env: {
            ANTHROPIC_MODEL: 'MiniMax-M3',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'MiniMax-M3-haiku',
          },
        }),
      },
    ])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    expect(client.getModel('p-1', 'main')).toEqual({
      providerId: 'p-1',
      providerName: 'MiniMax',
      role: 'main',
      modelId: 'MiniMax-M3',
    })
    expect(client.getModel('p-1', 'haiku')?.modelId).toBe('MiniMax-M3-haiku')
    expect(client.getModel('p-1', 'sonnet')).toBeUndefined()
    expect(client.getModel('nope', 'main')).toBeUndefined()
  })

  it('survives bad settings_config JSON without breaking the whole index', async () => {
    const fakeDb = makeFakeDb([
      { id: 'p-bad', name: 'BAD', is_current: 0, settings_config: 'this is not json{' },
      { id: 'p-good', name: 'GOOD', is_current: 1, settings_config: JSON.stringify({ env: { ANTHROPIC_MODEL: 'm' } }) },
    ])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    const all = client.getAll()
    expect(all).toHaveLength(2)
    expect(all.find((p) => p.id === 'p-bad')?.baseUrl).toBe('')
    expect(all.find((p) => p.id === 'p-good')?.models.main).toBe('m')
  })

  it('handles empty providers table gracefully', async () => {
    const fakeDb = makeFakeDb([])
    const client = await createCcSwitchClient({ factory: makeFactory(fakeDb), log: () => {} })
    expect(client.getAll()).toHaveLength(0)
    expect(client.getCurrent()).toBeUndefined()
  })

  it('logs current provider on init', async () => {
    const fakeDb = makeFakeDb([
      {
        id: 'p-1',
        name: 'MiniMax',
        is_current: 1,
        settings_config: JSON.stringify({
          env: { ANTHROPIC_MODEL: 'MiniMax-M3', ANTHROPIC_BASE_URL: 'http://x' },
        }),
      },
    ])
    const log = vi.fn()
    await createCcSwitchClient({ factory: makeFactory(fakeDb), log })
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[cc-switch\] reading /))
    expect(log).toHaveBeenCalledWith('[cc-switch] current provider: MiniMax')
    expect(log).toHaveBeenCalledWith('[cc-switch] baseUrl: http://x')
    expect(log).toHaveBeenCalledWith('[cc-switch] models:')
    expect(log).toHaveBeenCalledWith('  main       → MiniMax-M3')
  })

  it('close() closes the underlying db handle', async () => {
    const closeSpy = vi.fn()
    const db: FakeDb = {
      prepare: () => ({ all: () => [] }),
      close: closeSpy,
    }
    const client = await createCcSwitchClient({ factory: makeFactory(db), log: () => {} })
    client.close()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })
})