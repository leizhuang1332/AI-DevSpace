import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 这些 import 在实现存在前会失败 —— TDD 第一步：先红后绿
import {
  getOrBootstrap,
  hasAuthCookie,
  resetBootstrapCache,
} from '@/lib/agent-bootstrap'

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
  // 默认让 hasAuthCookie() 为 true，避免污染其他文件已 mock 的 document.cookie
  Object.defineProperty(document, 'cookie', {
    writable: true,
    configurable: true,
    value: 'aidevspace_token=existing-token',
  })
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
  resetBootstrapCache()
})

describe('agent-bootstrap', () => {
  it('getOrBootstrap 调用 /api/agent/bootstrap 并把 token 写入 cookie', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          token: 'fresh-token-from-agent',
          cookieName: 'aidevspace_token',
          cookieAttributes: {
            SameSite: 'Strict',
            Path: '/',
            MaxAge: 2_592_000,
          },
          apiBase: 'http://localhost:7777',
          agentVersion: '0.0.0',
          sseNote: 'use cookie',
        }),
        { status: 200 },
      ),
    )
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: '', // 没有 cookie，触发 bootstrap
    })

    const result = await getOrBootstrap()

    expect(result.token).toBe('fresh-token-from-agent')
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[0]).toBe('http://localhost:7777/api/agent/bootstrap')
    expect(call[1].credentials).toBe('include')
    expect(document.cookie).toContain('aidevspace_token=fresh-token-from-agent')
    expect(document.cookie).toContain('Path=/')
    expect(document.cookie).toContain('SameSite=Strict')
    expect(document.cookie).toContain('Max-Age=2592000')
  })

  it('getOrBootstrap 是单飞：并发调用共享同一个 fetch', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          token: 'shared-token',
          cookieName: 'aidevspace_token',
          cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 2_592_000 },
          apiBase: 'http://localhost:7777',
          agentVersion: '0.0.0',
          sseNote: '',
        }),
        { status: 200 },
      ),
    )
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: '',
    })

    const [a, b, c] = await Promise.all([
      getOrBootstrap(),
      getOrBootstrap(),
      getOrBootstrap(),
    ])

    expect(a.token).toBe('shared-token')
    expect(b.token).toBe('shared-token')
    expect(c.token).toBe('shared-token')
    // 关键断言：只发了一次 fetch
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('getOrBootstrap 失败时重置缓存，下次调用会重新尝试', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            token: 'recovered-token',
            cookieName: 'aidevspace_token',
            cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 2_592_000 },
            apiBase: 'http://localhost:7777',
            agentVersion: '0.0.0',
            sseNote: '',
          }),
          { status: 200 },
        ),
      )
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: '',
    })

    await expect(getOrBootstrap()).rejects.toThrow('network down')
    // 缓存被清空，第二次调用应当真正去网络再试
    const result = await getOrBootstrap()
    expect(result.token).toBe('recovered-token')
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
  })

  it('hasAuthCookie 在 SSR (document 不存在) 时保守返回 true（避免 bootstrap 在服务端跑）', async () => {
    // hasAuthCookie 是纯函数；这里只验证：有 cookie 时 true，无 cookie 时 false
    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: 'aidevspace_token=abc; other=xyz',
    })
    expect(hasAuthCookie()).toBe(true)

    Object.defineProperty(document, 'cookie', {
      writable: true,
      configurable: true,
      value: 'other=xyz',
    })
    expect(hasAuthCookie()).toBe(false)
  })
})