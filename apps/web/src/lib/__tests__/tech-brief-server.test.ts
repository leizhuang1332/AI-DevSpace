import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadTechBrief,
  loadModules,
  saveTechBriefWithSnapshot,
  saveModulesWithSnapshot,
  resolveAnalysisDir,
} from '@/lib/tech-brief.server'

let testRoot: string
let snapshotDir: string

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'aidevspace-tb-'))
  snapshotDir = mkdtempSync(join(tmpdir(), 'aidevspace-tb-snap-'))
  process.env.AIDEVSPACE_ROOT = testRoot
  process.env.AIDEVSPACE_SNAPSHOT_DIR = snapshotDir
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
  rmSync(snapshotDir, { recursive: true, force: true })
  delete process.env.AIDEVSPACE_ROOT
  delete process.env.AIDEVSPACE_SNAPSHOT_DIR
})

describe('resolveAnalysisDir', () => {
  it('拼接 AIDEVSPACE_ROOT/requirements/<reqId>/analysis', () => {
    expect(resolveAnalysisDir('req-001')).toBe(join(testRoot, 'requirements', 'req-001', 'analysis'))
  })
})

describe('loadTechBrief / loadModules', () => {
  it('文件不存在 → loadTechBrief 返回 null,loadModules 返回空 modules', () => {
    const dir = join(testRoot, 'requirements', 'req-load-1', 'analysis')
    expect(loadTechBrief(dir)).toBeNull()
    expect(loadModules(dir).modules).toEqual([])
  })

  it('写入技术概要后 loadTechBrief 还原内容', () => {
    const dir = join(testRoot, 'requirements', 'req-load-2', 'analysis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'technical-brief.md'), '# hello\n## 1. 业务背景\n')
    expect(loadTechBrief(dir)).toBe('# hello\n## 1. 业务背景\n')
  })

  it('写入 modules.yaml 后 loadModules 还原结构', () => {
    const dir = join(testRoot, 'requirements', 'req-load-3', 'analysis')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'modules.yaml'),
      'modules:\n  - id: m-1\n    name: x\n    description: d\n    deps: []\n    complexity: low\n',
    )
    const file = loadModules(dir)
    expect(file.modules).toHaveLength(1)
    expect(file.modules[0].id).toBe('m-1')
  })
})

describe('saveTechBriefWithSnapshot / saveModulesWithSnapshot', () => {
  it('写入 brief(首次)→ 文件落盘', () => {
    const dir = resolveAnalysisDir('req-save-1')
    const result = saveTechBriefWithSnapshot(dir, '# new brief\n')
    expect(result.ok).toBe(true)
    expect(existsSync(join(dir, 'technical-brief.md'))).toBe(true)
    expect(readFileSync(join(dir, 'technical-brief.md'), 'utf8')).toBe('# new brief\n')
  })

  it('第二次写入 → 旧版 snapshot 保留(可回滚)', () => {
    const dir = resolveAnalysisDir('req-save-2')
    saveTechBriefWithSnapshot(dir, '# version 1\n')
    saveTechBriefWithSnapshot(dir, '# version 2\n')
    expect(readFileSync(join(dir, 'technical-brief.md'), 'utf8')).toBe('# version 2\n')
    // 第二次写时,v1 文件已存在 → snapshot 落盘 v1
    const snapFiles = listSnapshotFiles(snapshotDir, 'req-save-2', 'technical-brief.md')
    expect(snapFiles.length).toBeGreaterThanOrEqual(1)
    // 至少一个 snapshot 含旧版
    const snapContents = snapFiles.map((p) => readFileSync(p, 'utf8'))
    expect(snapContents).toContain('# version 1\n')
  })

  it('写入 modules.yaml 第二次写入时 snapshot 落盘旧版', () => {
    const dir = resolveAnalysisDir('req-save-3')
    saveModulesWithSnapshot(dir, {
      modules: [{ id: 'm-1', name: 'x', description: '', deps: [], complexity: 'low' }],
    })
    saveModulesWithSnapshot(dir, {
      modules: [{ id: 'm-2', name: 'y', description: '', deps: [], complexity: 'high' }],
    })
    const snapFiles = listSnapshotFiles(snapshotDir, 'req-save-3', 'modules.yaml')
    expect(snapFiles.length).toBeGreaterThanOrEqual(1)
    const snapContents = snapFiles.map((p) => readFileSync(p, 'utf8'))
    expect(snapContents.some((c) => c.includes('m-1'))).toBe(true)
  })

  it('未配置 AIDEVSPACE_SNAPSHOT_DIR 时静默跳过 snapshot', () => {
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
    const dir = join(testRoot, 'requirements', 'req-no-snap', 'analysis')
    mkdirSync(dir, { recursive: true })
    const result = saveTechBriefWithSnapshot(dir, '# no snap\n')
    expect(result.ok).toBe(true)
    expect(result.snapshotPath).toBeNull()
  })
})

function listSnapshotFiles(root: string, reqId: string, fileName: string): string[] {
  const reqDir = join(root, reqId)
  if (!existsSync(reqDir)) return []
  const out: string[] = []
  for (const ts of readdirSync(reqDir)) {
    const p = join(reqDir, ts, fileName)
    if (existsSync(p)) out.push(p)
  }
  return out
}