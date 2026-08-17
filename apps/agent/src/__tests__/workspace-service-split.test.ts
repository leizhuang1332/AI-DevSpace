import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'yaml'
import { WorkspaceService } from '../services/WorkspaceService.js'

/**
 * ADR-0037 D1 / D2: WorkspaceService 拆 configDir + dataRoot + 启动算法重写
 *
 * 8 case:
 * 1. env 优先(env 设 → configDir = env 归一化)
 * 2. env 缺 → configDir = ~/.aidevspace
 * 3. yaml.workspaceRoot 空 → dataRoot = configDir(向后兼容)
 * 4. yaml.workspaceRoot 有 → dataRoot = normalize 后的字段值
 * 5. env 用户切 yaml: 启动期 resolveDataRoot 读到 yaml 后取新值
 * 6. initWorkspace: config.yaml 写在 configDir, 子目录写在 dataRoot
 * 7. getWorkspaceInfo: configDir + dataRoot 双字段返回
 * 8. validatePath: 三档反馈(不存在 / 无痕迹 / 有痕迹)
 */

describe('WorkspaceService - configDir/dataRoot 拆分 (ADR-0037)', () => {
  let tmpConfigDir: string
  let tmpDataRoot: string

  beforeEach(() => {
    tmpConfigDir = mkdtempSync(join(tmpdir(), 'aidev-cfg-'))
    tmpDataRoot = mkdtempSync(join(tmpdir(), 'aidev-data-'))
  })

  afterEach(() => {
    if (existsSync(tmpConfigDir)) rmSync(tmpConfigDir, { recursive: true, force: true })
    if (existsSync(tmpDataRoot)) rmSync(tmpDataRoot, { recursive: true, force: true })
  })

  describe('case 1: env 优先决定 configDir', () => {
    it('resolveConfigDir(env={AIDEVSPACE_HOME: /custom/path}) → /custom/path(原样返回,非 mingw 格式)', () => {
      const r = WorkspaceService.resolveConfigDir({ AIDEVSPACE_HOME: '/custom/path' })
      // /custom/path 在 win32 下不匹配 ^/[a-zA-Z]/,不被 normalize;原样返回
      expect(r).toBe('/custom/path')
    })

    it('resolveConfigDir(env={AIDEVSPACE_HOME: /c/aidev}) → mingw 归一化为 C:\\aidev (win32)', () => {
      // 模拟 win32 平台视角
      const origPlatform = process.platform
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      try {
        const r = WorkspaceService.resolveConfigDir({ AIDEVSPACE_HOME: '/c/aidev' })
        expect(r).toBe('C:\\aidev')
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
      }
    })

    it('resolveConfigDir(env={}) → ~/.aidevspace 默认', () => {
      const r = WorkspaceService.resolveConfigDir({})
      expect(r).toMatch(/\.aidevspace$/)
    })
  })

  describe('case 2 + 3: yaml.workspaceRoot 缺/空 → dataRoot = configDir', () => {
    it('configDir/config.yaml 不存在 → dataRoot = configDir', async () => {
      const dataRoot = await WorkspaceService.resolveDataRoot(tmpConfigDir)
      expect(dataRoot).toBe(tmpConfigDir)
    })

    it('configDir/config.yaml 存在但 workspaceRoot 字段空 → dataRoot = configDir', async () => {
      writeFileSync(join(tmpConfigDir, 'config.yaml'), yaml.stringify({ theme: 'dark' }), 'utf8')
      const dataRoot = await WorkspaceService.resolveDataRoot(tmpConfigDir)
      expect(dataRoot).toBe(tmpConfigDir)
    })

    it('configDir/config.yaml 存在但 workspaceRoot 是空字符串 → dataRoot = configDir', async () => {
      writeFileSync(
        join(tmpConfigDir, 'config.yaml'),
        yaml.stringify({ theme: 'dark', workspaceRoot: '' }),
        'utf8',
      )
      const dataRoot = await WorkspaceService.resolveDataRoot(tmpConfigDir)
      expect(dataRoot).toBe(tmpConfigDir)
    })
  })

  describe('case 4: yaml.workspaceRoot 有 → dataRoot = 字段值', () => {
    it('字段值已是 native 路径 → 原样返回', async () => {
      writeFileSync(
        join(tmpConfigDir, 'config.yaml'),
        yaml.stringify({ workspaceRoot: tmpDataRoot }),
        'utf8',
      )
      const dataRoot = await WorkspaceService.resolveDataRoot(tmpConfigDir)
      expect(dataRoot).toBe(tmpDataRoot)
    })

    it('字段值带尾随空白 → 归一化', async () => {
      writeFileSync(
        join(tmpConfigDir, 'config.yaml'),
        yaml.stringify({ workspaceRoot: `  ${tmpDataRoot}  ` }),
        'utf8',
      )
      const dataRoot = await WorkspaceService.resolveDataRoot(tmpConfigDir)
      expect(dataRoot).toBe(tmpDataRoot)
    })
  })

  describe('case 5 + 6: initWorkspace 双目录分离', () => {
    it('configDir 与 dataRoot 不同时,config.yaml 写 configDir, 子目录建 dataRoot', async () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      await ws.initWorkspace()

      // config.yaml 在 configDir
      expect(existsSync(join(tmpConfigDir, 'config.yaml'))).toBe(true)
      // 子目录在 dataRoot
      expect(existsSync(join(tmpDataRoot, 'requirements'))).toBe(true)
      expect(existsSync(join(tmpDataRoot, 'knowledge'))).toBe(true)
      expect(existsSync(join(tmpDataRoot, 'skills'))).toBe(true)
      expect(existsSync(join(tmpDataRoot, 'analysis-skills'))).toBe(true)
      expect(existsSync(join(tmpDataRoot, 'logs'))).toBe(true)

      // config.yaml 不在 dataRoot(分离)
      expect(existsSync(join(tmpDataRoot, 'config.yaml'))).toBe(false)
    })

    it('seed 时 workspaceRoot = dataRoot', async () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      await ws.initWorkspace()
      const cfg = yaml.parse(readFileSync(join(tmpConfigDir, 'config.yaml'), 'utf8'))
      expect(cfg.workspaceRoot).toBe(tmpDataRoot)
    })
  })

  describe('case 7: getWorkspaceInfo 双字段返回', () => {
    it('拆分模式下 info 同时暴露 configDir + dataRoot + root(=dataRoot 兼容)', async () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      await ws.initWorkspace()
      const info = await ws.getWorkspaceInfo({ diskUsage: false })
      expect(info.configDir).toBe(tmpConfigDir)
      expect(info.dataRoot).toBe(tmpDataRoot)
      expect(info.root).toBe(tmpDataRoot) // backward-compat alias
      expect(info.configPath).toBe(join(tmpConfigDir, 'config.yaml'))
    })
  })

  describe('case 8: validatePath 三档反馈', () => {
    it('路径不存在 → E_WS_ROOT_PATH_NOT_EXISTS', () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath('/nonexistent-aidevspace-12345')
      expect(r.exists).toBe(false)
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    })

    it('空目录 → E_WS_ROOT_PATH_NOT_WORKSPACE', () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath(tmpConfigDir) // 临时创建的空目录
      expect(r.exists).toBe(true)
      expect(r.isWorkspace).toBe(false)
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_WORKSPACE')
    })

    it('含 requirements/ → isWorkspace=true 无 errorCode', () => {
      // 在 tmpDataRoot 建 requirements/ 子目录模拟「旧 workspace 痕迹」
      require('node:fs').mkdirSync(join(tmpDataRoot, 'requirements'), { recursive: true })
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath(tmpDataRoot)
      expect(r.exists).toBe(true)
      expect(r.isWorkspace).toBe(true)
      expect(r.errorCode).toBeUndefined()
    })

    it('仅含 skills/ (超集定义) → isWorkspace=true', () => {
      require('node:fs').mkdirSync(join(tmpDataRoot, 'skills'), { recursive: true })
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath(tmpDataRoot)
      expect(r.isWorkspace).toBe(true)
    })

    it('仅含 analysis-skills/ (超集定义) → isWorkspace=true', () => {
      require('node:fs').mkdirSync(join(tmpDataRoot, 'analysis-skills'), { recursive: true })
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath(tmpDataRoot)
      expect(r.isWorkspace).toBe(true)
    })

    it('空字符串路径 → 不存在', () => {
      const ws = new WorkspaceService(tmpConfigDir, tmpDataRoot)
      const r = ws.validatePath('')
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    })
  })
})