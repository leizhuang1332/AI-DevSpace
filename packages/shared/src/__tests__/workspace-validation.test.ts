import { describe, it, expect } from 'vitest'
import {
  validateWorkspaceRootPure,
  type WorkspaceValidation,
} from '../workspace-validation.js'

/**
 * validateWorkspaceRootPure 是**纯函数**——不需要 fs / tmp 目录,
 * 测试只覆盖三档映射 + 边界。
 */

describe('validateWorkspaceRootPure', () => {
  describe('空路径', () => {
    it('空字符串 → 不存在', () => {
      const r = validateWorkspaceRootPure({
        path: '',
        exists: false,
        hasAnyTrace: false,
      })
      expect(r).toEqual<WorkspaceValidation>({
        exists: false,
        isWorkspace: false,
        errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS',
      })
    })

    it('纯空白 → 不存在', () => {
      const r = validateWorkspaceRootPure({
        path: '   ',
        exists: false,
        hasAnyTrace: false,
      })
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    })
  })

  describe('路径不存在', () => {
    it('exists=false → 不存在', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/nonexistent-aidevspace',
        exists: false,
        hasAnyTrace: false,
      })
      expect(r).toEqual<WorkspaceValidation>({
        exists: false,
        isWorkspace: false,
        errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS',
      })
    })

    it('exists=false 优先于 hasAnyTrace(防御性: 不应同时为 true)', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/whatever',
        exists: false,
        hasAnyTrace: true,
      })
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
    })
  })

  describe('路径存在但无 workspace 痕迹', () => {
    it('空目录 → 无痕迹', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/empty-dir',
        exists: true,
        hasAnyTrace: false,
      })
      expect(r).toEqual<WorkspaceValidation>({
        exists: true,
        isWorkspace: false,
        errorCode: 'E_WS_ROOT_PATH_NOT_WORKSPACE',
      })
    })

    it('只含随机子目录(如 .git) → 无痕迹', () => {
      // 模拟 fs caller 已扫过 WORKSPACE_TRACE_DIRS 全部不存在
      const r = validateWorkspaceRootPure({
        path: '/tmp/random-dir',
        exists: true,
        hasAnyTrace: false,
      })
      expect(r.errorCode).toBe('E_WS_ROOT_PATH_NOT_WORKSPACE')
      expect(r.exists).toBe(true)
      expect(r.isWorkspace).toBe(false)
    })
  })

  describe('路径存在且有 workspace 痕迹', () => {
    it('hasAnyTrace=true → 接管', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/has-requirements',
        exists: true,
        hasAnyTrace: true,
      })
      expect(r).toEqual<WorkspaceValidation>({
        exists: true,
        isWorkspace: true,
      })
      expect(r.errorCode).toBeUndefined()
    })

    it('仅含 knowledge(超集定义生效)→ 接管', () => {
      // 模拟 fs caller 仅扫到 knowledge/ 一个目录
      const r = validateWorkspaceRootPure({
        path: '/tmp/has-knowledge-only',
        exists: true,
        hasAnyTrace: true,
      })
      expect(r.isWorkspace).toBe(true)
      expect(r.errorCode).toBeUndefined()
    })

    it('仅含 skills → 接管', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/has-skills-only',
        exists: true,
        hasAnyTrace: true,
      })
      expect(r.isWorkspace).toBe(true)
    })

    it('仅含 analysis-skills → 接管', () => {
      const r = validateWorkspaceRootPure({
        path: '/tmp/has-analysis-skills-only',
        exists: true,
        hasAnyTrace: true,
      })
      expect(r.isWorkspace).toBe(true)
    })
  })

  describe('三档优先级', () => {
    it('happy path 完整链路: 空 → 不存在 → 无痕迹 → 有痕迹', () => {
      expect(
        validateWorkspaceRootPure({ path: '', exists: false, hasAnyTrace: false })
          .errorCode,
      ).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
      expect(
        validateWorkspaceRootPure({ path: '/p', exists: false, hasAnyTrace: false })
          .errorCode,
      ).toBe('E_WS_ROOT_PATH_NOT_EXISTS')
      expect(
        validateWorkspaceRootPure({ path: '/p', exists: true, hasAnyTrace: false })
          .errorCode,
      ).toBe('E_WS_ROOT_PATH_NOT_WORKSPACE')
      expect(
        validateWorkspaceRootPure({ path: '/p', exists: true, hasAnyTrace: true })
          .errorCode,
      ).toBeUndefined()
    })
  })
})