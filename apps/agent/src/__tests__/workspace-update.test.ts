import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
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

describe('slice 9: updateConfig 深合并', () => {
  it('缺 config.yaml 时 patch 后写出（默认值作底）', async () => {
    const r = await ws.updateConfig({ theme: 'dark' })
    expect(r.config.theme).toBe('dark')
    expect(r.config.typewriterSpeed).toBe('medium') // 默认值保留
    expect(r.config['ai.provider']).toBe('claude-code')
  })

  it('存在 config.yaml 时合并 patch，保留未提及字段', async () => {
    await ws.initWorkspace()
    const r = await ws.updateConfig({ theme: 'dark' })
    expect(r.config.theme).toBe('dark')
    expect(r.config.typewriterSpeed).toBe('medium')
    expect(r.config.silentWindowSeconds).toBe(30)
  })

  it('部分 patch 可新增字段', async () => {
    const r = await ws.updateConfig({ customKey: 42, theme: 'light' })
    expect(r.config.customKey).toBe(42)
    expect(r.config.theme).toBe('light')
  })

  it('返回的 config 等同于磁盘上的 config.yaml', async () => {
    await ws.updateConfig({ theme: 'dark', silentWindowSeconds: 60 })
    const r2 = await ws.updateConfig({ typewriterSpeed: 'fast' })
    expect(r2.config.theme).toBe('dark')
    expect(r2.config.silentWindowSeconds).toBe(60)
    expect(r2.config.typewriterSpeed).toBe('fast')
  })
})

describe('slice 10: 写盘原子性', () => {
  it('成功写入后根目录无 .tmp 残留', async () => {
    await ws.initWorkspace()
    await ws.updateConfig({ theme: 'dark' })
    const entries = readdirSync(tmpRoot)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })

  it('多次更新后仍无 .tmp 残留', async () => {
    await ws.initWorkspace()
    for (let i = 0; i < 5; i++) {
      await ws.updateConfig({ theme: i % 2 ? 'dark' : 'light' })
    }
    const entries = readdirSync(tmpRoot)
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false)
  })
})

describe('slice 11: 磁盘占用', () => {
  it('空 workspace 占用包含 config.yaml + .gitignore（init 后不为 0）', async () => {
    await ws.initWorkspace()
    const info = await ws.getWorkspaceInfo()
    expect(info.diskUsageBytes).toBeGreaterThan(0)
  })

  it('写入 10000 字节文件后占用增加约 10000', async () => {
    await ws.initWorkspace()
    const before = (await ws.getWorkspaceInfo()).diskUsageBytes
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(tmpRoot, 'requirements', 'big.md'), 'x'.repeat(10_000))
    const after = (await ws.getWorkspaceInfo()).diskUsageBytes
    expect(after - before).toBe(10_000)
  })

  it('嵌套目录文件累加', async () => {
    await ws.initWorkspace()
    const before = (await ws.getWorkspaceInfo()).diskUsageBytes
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(tmpRoot, 'knowledge', 'domain'), { recursive: true })
    writeFileSync(join(tmpRoot, 'knowledge', 'domain', 'a.md'), 'a'.repeat(500))
    writeFileSync(join(tmpRoot, 'knowledge', 'domain', 'b.md'), 'b'.repeat(1500))
    const after = (await ws.getWorkspaceInfo()).diskUsageBytes
    expect(after - before).toBe(2000)
  })
})

describe('slice 8 (补) : getWorkspaceInfo 完整契约', () => {
  it('根路径不存在时 exists: false、createdAt null、diskUsage 0', async () => {
    const ws2 = new WorkspaceService(join(tmpRoot, 'does-not-exist'))
    const info = await ws2.getWorkspaceInfo()
    expect(info.exists).toBe(false)
    expect(info.createdAt).toBe(null)
    expect(info.diskUsageBytes).toBe(0)
    expect(info.root).toBe(join(tmpRoot, 'does-not-exist'))
  })

  it('config.yaml 缺失时 config 字段返回默认值（含 workspaceRoot）', async () => {
    await ws.initWorkspace()
    const { unlinkSync } = await import('node:fs')
    unlinkSync(join(tmpRoot, 'config.yaml'))
    const info = await ws.getWorkspaceInfo()
    expect(info.config.theme).toBe('system')
    expect(info.config.workspaceRoot).toBe(tmpRoot)
  })

  it('config.yaml 损坏抛 WorkspaceCorruptError', async () => {
    await ws.initWorkspace()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(tmpRoot, 'config.yaml'), ':\n: invalid yaml [\n', 'utf8')
    await expect(ws.getWorkspaceInfo()).rejects.toThrow(/corrupt/i)
  })
})
