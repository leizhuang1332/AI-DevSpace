/**
 * e2e: POST /api/requirements 真实文件落盘
 *
 * 覆盖(.scratch/new-requirement-modal/issues/04 验收):
 * - 真实 fs 落盘:meta.yaml + requirement.md 写入正确
 * - 自增 ID:连发 3 次 NNN=001/002/003
 * - 鉴权 401:无 token
 * - 端到端 fetch:模拟 ticket 01 弹层 submit → fs 真实创建
 *
 * 设计:
 * - 用 buildServer 启一个真实 server(端口 0);沿用 repos-attach.e2e 模式
 * - 通过 HTTP fetch 调 POST,断言文件系统状态
 * - 跨平台:跳过 Windows(pino + temp dir 竞态,见 agent-skeleton.e2e.test.ts)
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    await fn()
  }
})

interface BootResult {
  url: string
  root: string
  token: string
}

async function boot(): Promise<BootResult> {
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-create-'))
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  const app = await buildServer({
    workspaceRoot: root,
    logFilePath: join(root, 'agent.log'),
  })
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  cleanups.push(async () => {
    try { await app.close() } catch { /* double-close */ }
    await new Promise((r) => setTimeout(r, 30))
    try { rmSync(root, { recursive: true, force: true }) } catch { /* pino still flushing */ }
  })
  const token = readFileSync(join(root, '.agent-token'), 'utf8')
  return { url, root, token }
}

describe.skipIf(process.platform === 'win32')('POST /api/requirements — 真实文件落盘', () => {
  it('201 + meta.yaml + requirement.md 真实创建', async () => {
    const { url, root, token } = await boot()

    const res = await fetch(`${url}/api/requirements`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: 'http://localhost:3333',
      },
      body: JSON.stringify({ title: '退款功能优化' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; title: string; createdAt: string }
    expect(body.id).toBe('req-001-退款功能优化')
    expect(body.title).toBe('退款功能优化')
    expect(typeof body.createdAt).toBe('string')

    // 验证文件落盘(ticket 04 验收 #14 核心)
    const reqDir = join(root, 'requirements', body.id)
    expect(existsSync(reqDir)).toBe(true)
    expect(existsSync(join(reqDir, 'meta.yaml'))).toBe(true)
    expect(existsSync(join(reqDir, 'requirement.md'))).toBe(true)

    // meta.yaml 字段 + ISO 时间戳
    const metaText = readFileSync(join(reqDir, 'meta.yaml'), 'utf8')
    expect(metaText).toContain(`id: ${body.id}`)
    expect(metaText).toContain(`title: 退款功能优化`)
    expect(metaText).toContain(`createdAt: ${body.createdAt}`)

    // requirement.md 含 # title + DRAFTING 提示
    const reqText = readFileSync(join(reqDir, 'requirement.md'), 'utf8')
    expect(reqText).toContain('# 退款功能优化')
    expect(reqText).toContain('DRAFTING')
  }, 15_000)

  it('自增 ID:连发 3 次 → NNN=001/002/003', async () => {
    const { url, root, token } = await boot()

    const ids: string[] = []
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(`${url}/api/requirements`, {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: `需求 ${i}` }),
      })
      expect(res.status).toBe(201)
      const body = (await res.json()) as { id: string }
      ids.push(body.id)
    }
    expect(ids).toEqual(['req-001-需求-1', 'req-002-需求-2', 'req-003-需求-3'])

    // 三个目录都建了
    for (const id of ids) {
      expect(existsSync(join(root, 'requirements', id))).toBe(true)
    }
  }, 15_000)

  it('鉴权 401:无 token', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    })
    expect(res.status).toBe(401)
  }, 15_000)

  it('400 E_INVALID_TITLE:空 title', async () => {
    const { url, token } = await boot()
    const res = await fetch(`${url}/api/requirements`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: '   ' }),
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('E_INVALID_TITLE')
  }, 15_000)

  it('端到端:模拟 ticket 01 弹层 submit → fs 真实落盘', async () => {
    const { url, root, token } = await boot()
    // 这是 ticket 04 验收 #14 核心:模拟弹层提交契约 → 落盘
    const res = await fetch(`${url}/api/requirements`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: 'http://localhost:3333',
      },
      body: JSON.stringify({ title: '链式端到端测试' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string }

    // 真实 fs 落盘断言
    const reqDir = join(root, 'requirements', body.id)
    expect(existsSync(reqDir)).toBe(true)
    expect(existsSync(join(reqDir, 'meta.yaml'))).toBe(true)
    expect(existsSync(join(reqDir, 'requirement.md'))).toBe(true)
    // 不预先建 worktree(决策 4 + Q7:worktree 在 DRAFTING 首次关联时建)
    expect(existsSync(join(reqDir, 'repos'))).toBe(false)
  }, 15_000)

  it('与 POST /api/requirement/:id/repos 衔接:先 create 再 attach worktree', async () => {
    const { url, root, token } = await boot()

    // step 1: create
    const createRes = await fetch(`${url}/api/requirements`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: '衔接测试' }),
    })
    expect(createRes.status).toBe(201)
    const { id } = (await createRes.json()) as { id: string }

    // step 2: 准备 pool repo(让 /repos 走真实 fs + git)
    const { execFile: _execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const execFileP = promisify(_execFile)
    const repoDir = join(root, 'repos', 'shared-svc')
    mkdirSync(repoDir, { recursive: true })
    await execFileP('git', ['-C', repoDir, 'init', '-q', '-b', 'master'])
    await execFileP('git', ['-C', repoDir, 'config', 'user.email', 'test@aidevspace'])
    await execFileP('git', ['-C', repoDir, 'config', 'user.name', 'Test'])
    await execFileP('git', ['-C', repoDir, 'commit', '--allow-empty', '-q', '-m', 'init'])
    void _execFile

    // step 3: attach repo to created req
    const attachRes = await fetch(`${url}/api/requirement/${id}/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['shared-svc'],
        branchName: 'feat/chain',
      }),
    })
    expect(attachRes.status).toBe(200)
    const attachBody = (await attachRes.json()) as {
      results: Array<{ ok: boolean; worktreePath: string }>
    }
    expect(attachBody.results[0].ok).toBe(true)
    expect(attachBody.results[0].worktreePath).toBe(
      join(root, 'requirements', id, 'repos', 'shared-svc'),
    )
    expect(existsSync(attachBody.results[0].worktreePath)).toBe(true)
  }, 20_000)
})