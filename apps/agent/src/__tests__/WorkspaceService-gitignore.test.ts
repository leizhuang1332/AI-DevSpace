/**
 * WorkspaceService · .gitignore 条件补齐测试(issue 04 4.5)
 *
 * 约定:`initWorkspace()` 仅当 workspace 自身是 git 仓库(根下存在 `.git/` 目录)时
 * 才补齐 `.gitignore`(含 codebase/ 规则)。非 git workspace 不写。
 *
 * 这避免给 CI / 演示 / 临时容器等非 git 管理的本地 workspace
 * 塞一份「不知道从哪来的」.gitignore。
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
import { WorkspaceService } from '../services/WorkspaceService.js'

let tmpRoot: string
let svc: WorkspaceService

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-gitignore-'))
  svc = WorkspaceService.singleRoot(tmpRoot)
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 非 git workspace → 不写
// ---------------------------------------------------------------------------

describe('非 git workspace (.git/ 不存在)', () => {
  it('init 后 .gitignore 不写', async () => {
    const r = await svc.initWorkspace()
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(false)
    expect(r.gitignoreCreated).toBe(false)
  })

  it('init 后 config.yaml / 子目录照常创建', async () => {
    await svc.initWorkspace()
    expect(existsSync(join(tmpRoot, 'config.yaml'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'requirements'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'logs'))).toBe(true)
    // 但 .gitignore 不创建
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(false)
  })

  it('init 两次都不会触发 .gitignore 创建', async () => {
    await svc.initWorkspace()
    const r = await svc.initWorkspace()
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(false)
    expect(r.gitignoreCreated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// git workspace → 补齐 + 保留既有
// ---------------------------------------------------------------------------

describe('git workspace (.git/ 存在)', () => {
  beforeEach(() => {
    // 把 tmp 目录模拟成 git workspace
    mkdirSync(join(tmpRoot, '.git'), { recursive: true })
  })

  it('缺失时写入标准内容(含 codebase/ + .git/ 两条新规则)', async () => {
    const r = await svc.initWorkspace()
    expect(r.gitignoreCreated).toBe(true)
    const gi = readFileSync(join(tmpRoot, '.gitignore'), 'utf8')
    expect(gi).toContain('logs/')
    expect(gi).toContain('snapshots/')
    expect(gi).toContain('*/node_modules/')
    expect(gi).toContain('.DS_Store')
    expect(gi).toContain('*.log')
    // issue 04 4.5 新增规则
    expect(gi).toContain('requirements/*/codebase/')
    expect(gi).toContain('requirements/*/codebase/**/.git/')
    expect(gi).toContain('# AI DevSpace workspace') // 标题头
  })

  it('存在时不覆盖 —— 保留用户自定义', async () => {
    writeFileSync(join(tmpRoot, '.gitignore'), '# user custom\nfoo\n')
    const r = await svc.initWorkspace()
    expect(r.gitignoreCreated).toBe(false)
    const gi = readFileSync(join(tmpRoot, '.gitignore'), 'utf8')
    expect(gi).toBe('# user custom\nfoo\n')
  })

  it('存在但为空 → 保留(不写),gitignoreCreated=false', async () => {
    writeFileSync(join(tmpRoot, '.gitignore'), '', 'utf8')
    const r = await svc.initWorkspace()
    expect(r.gitignoreCreated).toBe(false)
    expect(readFileSync(join(tmpRoot, '.gitignore'), 'utf8')).toBe('')
  })

  it('第二次 init: 已写过 → gitignoreCreated=false', async () => {
    await svc.initWorkspace()
    const r = await svc.initWorkspace()
    expect(r.gitignoreCreated).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 真正「workspace 是 git 仓库」的场景:
// 我们 tmp 目录里 .git 创建只是一个约定;
// 真实路径就是 "~/.aidevspace" 或 AIDEVSPACE_HOME 设的路径,init 看到 .git 就写
// ---------------------------------------------------------------------------

describe('initWorkspace 写 .gitignore 的契约 (集成端)', () => {
  it('代码仓库根(workspaceRoot 本身)是 git 仓库 → 写入', async () => {
    // 模拟这种情况:AIDEVSPACE_HOME 指向一个已经是 git 仓库的目录
    // 用 cwd 的 .git 或 tmpRoot/.git 模拟 —— .git 已写在 tmpRoot
    mkdirSync(join(tmpRoot, '.git'), { recursive: true })
    writeFileSync(join(tmpRoot, 'unrelated.txt'), 'hi', 'utf8')
    const r = await svc.initWorkspace()
    expect(r.gitignoreCreated).toBe(true)
    // 不应影响既有文件
    expect(readFileSync(join(tmpRoot, 'unrelated.txt'), 'utf8')).toBe('hi')
  })
})
