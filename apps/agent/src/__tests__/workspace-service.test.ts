import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { WorkspaceService } from '../services/WorkspaceService.js'

describe('WorkspaceService.resolveRoot', () => {
  it('AIDEVSPACE_HOME 有值时返回该值', () => {
    expect(WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: '/tmp/custom-home' })).toBe(
      '/tmp/custom-home',
    )
  })

  it('AIDEVSPACE_HOME 为空字符串时退到默认 ~/.aidevspace', () => {
    expect(WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: '' })).toBe(
      join(homedir(), '.aidevspace'),
    )
  })

  it('无 AIDEVSPACE_HOME 时返回 ~/.aidevspace', () => {
    expect(WorkspaceService.resolveRoot({})).toBe(join(homedir(), '.aidevspace'))
  })

  it('调用时不传参走 process.env', () => {
    const original = process.env.AIDEVSPACE_HOME
    process.env.AIDEVSPACE_HOME = '/tmp/from-proc-env'
    try {
      expect(WorkspaceService.resolveRoot()).toBe('/tmp/from-proc-env')
    } finally {
      if (original === undefined) delete process.env.AIDEVSPACE_HOME
      else process.env.AIDEVSPACE_HOME = original
    }
  })

  it('跨平台：用 path.join 而非硬编码 /', () => {
    const r = WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: 'C:\\Users\\me\\aidev' })
    // Windows 路径或 POSIX 都应原样返回（不强行转换）
    expect(r).toBe('C:\\Users\\me\\aidev')
  })
})
