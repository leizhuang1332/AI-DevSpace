import { describe, it, expect } from 'vitest'
import {
  ConfigValueSchema,
  ConfigSchema,
  ConfigPatchSchema,
  WorkspaceInfoSchema,
} from '../workspace.js'

describe('ConfigValueSchema', () => {
  it('接受 string', () => {
    expect(ConfigValueSchema.parse('hello')).toBe('hello')
  })
  it('接受 number', () => {
    expect(ConfigValueSchema.parse(42)).toBe(42)
  })
  it('接受 boolean', () => {
    expect(ConfigValueSchema.parse(true)).toBe(true)
  })
  it('接受 null', () => {
    expect(ConfigValueSchema.parse(null)).toBe(null)
  })
  it('拒绝 object', () => {
    expect(() => ConfigValueSchema.parse({ a: 1 })).toThrow()
  })
  it('拒绝 array', () => {
    expect(() => ConfigValueSchema.parse([1, 2])).toThrow()
  })
  it('拒绝 undefined', () => {
    expect(() => ConfigValueSchema.parse(undefined)).toThrow()
  })
})

describe('ConfigSchema', () => {
  it('接受空对象', () => {
    expect(ConfigSchema.parse({})).toEqual({})
  })
  it('接受带 dotted key 的对象', () => {
    const r = ConfigSchema.parse({ 'ai.provider': 'claude-code', theme: 'dark' })
    expect(r).toEqual({ 'ai.provider': 'claude-code', theme: 'dark' })
  })
  it('拒绝值不是基本类型', () => {
    expect(() => ConfigSchema.parse({ foo: { nested: 1 } })).toThrow()
  })
})

describe('ConfigPatchSchema', () => {
  it('形状与 ConfigSchema 一致（任意子集 key）', () => {
    expect(() => ConfigPatchSchema.parse({ theme: 'light' })).not.toThrow()
    expect(() => ConfigPatchSchema.parse({})).not.toThrow()
    expect(() => ConfigPatchSchema.parse({ unknownKey: 'whatever' })).not.toThrow()
  })
})

describe('WorkspaceInfoSchema', () => {
  it('接受完整 WorkspaceInfo', () => {
    const info = {
      root: '/home/user/.aidevspace',
      exists: true,
      createdAt: 1700000000000,
      subdirs: {
        requirements: true,
        repos: true,
        knowledge: true,
        skills: true,
        logs: true,
      },
      configPath: '/home/user/.aidevspace/config.yaml',
      config: { theme: 'system' },
      gitignorePath: '/home/user/.aidevspace/.gitignore',
      gitignoreExists: true,
      diskUsageBytes: 1024,
    }
    expect(() => WorkspaceInfoSchema.parse(info)).not.toThrow()
  })

  it('root 缺失时报错', () => {
    expect(() => WorkspaceInfoSchema.parse({})).toThrow()
  })

  it('createdAt 可为 null（根目录不存在时）', () => {
    const info = {
      root: '/home/user/.aidevspace',
      exists: false,
      createdAt: null,
      subdirs: {},
      configPath: '/home/user/.aidevspace/config.yaml',
      config: {},
      gitignorePath: '/home/user/.aidevspace/.gitignore',
      gitignoreExists: false,
      diskUsageBytes: 0,
    }
    expect(() => WorkspaceInfoSchema.parse(info)).not.toThrow()
  })

  it('diskUsageBytes 不可为负', () => {
    expect(() =>
      WorkspaceInfoSchema.parse({
        root: '/x', exists: true, createdAt: 0, subdirs: {},
        configPath: '/x/c.yaml', config: {}, gitignorePath: '/x/.gitignore',
        gitignoreExists: false, diskUsageBytes: -1,
      })
    ).toThrow()
  })
})
