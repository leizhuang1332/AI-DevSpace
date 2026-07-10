import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceService } from '../services/WorkspaceService.js'

let tmpRoot: string
let ws: WorkspaceService

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-test-'))
  ws = new WorkspaceService(tmpRoot)
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

describe('initWorkspace - slice 3: 子目录创建', () => {
  it('全新场景创建 5 个子目录', async () => {
    const r = await ws.initWorkspace()
    for (const d of ['requirements', 'repos', 'knowledge', 'skills', 'logs']) {
      expect(existsSync(join(tmpRoot, d))).toBe(true)
    }
    expect(r.createdDirs.length).toBeGreaterThanOrEqual(5)
    expect(r.existedDirs).toHaveLength(0)
  })

  it('第二次调用标记全部 existed', async () => {
    await ws.initWorkspace()
    const r = await ws.initWorkspace()
    expect(r.createdDirs).toHaveLength(0)
    expect(r.existedDirs.length).toBeGreaterThanOrEqual(5)
  })

  it('部分子目录已存在时只补缺失', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'requirements'))
    mkdirSync(join(tmpRoot, 'logs'))
    const r = await ws.initWorkspace()
    expect(r.existedDirs).toContain('requirements')
    expect(r.existedDirs).toContain('logs')
    expect(r.createdDirs).toContain('repos')
    expect(r.createdDirs).toContain('knowledge')
    expect(r.createdDirs).toContain('skills')
  })
})

describe('initWorkspace - slice 4: .gitignore', () => {
  it('缺失时写入标准内容', async () => {
    await ws.initWorkspace()
    const gi = readFileSync(join(tmpRoot, '.gitignore'), 'utf8')
    expect(gi).toContain('logs/')
    expect(gi).toContain('*/node_modules/')
    expect(gi).toContain('.DS_Store')
    expect(gi).toContain('*.log')
    expect(gi).toContain('snapshots/')
  })

  it('存在时不覆盖（保留用户自定义）', async () => {
    writeFileSync(join(tmpRoot, '.gitignore'), '# user custom\nfoo\n')
    const r = await ws.initWorkspace()
    expect(r.gitignoreCreated).toBe(false)
    const gi = readFileSync(join(tmpRoot, '.gitignore'), 'utf8')
    expect(gi).toBe('# user custom\nfoo\n')
  })
})

describe('initWorkspace - slice 5: config.yaml 默认值', () => {
  it('全新场景写默认 config', async () => {
    const r = await ws.initWorkspace()
    expect(r.configCreated).toBe(true)
    expect(r.configBackfilled).toBe(false)
    const info = await ws.getWorkspaceInfo()
    expect(info.config.theme).toBe('system')
    expect(info.config.typewriterSpeed).toBe('medium')
    expect(info.config['ai.provider']).toBe('claude-code')
  })

  it('workspaceRoot 注入实际路径', async () => {
    await ws.initWorkspace()
    const info = await ws.getWorkspaceInfo()
    expect(info.config.workspaceRoot).toBe(tmpRoot)
  })
})

describe('initWorkspace - slice 6: 补缺不覆盖', () => {
  it('已存在 config.yaml 时只补缺，保留用户值', async () => {
    writeFileSync(
      join(tmpRoot, 'config.yaml'),
      'theme: dark\ncustomKey: hello\n',
      'utf8',
    )
    const r = await ws.initWorkspace()
    expect(r.configCreated).toBe(false)
    expect(r.configBackfilled).toBe(true)
    const info = await ws.getWorkspaceInfo()
    expect(info.config.theme).toBe('dark') // 保留用户值
    expect(info.config.customKey).toBe('hello') // 保留用户额外 key
    expect(info.config.typewriterSpeed).toBe('medium') // 补默认值
    expect(info.config['ai.provider']).toBe('claude-code') // 补默认值
  })
})

describe('initWorkspace - slice 7: workspaceRoot 注入', () => {
  it('config.yaml 里 workspaceRoot 缺失时注入', async () => {
    writeFileSync(join(tmpRoot, 'config.yaml'), 'theme: dark\n', 'utf8')
    await ws.initWorkspace()
    const info = await ws.getWorkspaceInfo()
    expect(info.config.workspaceRoot).toBe(tmpRoot)
  })

  it('config.yaml 里 workspaceRoot 与实际路径不一致时覆盖为当前 root', async () => {
    writeFileSync(
      join(tmpRoot, 'config.yaml'),
      `workspaceRoot: /some/other/path\ntheme: dark\n`,
      'utf8',
    )
    await ws.initWorkspace()
    const info = await ws.getWorkspaceInfo()
    expect(info.config.workspaceRoot).toBe(tmpRoot)
    expect(info.config.theme).toBe('dark')
  })
})
