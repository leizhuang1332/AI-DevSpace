/**
 * server-agent-token helper 测试
 *
 * 验证三档优先级:
 * 1. cookie `aidevspace_token` (外部 HTTP caller / e2e set cookie)
 * 2. AIDEVSPACE_HOME/.agent-token 文件 (首次 RSC 渲染,server-to-server 共享)
 * 3. 都没有 → null
 *
 * 关键:首次 RSC 渲染时用户还没 bootstrap,cookie 一定没有,必须靠文件 fallback
 * 修掉 "ServerListRequirements 401 no_auth_cookie" 的根因。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// mock next/headers — 不引入真实 Next.js 运行时
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}))

import { cookies } from 'next/headers'
import { getServerAgentToken } from '../server-agent-token'

const mockCookies = vi.mocked(cookies)

function mockCookie(value: string | undefined) {
  mockCookies.mockReturnValue({
    get: (name: string) =>
      name === 'aidevspace_token' ? (value ? { name, value } : undefined) : undefined,
  } as unknown as ReturnType<typeof cookies>)
}

describe('getServerAgentToken', () => {
  let tmpHome: string
  let prevAidevspaceHome: string | undefined
  let prevHome: string | undefined
  let prevUserProfile: string | undefined

  beforeEach(() => {
    mockCookies.mockReset()
    tmpHome = mkdtempSync(join(tmpdir(), 'aidevspace-test-'))
    prevAidevspaceHome = process.env.AIDEVSPACE_HOME
    prevHome = process.env.HOME
    prevUserProfile = process.env.USERPROFILE
    process.env.AIDEVSPACE_HOME = tmpHome
  })

  afterEach(() => {
    if (prevAidevspaceHome === undefined) delete process.env.AIDEVSPACE_HOME
    else process.env.AIDEVSPACE_HOME = prevAidevspaceHome
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    if (prevUserProfile === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = prevUserProfile
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('cookie 存在 → 用 cookie,不看文件', () => {
    mockCookie('cookie-token')
    // 即便文件存在也不读(优先级 cookie > file)
    writeFileSync(join(tmpHome, '.agent-token'), 'file-token')

    expect(getServerAgentToken()).toBe('cookie-token')
  })

  it('cookie 不存在但文件存在 → 用文件', () => {
    mockCookie(undefined)
    writeFileSync(join(tmpHome, '.agent-token'), 'file-token')

    expect(getServerAgentToken()).toBe('file-token')
  })

  it('cookie + 文件都不存在 → 返 null(不抛)', () => {
    mockCookie(undefined)

    expect(getServerAgentToken()).toBeNull()
  })

  it('cookie 是空字符串 → 视为不存在,fallback 文件', () => {
    mockCookie('')
    writeFileSync(join(tmpHome, '.agent-token'), 'file-token')

    expect(getServerAgentToken()).toBe('file-token')
  })

  it('文件存在但内容为空 → 返 null', () => {
    mockCookie(undefined)
    writeFileSync(join(tmpHome, '.agent-token'), '   \n  ')

    expect(getServerAgentToken()).toBeNull()
  })

  it('AIDEVSPACE_HOME 未设置 → fallback 到 HOME/.aidevspace/.agent-token', () => {
    delete process.env.AIDEVSPACE_HOME
    mockCookie(undefined)

    // 把 HOME 指向仅含受控 token 的临时目录,避免测试机真实 ~/.aidevspace/.agent-token 污染
    const fakeHome = mkdtempSync(join(tmpdir(), 'fake-home-'))
    const fakeAidevspaceDir = join(fakeHome, '.aidevspace')
    mkdirSync(fakeAidevspaceDir, { recursive: true })
    writeFileSync(join(fakeAidevspaceDir, '.agent-token'), 'home-file-token')
    process.env.HOME = fakeHome
    process.env.USERPROFILE = fakeHome

    try {
      expect(getServerAgentToken()).toBe('home-file-token')
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
    }
  })

  it('HOME 和 USERPROFILE 都未设置 → 返 null', () => {
    delete process.env.AIDEVSPACE_HOME
    delete process.env.HOME
    delete process.env.USERPROFILE
    mockCookie(undefined)

    expect(getServerAgentToken()).toBeNull()
  })

  it('文件读失败(权限 / ENOENT) → 返 null,不抛', () => {
    mockCookie(undefined)
    // 不写文件 → readFileSync 会 ENOENT
    expect(getServerAgentToken()).toBeNull()
  })

  it('文件内容带尾部换行 → trim 后返', () => {
    mockCookie(undefined)
    writeFileSync(join(tmpHome, '.agent-token'), 'trailing-newline-token\n')

    expect(getServerAgentToken()).toBe('trailing-newline-token')
  })
})
