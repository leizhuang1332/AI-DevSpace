/**
 * ADR-0037 D3 / D5: POST /api/workspace/validate-path + PATCH /api/workspace/config 强制校验
 *
 * 7 case:
 *  1. validate-path: 路径不存在 → 400 E_WS_ROOT_PATH_NOT_EXISTS
 *  2. validate-path: 路径存在但空目录 → 400 E_WS_ROOT_PATH_NOT_WORKSPACE
 *  3. validate-path: 路径含 requirements/ → 200 {exists, isWorkspace}, 无 errorCode
 *  4. validate-path: 路径含 skills/ (超集定义) → 200, isWorkspace=true
 *  5. PATCH workspaceRoot = 不存在路径 → 400 E_WS_ROOT_PATH_NOT_EXISTS(不写 config.yaml)
 *  6. PATCH workspaceRoot = 空目录 → 400 E_WS_ROOT_PATH_NOT_WORKSPACE(不写 config.yaml)
 *  7. PATCH workspaceRoot = 合法 workspace → 200 {ok, config.workspaceRoot 持久化}
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import { buildServer } from '../server.js'

let tmpRoot: string
let app: Awaited<ReturnType<typeof buildServer>>
let token: string

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-ws-validate-'))
  process.env.AIDEVSPACE_HOME = tmpRoot
  app = await buildServer({
    configDir: tmpRoot,
    dataRoot: tmpRoot,
    provider: undefined,
    git: undefined,
  })
  await app.ready()
  token = readFileSync(join(tmpRoot, '.agent-token'), 'utf8')
})

afterEach(async () => {
  delete process.env.AIDEVSPACE_HOME
  if (app) await app.close()
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token }
}

// ---------------------------------------------------------------------------
// POST /api/workspace/validate-path (4 case)
// ---------------------------------------------------------------------------

describe('POST /api/workspace/validate-path', () => {
  it('case 1: 路径不存在 → 400 E_WS_ROOT_PATH_NOT_EXISTS', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspace/validate-path',
      headers: authHeaders(),
      payload: { path: '/no-such-aidevspace-path-zzz-9876' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as Record<string, unknown>
    expect(body.error).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    expect(body.exists).toBe(false)
    expect(body.isWorkspace).toBe(false)
    expect(typeof body.message).toBe('string')
  })

  it('case 2: 路径存在但空目录(无 workspace 痕迹) → 400 E_WS_ROOT_PATH_NOT_WORKSPACE', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'aidev-empty-'))
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/workspace/validate-path',
        headers: authHeaders(),
        payload: { path: emptyDir },
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as Record<string, unknown>
      expect(body.error).toBe('E_WS_ROOT_PATH_NOT_WORKSPACE')
      expect(body.exists).toBe(true)
      expect(body.isWorkspace).toBe(false)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('case 3: 路径含 requirements/ → 200 {exists:true, isWorkspace:true}, 无 errorCode', async () => {
    const validDir = mkdtempSync(join(tmpdir(), 'aidev-valid-'))
    try {
      mkdirSync(join(validDir, 'requirements'), { recursive: true })
      const res = await app.inject({
        method: 'POST',
        url: '/api/workspace/validate-path',
        headers: authHeaders(),
        payload: { path: validDir },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body.exists).toBe(true)
      expect(body.isWorkspace).toBe(true)
      expect(body.error).toBeUndefined()
    } finally {
      rmSync(validDir, { recursive: true, force: true })
    }
  })

  it('case 4: 路径仅含 skills/ (超集定义: 任一痕迹即视为 workspace) → 200 isWorkspace=true', async () => {
    const validDir = mkdtempSync(join(tmpdir(), 'aidev-skills-'))
    try {
      mkdirSync(join(validDir, 'skills'), { recursive: true })
      const res = await app.inject({
        method: 'POST',
        url: '/api/workspace/validate-path',
        headers: authHeaders(),
        payload: { path: validDir },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as Record<string, unknown>
      expect(body.isWorkspace).toBe(true)
      expect(body.error).toBeUndefined()
    } finally {
      rmSync(validDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/workspace/config 强制校验 (3 case)
// ---------------------------------------------------------------------------

describe('PATCH /api/workspace/config - workspaceRoot 强制校验', () => {
  it('case 5: workspaceRoot = 不存在路径 → 400 E_WS_ROOT_PATH_NOT_EXISTS(config.yaml 不被改)', async () => {
    const before = existsSync(join(tmpRoot, 'config.yaml'))
      ? readFileSync(join(tmpRoot, 'config.yaml'), 'utf8')
      : ''

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/workspace/config',
      headers: authHeaders(),
      payload: { workspaceRoot: '/no-such-aidevspace-aaa-bbb-9999' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as Record<string, unknown>
    expect(body.error).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    expect(body.exists).toBe(false)

    // 校验失败时不应写入 config.yaml
    const after = existsSync(join(tmpRoot, 'config.yaml'))
      ? readFileSync(join(tmpRoot, 'config.yaml'), 'utf8')
      : ''
    expect(after).toBe(before)
  })

  it('case 6: workspaceRoot = 空目录(无 workspace 痕迹) → 400 E_WS_ROOT_PATH_NOT_WORKSPACE', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'aidev-empty-patch-'))
    try {
      const before = existsSync(join(tmpRoot, 'config.yaml'))
        ? readFileSync(join(tmpRoot, 'config.yaml'), 'utf8')
        : ''

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/workspace/config',
        headers: authHeaders(),
        payload: { workspaceRoot: emptyDir },
      })
      expect(res.statusCode).toBe(400)
      const body = res.json() as Record<string, unknown>
      expect(body.error).toBe('E_WS_ROOT_PATH_NOT_WORKSPACE')
      expect(body.exists).toBe(true)
      expect(body.isWorkspace).toBe(false)

      const after = existsSync(join(tmpRoot, 'config.yaml'))
        ? readFileSync(join(tmpRoot, 'config.yaml'), 'utf8')
        : ''
      expect(after).toBe(before)
    } finally {
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('case 7: workspaceRoot = 合法 workspace → 200 {ok, config.workspaceRoot 持久化}', async () => {
    const validDir = mkdtempSync(join(tmpdir(), 'aidev-valid-patch-'))
    try {
      mkdirSync(join(validDir, 'requirements'), { recursive: true })

      const res = await app.inject({
        method: 'PATCH',
        url: '/api/workspace/config',
        headers: authHeaders(),
        payload: { workspaceRoot: validDir },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as {
        ok: boolean
        config: { workspaceRoot: string }
      }
      expect(body.ok).toBe(true)
      expect(body.config.workspaceRoot).toBe(validDir)

      // 持久化校验:config.yaml 已写入
      const yamlText = readFileSync(join(tmpRoot, 'config.yaml'), 'utf8')
      const parsed = yaml.parse(yamlText) as { workspaceRoot?: string }
      expect(parsed.workspaceRoot).toBe(validDir)
    } finally {
      rmSync(validDir, { recursive: true, force: true })
    }
  })
})