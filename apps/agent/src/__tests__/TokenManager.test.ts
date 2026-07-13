import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TokenManager } from '../auth/TokenManager.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-tok-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('TokenManager.ensure', () => {
  // Windows 上 fs.chmod 是 no-op,POSIX 权限位断言必然失败 —— 跳到 Linux/macOS CI 覆盖
  it.skipIf(process.platform === 'win32')('creates a 43-char base64url token file with mode 0600 on first call', async () => {
    const tm = new TokenManager(root)
    const token = await tm.ensure()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const p = join(root, '.agent-token')
    expect(existsSync(p)).toBe(true)
    const stat = statSync(p)
    expect(stat.mode & 0o777).toBe(0o600)
    const contents = readFileSync(p, 'utf8')
    expect(contents).toBe(token)
  })

  it('returns existing token without overwriting on second call', async () => {
    const tm = new TokenManager(root)
    const t1 = await tm.ensure()
    const t2 = await tm.ensure()
    expect(t1).toBe(t2)
  })

  it('does not overwrite an externally-set token file', async () => {
    const p = join(root, '.agent-token')
    writeFileSync(p, 'preexisting-token-1234567890123456789012345', { mode: 0o600 })
    const tm = new TokenManager(root)
    const t = await tm.ensure()
    expect(t).toBe('preexisting-token-1234567890123456789012345')
  })

  it('warns (does not throw) when file exists with mode 0666', async () => {
    const p = join(root, '.agent-token')
    writeFileSync(p, 'preexisting-token-1234567890123456789012345', { mode: 0o666 })
    const tm = new TokenManager(root)
    await expect(tm.ensure()).resolves.toBe('preexisting-token-1234567890123456789012345')
  })
})

describe('TokenManager.get', () => {
  it('throws if ensure has not been called', () => {
    const tm = new TokenManager(root)
    expect(() => tm.get()).toThrow(/token not initialised/i)
  })

  it('returns cached token after ensure', async () => {
    const tm = new TokenManager(root)
    const t = await tm.ensure()
    expect(tm.get()).toBe(t)
  })
})