/**
 * WorkspaceService · 旧 `repos/<n>/` 物理目录 → `repos.yaml` 一次性迁移测试(issue 04 4.4)
 *
 * 覆盖(issue 04 验收清单):
 *  - fake `<root>/repos/<n>/.git/config` (含 [remote "origin"] 段)→ yaml 自动出现 <n>
 *  - 旧 `repos/` 目录**不删除**(决策 Q3:可能有未 push 提交)
 *  - 已存在同名 yaml 条目 → 跳过(避免覆盖用户精编的 gitUrl / description)
 *  - 子目录无 `.git/config` / 没 origin URL → 跳过
 *  - 迁移报告写进 InitWorkspaceResult.migratedRepos(供 UI 横幅)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import yaml from 'yaml'
import { WorkspaceService } from '../services/WorkspaceService.js'

let tmpRoot: string
let svc: WorkspaceService

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-migrate-'))
  svc = new WorkspaceService(tmpRoot)
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

/**
 * 在 tmpRoot 里建一个 fake `<root>/repos/<name>/.git/config`,模拟老用户池目录。
 *
 * `withOrigin = true` 时写入合法 `[remote "origin"]` 段 + `url`;否则只放空 config。
 */
function makeFakeGitRepo(name: string, withOrigin: boolean) {
  const repoDir = join(tmpRoot, 'repos', name)
  const gitDir = join(repoDir, '.git')
  mkdirSync(gitDir, { recursive: true })
  if (withOrigin) {
    const configText = [
      '[core]',
      '\trepositoryformatversion = 0',
      '\tfilemode = true',
      '[remote "origin"]',
      `\turl = git@github.com:acme/${name}.git`,
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '[branch "main"]',
      '\tremote = origin',
      '\tmerge = refs/heads/main',
      '',
    ].join('\n')
    writeFileSync(join(gitDir, 'config'), configText, 'utf8')
  } else {
    // empty config (e.g. local-only repo with no remote)
    writeFileSync(join(gitDir, 'config'), '[core]\n\trepositoryformatversion = 0\n', 'utf8')
  }
  return repoDir
}

describe('initWorkspace 启动迁移: 旧 repos/<n>/ → repos.yaml', () => {
  it('全新安装:无 repos/ → migratedRepos=[]', async () => {
    const r = await svc.initWorkspace()
    expect(r.migratedRepos).toEqual([])
    expect(existsSync(join(tmpRoot, 'repos'))).toBe(false)
    expect(existsSync(svc.repoRegistryPath)).toBe(false)
  })

  it('3 个 fake git 仓库 → 全部迁入 yaml,旧 repos/ 目录保留', async () => {
    makeFakeGitRepo('refund-service', true)
    makeFakeGitRepo('order-service', true)
    makeFakeGitRepo('user-service', true)

    const r = await svc.initWorkspace()
    expect(r.migratedRepos.sort()).toEqual([
      'order-service',
      'refund-service',
      'user-service',
    ])

    // repos.yaml 里 3 条都出现,gitUrl 从 .git/config 抽出来
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(3)
    const byName = Object.fromEntries(reg.repos.map((e) => [e.name, e]))
    expect(byName['refund-service']?.gitUrl).toBe(
      'git@github.com:acme/refund-service.git',
    )
    expect(byName['order-service']?.gitUrl).toBe(
      'git@github.com:acme/order-service.git',
    )
    expect(byName['user-service']?.gitUrl).toBe(
      'git@github.com:acme/user-service.git',
    )
    // description 一律空串(老仓库没有元数据,留空待用户补)
    expect(reg.repos.every((e) => e.description === '')).toBe(true)

    // **旧目录保留**(决策 Q3:可能有未 push 的本地提交)
    expect(existsSync(join(tmpRoot, 'repos'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'repos', 'refund-service', '.git', 'config'))).toBe(
      true,
    )
  })

  it('子目录无 .git/config → 跳过(非 git 仓库不混入)', async () => {
    mkdirSync(join(tmpRoot, 'repos', 'random-notes'), { recursive: true })
    writeFileSync(join(tmpRoot, 'repos', 'random-notes', 'README.md'), 'just notes', 'utf8')
    makeFakeGitRepo('real-repo', true)

    const r = await svc.initWorkspace()
    expect(r.migratedRepos).toEqual(['real-repo'])
  })

  it('.git/config 有但无 origin 段 → 跳过(local-only repo)', async () => {
    makeFakeGitRepo('local-repo', false) // no origin url
    makeFakeGitRepo('remote-repo', true)

    const r = await svc.initWorkspace()
    expect(r.migratedRepos).toEqual(['remote-repo'])
  })

  it('已有同名 yaml 条目(用户精编过 gitUrl / desc)→ 不覆盖', async () => {
    // 用户预先编辑了 repos.yaml,gitUrl 和 description 都填了
    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({
        version: 1,
        repos: [
          {
            name: 'refund-service',
            gitUrl: 'git@personal:my-fork/refund-service.git',
            description: '我的 fork',
          },
        ],
      }),
      'utf8',
    )
    // 老目录里同一个 name 但 gitUrl 是别人的
    makeFakeGitRepo('refund-service', true)

    const r = await svc.initWorkspace()
    // 本次没新增迁移 → 返回空
    expect(r.migratedRepos).toEqual([])

    const reg = await svc.readRepoRegistry()
    // 用户的 fork 信息完整保留
    expect(reg.repos).toHaveLength(1)
    expect(reg.repos[0]).toEqual({
      name: 'refund-service',
      gitUrl: 'git@personal:my-fork/refund-service.git',
      description: '我的 fork',
    })
  })

  it('混合场景:3 个 git + 1 个非 git + 1 个 origin-less + 1 个 yaml 已存在 → 只迁未被覆盖的', async () => {
    makeFakeGitRepo('a-fresh', true)
    makeFakeGitRepo('b-fresh', true)
    makeFakeGitRepo('c-no-origin', false)
    mkdirSync(join(tmpRoot, 'repos', 'd-stray'), { recursive: true })
    writeFileSync(join(tmpRoot, 'repos', 'd-stray', 'note.txt'), 'x', 'utf8')

    writeFileSync(
      svc.repoRegistryPath,
      yaml.stringify({
        version: 1,
        repos: [
          {
            name: 'a-fresh',
            gitUrl: 'git@kept',
            description: 'kept',
          },
        ],
      }),
      'utf8',
    )

    const r = await svc.initWorkspace()
    // a-fresh 已在 yaml → 不出现在本次迁移列表;只有 b-fresh 真正新增
    expect(r.migratedRepos).toEqual(['b-fresh'])

    // yaml 总条目 = 原 1(a-fresh) + 迁入 1(b-fresh) = 2
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(2)
    const names = reg.repos.map((e) => e.name).sort()
    expect(names).toEqual(['a-fresh', 'b-fresh'])
    // a-fresh 的 gitUrl 仍是用户精编的 'git@kept',未覆盖
    expect(reg.repos.find((e) => e.name === 'a-fresh')?.gitUrl).toBe('git@kept')
  })

  it('幂等:第二次启动已迁过的条目不再出现在 migratedRepos', async () => {
    makeFakeGitRepo('once', true)
    const r1 = await svc.initWorkspace()
    expect(r1.migratedRepos).toEqual(['once'])

    // 立刻第二次启动(模拟 agent 重启)
    const r2 = await svc.initWorkspace()
    expect(r2.migratedRepos).toEqual([])
    // yaml 还是只有一条,name=once
    const reg = await svc.readRepoRegistry()
    expect(reg.repos).toHaveLength(1)
    expect(reg.repos[0]?.name).toBe('once')
  })

  it('迁移日志点 → 仍可观察 yaml 文件被正确写出(.tmp 被 rename 覆盖)', async () => {
    makeFakeGitRepo('visible', true)
    await svc.initWorkspace()

    // repos.yaml 内容是合法 yaml + 多余字段没有
    const raw = readFileSync(svc.repoRegistryPath, 'utf8')
    const parsed = yaml.parse(raw)
    expect(parsed.version).toBe(1)
    expect(parsed.repos).toHaveLength(1)
    expect(parsed.repos[0].name).toBe('visible')
    expect(parsed.repos[0].gitUrl).toBe('git@github.com:acme/visible.git')
  })

  it('子目录 .git/config 含 dev/test 双 remote → 取 origin(决策清晰,避免歧义)', async () => {
    // 真实 git 配置里可能多个 remote;只信任 [remote "origin"]
    const repoDir = join(tmpRoot, 'repos', 'multi-remote')
    mkdirSync(join(repoDir, '.git'), { recursive: true })
    const configText = [
      '[core]',
      '\trepositoryformatversion = 0',
      '[remote "dev"]',
      '\turl = git@internal/dev-clone.git',
      '\tfetch = +refs/heads/*:refs/remotes/dev/*',
      '[remote "origin"]',
      '\turl = git@github.com:acme/multi-remote.git',
      '\tfetch = +refs/heads/*:refs/remotes/origin/*',
      '',
    ].join('\n')
    writeFileSync(join(repoDir, '.git', 'config'), configText, 'utf8')

    const r = await svc.initWorkspace()
    expect(r.migratedRepos).toEqual(['multi-remote'])
    const reg = await svc.readRepoRegistry()
    // 只取了 origin
    expect(reg.repos[0]?.gitUrl).toBe('git@github.com:acme/multi-remote.git')
  })
})
