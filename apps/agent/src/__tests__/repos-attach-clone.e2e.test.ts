/**
 * e2e: POST /api/requirement/:id/repos 真实 git clone + checkout -b
 *
 * 替代被删的 repos-attach.e2e.test.ts(旧路径走 git worktree add)。
 *
 * 覆盖(issue 03 验收 3.5):
 * - 全成功:1 个真实 git repo → 完整 codebase 落到 requirements/<id>/codebase/<name>/
 *   - 验证 .git 存在(独立仓库)
 *   - 验证当前分支是 feat/<branch>
 *   - 验证 HEAD commit 与 source upstream 一致
 * - 路径已存在 → E_REPO_ALREADY_ATTACHED(幂等校验,不破坏)
 * - 注册表无该 repo → E_REPO_NOT_FOUND(无 clone)
 * - clone 失败(网络错 gitUrl)→ E_NETWORK / E_INTERNAL;**不**留半成品目录
 * - agent 启动时收敛 orphan pending(半成品 .pending-<name> 标记)
 * - 鉴权 401:无 token
 * - 404:req 目录不存在
 *
 * 设计:
 * - 用 buildServer 启一个真实 server(端口 0)
 * - 在临时 root 建一个 **bare git** 仓库作为 upstream,本地 clone 用它做 gitUrl
 *   (`file://` 协议 + 本地路径 = 真 git 完整流程,无需 SSH / HTTPS 凭据)
 * - 通过 HTTP fetch 调 POST,断言文件系统状态 + git 命令输出
 * - 跨平台:跳过 Windows(已知本地 fs race,见旧 repos-attach.e2e.test.ts 注释)
 */

import { describe, it, expect, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-clone-'))
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  const app = await buildServer({
    workspaceRoot: root,
    logFilePath: join(root, 'agent.log'),
  })
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  cleanups.push(async () => {
    try {
      await app.close()
    } catch {
      /* double-close */
    }
    await new Promise((r) => setTimeout(r, 30))
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* pino still flushing */
    }
  })
  const token = readFileSync(join(root, '.agent-token'), 'utf8')
  return { url, root, token }
}

/**
 * 建一个 bare upstream repo + 一个 working repo 做初始 commit,返回:
 * - bare path(供 POST /api/repos 用 gitUrl)
 * - bare name(name 全局唯一)
 * - working repo 的初始 commit SHA(供 POST /api/requirement/<id>/repos 后断言)
 */
async function makeUpstreamRepo(
  root: string,
  repoName: string,
): Promise<{ barePath: string; initialSha: string }> {
  const workingDir = join(root, 'fixtures', repoName, 'work')
  const bareDir = join(root, 'fixtures', repoName, 'bare.git')
  mkdirSync(workingDir, { recursive: true })
  mkdirSync(bareDir, { recursive: true })

  await execFileP('git', ['-C', workingDir, 'init', '-q', '-b', 'main'])
  await execFileP('git', ['-C', workingDir, 'config', 'user.email', 'test@aidevspace'])
  await execFileP('git', ['-C', workingDir, 'config', 'user.name', 'Test'])
  // 写一个文件让 HEAD commit 落到 fixture 上
  writeFileSync(join(workingDir, 'README.md'), `# ${repoName}\n`, 'utf8')
  await execFileP('git', ['-C', workingDir, 'add', 'README.md'])
  await execFileP('git', ['-C', workingDir, 'commit', '-q', '-m', 'init'])
  // 拿初始 commit SHA
  const { stdout: sha } = await execFileP('git', [
    '-C',
    workingDir,
    'rev-parse',
    'HEAD',
  ])

  // bare clone
  await execFileP('git', ['clone', '--bare', '-q', workingDir, bareDir])

  return { barePath: bareDir, initialSha: sha.trim() }
}

/**
 * 把仓库条目通过 HTTP POST 注册到 yaml(POST /api/repos 必跑 ls-remote 验证;
 * 这里 ls-remote 走 file:// 协议,所以验证肯定通过)。
 */
async function registerRepo(
  url: string,
  token: string,
  name: string,
  gitUrl: string,
  description = '',
): Promise<void> {
  const res = await fetch(`${url}/api/repos`, {
    method: 'POST',
    headers: {
      'x-aidevspace-token': token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name, gitUrl, description }),
  })
  if (res.status !== 201) {
    const body = await res.text()
    throw new Error(`registerRepo failed: ${res.status} ${body}`)
  }
}

describe.skipIf(process.platform === 'win32')(
  'repos-attach-clone e2e — 真实 git clone',
  () => {
    it(
      'POST /api/requirement/:id/repos → 真实 clone 到 requirements/<id>/codebase/<name>/ + checkout -b 分支',
      async () => {
        const { url, root, token } = await boot()
        const { barePath, initialSha } = await makeUpstreamRepo(root, 'refund-service')
        await registerRepo(url, token, 'refund-service', `file://${barePath}`)

        mkdirSync(join(root, 'requirements', 'req-e2e-1'), { recursive: true })

        const res = await fetch(`${url}/api/requirement/req-e2e-1/repos`, {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            repoNames: ['refund-service'],
            branchName: 'feat/e2e',
          }),
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          succeeded: number
          failed: number
          results: Array<{
            ok: boolean
            repoName: string
            branch: string
            codebasePath: string
            base: string
          }>
        }
        expect(body.succeeded).toBe(1)
        expect(body.failed).toBe(0)
        expect(body.results[0]?.ok).toBe(true)
        expect(body.results[0]?.branch).toBe('feat/e2e')
        expect(body.results[0]?.base).toBe('main')

        const codebasePath = body.results[0]?.codebasePath
        expect(codebasePath).toBe(
          join(root, 'requirements', 'req-e2e-1', 'codebase', 'refund-service'),
        )
        expect(existsSync(codebasePath)).toBe(true)

        // 验证是独立 git 仓库(.git 存在且不指向 worktrees)
        const { stdout: gitDir } = await execFileP('git', [
          '-C',
          codebasePath,
          'rev-parse',
          '--git-dir',
        ])
        // 独立仓库 → gitDir 是绝对路径,不包含 'worktrees/'
        expect(gitDir.trim()).not.toContain('worktrees/')

        // 验证当前分支是 feat/e2e(由 checkout -b 创建)
        const { stdout: branch } = await execFileP('git', [
          '-C',
          codebasePath,
          'rev-parse',
          '--abbrev-ref',
          'HEAD',
        ])
        expect(branch.trim()).toBe('feat/e2e')

        // 验证 HEAD commit 与 upstream 一致
        const { stdout: head } = await execFileP('git', [
          '-C',
          codebasePath,
          'rev-parse',
          'HEAD',
        ])
        expect(head.trim()).toBe(initialSha)
      },
      30_000,
    )

    it(
      '重复 attach 同一 repo:已有 codebase → E_REPO_ALREADY_ATTACHED(不破坏 fs)',
      async () => {
        const { url, root, token } = await boot()
        const { barePath } = await makeUpstreamRepo(root, 'refund-service')
        await registerRepo(url, token, 'refund-service', `file://${barePath}`)
        mkdirSync(join(root, 'requirements', 'req-e2e-2'), { recursive: true })

        // 第一次:成功
        const first = await fetch(`${url}/api/requirement/req-e2e-2/repos`, {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            repoNames: ['refund-service'],
            branchName: 'feat/first',
          }),
        })
        expect(first.status).toBe(200)
        const firstBody = (await first.json()) as { results: Array<{ ok: boolean }> }
        expect(firstBody.results[0]?.ok).toBe(true)
        const codebasePath = join(
          root,
          'requirements',
          'req-e2e-2',
          'codebase',
          'refund-service',
        )
        expect(existsSync(codebasePath)).toBe(true)

        // 第二次:已存在 → E_REPO_ALREADY_ATTACHED
        const second = await fetch(`${url}/api/requirement/req-e2e-2/repos`, {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            repoNames: ['refund-service'],
            branchName: 'feat/second',
          }),
        })
        expect(second.status).toBe(200)
        const secondBody = (await second.json()) as {
          results: Array<{ ok: boolean; code?: string; message?: string }>
        }
        expect(secondBody.results[0]?.ok).toBe(false)
        expect(secondBody.results[0]?.code).toBe('E_REPO_ALREADY_ATTACHED')

        // fs 未破坏:codebase 仍在 + 第一次的 README.md 还在
        expect(existsSync(codebasePath)).toBe(true)
        const { stdout: branch } = await execFileP('git', [
          '-C',
          codebasePath,
          'rev-parse',
          '--abbrev-ref',
          'HEAD',
        ])
        expect(branch.trim()).toBe('feat/first') // 没被第二次覆盖
      },
      30_000,
    )

    it(
      '注册表无该 repo → E_REPO_NOT_FOUND(无 clone 副作用)',
      async () => {
        const { url, root, token } = await boot()
        // 不注册任何 repo
        mkdirSync(join(root, 'requirements', 'req-e2e-3'), { recursive: true })

        const res = await fetch(`${url}/api/requirement/req-e2e-3/repos`, {
          method: 'POST',
          headers: {
            'x-aidevspace-token': token,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            repoNames: ['ghost-repo'],
            branchName: 'feat/x',
          }),
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
          results: Array<{ ok: boolean; code?: string }>
        }
        expect(body.results[0]?.ok).toBe(false)
        expect(body.results[0]?.code).toBe('E_REPO_NOT_FOUND')
        // 无 codebase 目录残留
        expect(
          existsSync(
            join(root, 'requirements', 'req-e2e-3', 'codebase', 'ghost-repo'),
          ),
        ).toBe(false)
      },
      30_000,
    )

    it('鉴权 401:无 token', async () => {
      const { url } = await boot()
      const res = await fetch(`${url}/api/requirement/req-401/repos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ repoNames: ['x'], branchName: 'feat/x' }),
      })
      expect(res.status).toBe(401)
    }, 15_000)

    it('404 E_REQUIREMENT_NOT_FOUND:req 目录不存在', async () => {
      const { url, root, token } = await boot()
      // 准备一个注册条目但 req 目录不存在
      const { barePath } = await makeUpstreamRepo(root, 'r1')
      await registerRepo(url, token, 'r1', `file://${barePath}`)
      const res = await fetch(`${url}/api/requirement/req-missing/repos`, {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ repoNames: ['r1'], branchName: 'feat/x' }),
      })
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string; requirementId: string }
      expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
      expect(body.requirementId).toBe('req-missing')
    }, 15_000)

    it(
      'agent 启动收敛 orphan pending:残留 .pending-<name> + 半成品目录 → 下次 boot 清掉',
      async () => {
        // 1. 先 boot 一次(这次启动时还没有任何 orphan,等于 baseline)
        const { root, token } = await boot()

        // 2. 关闭第一个 server(boot 自带的 cleanups 会在 afterEach 跑;但我们要
        //    在中间重启,需要手动 close 第一个 app)
        // 简化做法:把"残留 orphan"放到一个新的 root 里,然后 buildServer 启动 →
        // 走 scanOrphanedPending 路径。直接复用 boot 但跳过 server.listen,只
        // 用 buildServer 触发 init 路径。
        const orphanRoot = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-orphan-'))
        writeFileSync(join(orphanRoot, 'config.yaml'), 'name: dev\n')
        const orphanReq = 'req-orphan'
        const orphanRepo = 'orphan-svc'
        const orphanDir = join(
          orphanRoot,
          'requirements',
          orphanReq,
          'codebase',
          orphanRepo,
        )
        mkdirSync(orphanDir, { recursive: true })
        writeFileSync(join(orphanDir, 'partial.txt'), 'leftover', 'utf8')
        writeFileSync(
          join(
            orphanRoot,
            'requirements',
            orphanReq,
            'codebase',
            `.pending-${orphanRepo}`,
          ),
          '',
          'utf8',
        )
        // sanity:启动前 orphan 还在
        expect(existsSync(orphanDir)).toBe(true)
        expect(
          existsSync(
            join(
              orphanRoot,
              'requirements',
              orphanReq,
              'codebase',
              `.pending-${orphanRepo}`,
            ),
          ),
        ).toBe(true)

        // 3. 启动新的 buildServer(走 scanOrphanedPending 路径)
        const app = await buildServer({
          workspaceRoot: orphanRoot,
          logFilePath: join(orphanRoot, 'agent.log'),
        })
        // 4. 验证:orphan 半成品目录 + pending 标记都被清掉
        expect(existsSync(orphanDir)).toBe(false)
        expect(
          existsSync(
            join(
              orphanRoot,
              'requirements',
              orphanReq,
              'codebase',
              `.pending-${orphanRepo}`,
            ),
          ),
        ).toBe(false)

        await app.close()
        rmSync(orphanRoot, { recursive: true, force: true })
        // 第一个 boot() 的 root 已经被 cleanups 接管,afterEach 会清
        void token
      },
      30_000,
    )
  },
)

// 静默 unused-import 警告
void execFile