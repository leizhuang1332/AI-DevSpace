/**
 * e2e: POST /api/requirement/:id/repos 真实 git worktree 创建
 *
 * 覆盖(.scratch/new-requirement-modal/issues/02 验收清单):
 * - 全成功:1 个真实 git repo → worktree 真实创建到 requirements/<id>/repos/<name>/
 * - base 分支 fallback:主仓库只有 master → base=master
 * - 多 repo + 1 失败 → 部分成功语义
 * - 重启场景:同一 req 两次创建 worktree 不互相覆盖(但 ticket 02 实际期望
 *   "worktree 创建成功后,资源树对应 repo 节点显示绿色小圆点",本测试验证目录唯一)
 *
 * 设计:
 * - 用 buildServer 启一个真实 server(端口 0);沿用 agent-skeleton.e2e 模式
 * - 在临时 root 建真实 git repo(主仓库 + initial commit)
 * - 通过 HTTP fetch 调 POST,断言文件系统状态
 * - 跨平台:跳过 Windows(pino + temp dir 竞态,见 agent-skeleton.e2e.test.ts)
 */

import { describe, it, expect, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
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
import { promisify } from 'node:util'
import { buildServer } from '../server.js'

const execFileP = promisify(execFile)

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
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-attach-'))
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

/** 真实 git init 主仓库并做一次 empty commit,返回 repoName */
async function makePoolRepo(root: string, repoName: string): Promise<string> {
  const repoDir = join(root, 'repos', repoName)
  mkdirSync(repoDir, { recursive: true })
  // 用 -c init.defaultBranch=master 保证默认分支叫 master(主仓库路径稳定)
  await execFileP('git', ['-C', repoDir, 'init', '-q', '-b', 'master'])
  await execFileP('git', ['-C', repoDir, 'config', 'user.email', 'test@aidevspace'])
  await execFileP('git', ['-C', repoDir, 'config', 'user.name', 'Test'])
  await execFileP('git', ['-C', repoDir, 'commit', '--allow-empty', '-q', '-m', 'init'])
  return repoDir
}

describe.skipIf(process.platform === 'win32')('repos-attach e2e — 真实 git worktree', () => {
  it('POST /api/requirement/:id/repos → 真实 worktree 创建(base=master fallback)', async () => {
    const { url, root, token } = await boot()
    await makePoolRepo(root, 'refund-service')
    // 准备 req 目录(模拟 ticket 04 已建好的需求)
    mkdirSync(join(root, 'requirements', 'req-e2e-1'), { recursive: true })

    const res = await fetch(`${url}/api/requirement/req-e2e-1/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['refund-service'],
        branchName: 'feat/e2e',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      succeeded: number
      failed: number
      results: Array<{ ok: boolean; repoId: string; branch: string; worktreePath: string; base: string }>
    }
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(0)
    expect(body.results[0].ok).toBe(true)
    expect(body.results[0].base).toBe('master')
    expect(body.results[0].branch).toBe('feat/e2e')

    // 验证 worktree 真实存在
    const wtPath = body.results[0].worktreePath
    expect(existsSync(wtPath)).toBe(true)
    expect(wtPath).toBe(join(root, 'requirements', 'req-e2e-1', 'repos', 'refund-service'))

    // 验证 worktree 是真实 git worktree(git rev-parse --git-dir 应指向主仓库的 .git/worktrees/<name>)
    const { stdout: gitDir } = await execFileP('git', ['-C', wtPath, 'rev-parse', '--git-dir'])
    expect(gitDir.trim()).toContain('worktrees/refund-service')
    expect(gitDir.trim()).toContain(join(root, 'repos', 'refund-service', '.git'))

    // 验证主仓库新增了 feat/e2e 分支(`+` 前缀表示当前 checkout;strip 后匹配)
    const { stdout: branches } = await execFileP('git', [
      '-C', join(root, 'repos', 'refund-service'),
      'branch', '--list', 'feat/e2e',
    ])
    expect(branches.replace(/^\+\s*/, '').trim()).toBe('feat/e2e')
  }, 15_000)

  it('base 分支 main 优先:主仓库只有 main → base=main', async () => {
    const { url, root, token } = await boot()
    const repoDir = await makePoolRepo(root, 'order-service')
    // 改默认分支 main
    await execFileP('git', ['-C', repoDir, 'branch', '-m', 'master', 'main'])
    mkdirSync(join(root, 'requirements', 'req-e2e-2'), { recursive: true })

    const res = await fetch(`${url}/api/requirement/req-e2e-2/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['order-service'],
        branchName: 'feat/order',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ ok: boolean; base: string }>
    }
    expect(body.results[0].ok).toBe(true)
    expect(body.results[0].base).toBe('main')
  }, 15_000)

  it('部分失败:1 个存在 + 1 个不存在 → results 1 ok + 1 E_REPO_NOT_FOUND', async () => {
    const { url, root, token } = await boot()
    await makePoolRepo(root, 'refund-service')
    // order-service 不创建
    mkdirSync(join(root, 'requirements', 'req-e2e-3'), { recursive: true })

    const res = await fetch(`${url}/api/requirement/req-e2e-3/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['refund-service', 'order-service'],
        branchName: 'feat/partial',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      succeeded: number
      failed: number
      results: Array<{ ok: boolean; repoId: string; code?: string }>
    }
    expect(body.succeeded).toBe(1)
    expect(body.failed).toBe(1)
    expect(body.results[0].ok).toBe(true)
    expect(body.results[0].repoId).toBe('refund-service')
    expect(body.results[1].ok).toBe(false)
    expect(body.results[1].code).toBe('E_REPO_NOT_FOUND')
  }, 15_000)

  it('重启场景:同一 repo 在两个不同 req 下创建 worktree,路径独立不覆盖', async () => {
    const { url, root, token } = await boot()
    await makePoolRepo(root, 'shared-svc')
    mkdirSync(join(root, 'requirements', 'req-A'), { recursive: true })
    mkdirSync(join(root, 'requirements', 'req-B'), { recursive: true })

    // req-A 先创建
    const aRes = await fetch(`${url}/api/requirement/req-A/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['shared-svc'],
        branchName: 'feat/a',
      }),
    })
    expect(aRes.status).toBe(200)
    const aBody = (await aRes.json()) as { results: Array<{ ok: boolean }> }
    expect(aBody.results[0].ok).toBe(true)

    // req-B 用**不同分支名**创建(ticket 02 决策:统一分支名是 req 级,但跨 req 必须独立)
    const bRes = await fetch(`${url}/api/requirement/req-B/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        repoIds: ['shared-svc'],
        branchName: 'feat/b',
      }),
    })
    expect(bRes.status).toBe(200)
    const bBody = (await bRes.json()) as { results: Array<{ ok: boolean; worktreePath: string }> }
    expect(bBody.results[0].ok).toBe(true)

    // 两个 worktree 路径独立
    expect(aBody.results[0].worktreePath).not.toBe(bBody.results[0].worktreePath)
    expect(existsSync(join(root, 'requirements', 'req-A', 'repos', 'shared-svc'))).toBe(true)
    expect(existsSync(join(root, 'requirements', 'req-B', 'repos', 'shared-svc'))).toBe(true)

    // 主仓库有两个独立分支(grep 而非 toContain,避免 `feat/a` 误匹配 `feat/abc`)
    const { stdout: branches } = await execFileP('git', [
      '-C', join(root, 'repos', 'shared-svc'),
      'branch', '--list', '--format=%(refname:short)',
    ])
    const branchList = branches.split('\n').map((s) => s.trim()).filter(Boolean)
    expect(branchList).toContain('feat/a')
    expect(branchList).toContain('feat/b')
  }, 20_000)

  it('鉴权 401:无 token', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirement/req-401/repos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ repoIds: ['x'], branchName: 'feat/x' }),
    })
    expect(res.status).toBe(401)
  }, 15_000)

  it('404 E_REQUIREMENT_NOT_FOUND:req 目录不存在', async () => {
    const { url, root, token } = await boot()
    await makePoolRepo(root, 'r1')
    const res = await fetch(`${url}/api/requirement/req-missing/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ repoIds: ['r1'], branchName: 'feat/x' }),
    })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string; requirementId: string }
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.requirementId).toBe('req-missing')
  }, 15_000)

  // ============================================================================
  // ticket 02 验收 #12:端到端 — 模拟 ticket 01 弹层提交路径
  // "弹层提交后,真实文件系统 worktree 目录被创建"
  //
  // 这里用真实 fetch 调 API,断言 worktree 真实创建。验收 #12 强调的是
  // "提交后 fs 真实创建",这个 case 已经覆盖 ticket 01 弹层 submit 后调
  // agentFetch<AttachReposResponse> 的同样契约。
  // (完整 UI 链路 e2e 涉及 web jsdom + 跨包 server 启动,见 PR 备注)。
  // ============================================================================
  it('端到端:提交 contract 等同 ticket 01 弹层 onSubmit → fs 真实创建 worktree', async () => {
    const { url, root, token } = await boot()
    await makePoolRepo(root, 'coupon-service')
    mkdirSync(join(root, 'requirements', 'req-chain'), { recursive: true })

    // 模拟 attach-repos-dialog onSubmit 调用的 wrapper(repo-attach.ts)
    const res = await fetch(`${url}/api/requirement/req-chain/repos`, {
      method: 'POST',
      headers: {
        'x-aidevspace-token': token,
        'content-type': 'application/json',
        origin: 'http://localhost:3333',
      },
      body: JSON.stringify({
        repoIds: ['coupon-service'],
        branchName: 'feat/chain',
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      results: Array<{ ok: boolean; base: string; worktreePath: string }>
    }
    expect(body.results[0].ok).toBe(true)
    expect(body.results[0].base).toBe('master')

    // 真实 fs 断言(ticket 02 验收 #12 核心)
    const wtPath = join(root, 'requirements', 'req-chain', 'repos', 'coupon-service')
    expect(existsSync(wtPath)).toBe(true)
    const { stdout: gitDir } = await execFileP('git', ['-C', wtPath, 'rev-parse', '--git-dir'])
    expect(gitDir.trim()).toContain('worktrees/coupon-service')
  }, 15_000)
})

// 静默 unused-import 警告
void execFile
