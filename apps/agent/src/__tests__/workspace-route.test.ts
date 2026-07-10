import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'

let tmpRoot: string
let app: Awaited<ReturnType<typeof buildServer>>

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-routes-'))
  process.env.AIDEVSPACE_HOME = tmpRoot
  app = await buildServer()
  await app.ready()
})

afterEach(async () => {
  delete process.env.AIDEVSPACE_HOME
  if (app) await app.close()
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

describe('slice 14: server boot init', () => {
  it('buildServer 后根目录已被初始化', async () => {
    expect(existsSync(tmpRoot)).toBe(true)
    expect(existsSync(join(tmpRoot, 'requirements'))).toBe(true)
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'config.yaml'))).toBe(true)
  })
})

describe('slice 12: GET /api/workspace', () => {
  it('返回 200 + 完整 WorkspaceInfo', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspace' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.root).toBe(tmpRoot)
    expect(body.exists).toBe(true)
    expect(body.subdirs.requirements).toBe(true)
    expect(body.subdirs.repos).toBe(true)
    expect(body.configPath).toBe(join(tmpRoot, 'config.yaml'))
    expect(body.config.workspaceRoot).toBe(tmpRoot)
  })
})

describe('slice 13: PATCH /api/workspace/config', () => {
  it('接受部分 patch，返回 200 + 合并后 config', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/workspace/config',
      payload: { theme: 'dark', silentWindowSeconds: 60 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.config.theme).toBe('dark')
    expect(body.config.silentWindowSeconds).toBe(60)
    // 未提及的字段保留
    expect(body.config.typewriterSpeed).toBe('medium')
  })

  it('非法 patch 返回 400 + ZodIssue details', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/workspace/config',
      payload: { theme: { nested: 'object' } }, // 非法值
    })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.error).toBe('invalid_patch')
    expect(Array.isArray(body.details)).toBe(true)
  })

  it('空 patch 返回 200（不修改）', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/workspace/config',
      payload: {},
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('slice 14 (补): /api/workspace/open + uninstall 占位端点（返回 501）', () => {
  it('POST /api/workspace/open 返回 501 not_implemented', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspace/open',
      payload: {},
    })
    expect(res.statusCode).toBe(501)
    expect(res.json()).toMatchObject({ error: 'not_implemented' })
  })

  it('POST /api/workspace/uninstall 返回 501 not_implemented', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspace/uninstall',
    })
    expect(res.statusCode).toBe(501)
    expect(res.json()).toMatchObject({ error: 'not_implemented' })
  })
})

describe('slice 14 (补): GET /api/health 增强', () => {
  it('响应含 workspaceRoot', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ok).toBe(true)
    expect(body.workspaceRoot).toBe(tmpRoot)
  })
})
