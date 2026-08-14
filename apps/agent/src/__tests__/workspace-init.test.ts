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
  it('全新场景创建 5 个子目录（issue 04 4.1: "repos" 不再是 SUBDIRS）', async () => {
    const r = await ws.initWorkspace()
    for (const d of ['requirements', 'knowledge', 'skills', 'analysis-skills', 'logs']) {
      expect(existsSync(join(tmpRoot, d))).toBe(true)
    }
    // ADR-0030 / issue 04 4.1:'repos/' 不再是 SUBDIRS(真相源改为 repos.yaml)
    expect(existsSync(join(tmpRoot, 'repos'))).toBe(false)
    expect(r.createdDirs).toEqual([
      'requirements',
      'knowledge',
      'skills',
      'analysis-skills',
      'logs',
    ])
    expect(r.existedDirs).toHaveLength(0)
  })

  it('第二次调用标记全部 existed', async () => {
    await ws.initWorkspace()
    const r = await ws.initWorkspace()
    expect(r.createdDirs).toHaveLength(0)
    expect(r.existedDirs).toEqual([
      'requirements',
      'knowledge',
      'skills',
      'analysis-skills',
      'logs',
    ])
  })

  it('部分子目录已存在时只补缺失（issue 04 4.1: 不含 repos）', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'requirements'))
    mkdirSync(join(tmpRoot, 'logs'))
    const r = await ws.initWorkspace()
    expect(r.existedDirs).toContain('requirements')
    expect(r.existedDirs).toContain('logs')
    expect(r.createdDirs).toContain('knowledge')
    expect(r.createdDirs).toContain('skills')
    expect(r.createdDirs).toContain('analysis-skills')
    expect(r.createdDirs).not.toContain('repos')
  })
})

describe('initWorkspace - slice 4: .gitignore (issue 04 4.5: 仅 workspace 是 git repo 才写)', () => {
  it('非 git workspace:缺失时跳过写入,gitignoreCreated=false', async () => {
    const r = await ws.initWorkspace()
    // 临时目录不在 git 仓库里 → 不应写 .gitignore
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(false)
    expect(r.gitignoreCreated).toBe(false)
  })

  it('非 git workspace:即便 initWorkspace 完成 config / 子目录也照常', async () => {
    const r = await ws.initWorkspace()
    // 子目录 + config 都正常,只是 .gitignore 不写
    expect(existsSync(join(tmpRoot, 'requirements'))).toBe(true)
    expect(existsSync(join(tmpRoot, 'config.yaml'))).toBe(true)
    expect(r.configCreated).toBe(true)
  })

  it('git workspace:缺失时写入标准内容含 codebase/ 规则', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, '.git'))
    const r = await ws.initWorkspace()
    expect(r.gitignoreCreated).toBe(true)
    const gi = readFileSync(join(tmpRoot, '.gitignore'), 'utf8')
    expect(gi).toContain('logs/')
    expect(gi).toContain('*/node_modules/')
    expect(gi).toContain('.DS_Store')
    expect(gi).toContain('*.log')
    expect(gi).toContain('snapshots/')
    // issue 04 4.5 新增的两条
    expect(gi).toContain('requirements/*/codebase/')
    expect(gi).toContain('requirements/*/codebase/**/.git/')
  })

  it('git workspace:存在时不覆盖（保留用户自定义）', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, '.git'))
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

// ============================================================================
// ADR-0026 D6.1: 一次性清理 ~/.aidevspace/zones/*.yaml(声明式注册表退役)
// ============================================================================

describe('initWorkspace - slice 8: zones 目录退役清理 (ADR-0026 D6.1)', () => {
  it('全新安装无 zones 目录 → zonesDirRetired=false', async () => {
    const r = await ws.initWorkspace()
    expect(r.zonesDirRetired).toBe(false)
    expect(existsSync(join(tmpRoot, 'zones'))).toBe(false)
  })

  it('老用户升级:残留 zones/ + *.yaml → 一次性删除,zonesDirRetired=true', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'zones'))
    writeFileSync(join(tmpRoot, 'zones', 'drafting.yaml'), 'zone:\n  id: drafting\n', 'utf8')
    writeFileSync(join(tmpRoot, 'zones', 'analyzing.yaml'), 'zone:\n  id: analyzing\n', 'utf8')

    const r = await ws.initWorkspace()
    expect(r.zonesDirRetired).toBe(true)
    expect(existsSync(join(tmpRoot, 'zones'))).toBe(false)
    expect(existsSync(join(tmpRoot, 'zones', 'drafting.yaml'))).toBe(false)
  })

  it('幂等:第二次启动 zones 已不存在 → zonesDirRetired=false,无副作用', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'zones'))
    writeFileSync(join(tmpRoot, 'zones', 'drafting.yaml'), 'zone:\n  id: drafting\n', 'utf8')

    const r1 = await ws.initWorkspace()
    expect(r1.zonesDirRetired).toBe(true)

    const r2 = await ws.initWorkspace()
    expect(r2.zonesDirRetired).toBe(false)
    // 其他初始化逻辑仍正常(config / 5 个 SUBDIRS)
    expect(r2.existedDirs.length).toBeGreaterThanOrEqual(5)
  })

  it('清理 zones 不影响其他子目录 / config', async () => {
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'zones'))
    writeFileSync(join(tmpRoot, 'zones', 'executing.yaml'), 'zone:\n  id: executing\n', 'utf8')

    const r = await ws.initWorkspace()
    expect(r.zonesDirRetired).toBe(true)
    // 5 个合法子目录都在(issue 04 4.1: 'repos' 不再是 SUBDIRS)
    for (const d of ['requirements', 'knowledge', 'skills', 'analysis-skills', 'logs']) {
      expect(existsSync(join(tmpRoot, d))).toBe(true)
    }
    // config 正常写入;.gitignore 不写,因为 tmp 目录非 git workspace
    expect(existsSync(join(tmpRoot, 'config.yaml'))).toBe(true)
    expect(existsSync(join(tmpRoot, '.gitignore'))).toBe(false)
  })
})
