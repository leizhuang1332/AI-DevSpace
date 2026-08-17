import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { platform } from 'node:process'
import { WorkspaceService } from '../services/WorkspaceService.js'

/**
 * 在 win32 视角下复现 Git Bash 用户
 * `export AIDEVSPACE_HOME=$HOME/.aidevspace`(=/c/Users/Lorcan/.aidevspace)
 * 的真实场景 —— 不归一化会让 Node.js path.join 把开头 / 当 drive-relative,
 * 与 git.exe 落点错位到 <cwd_drive>:\c\...。详见 packages/shared/pathUtil.ts。
 */
const ORIGINAL_PLATFORM = platform
function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('WorkspaceService.resolveRoot', () => {
  afterEach(() => {
    stubPlatform(ORIGINAL_PLATFORM)
  })

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

  // ---- mingw path 归一化(win32 视角)----
  describe('win32 视角下 mingw 路径归一化', () => {
    beforeEach(() => {
      stubPlatform('win32')
    })

    it('/c/Users/me/aidev → C:\\Users\\me\\aidev', () => {
      expect(
        WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: '/c/Users/me/aidev' }),
      ).toBe('C:\\Users\\me\\aidev')
    })

    it('/c/Users/Lorcan/.aidevspace → C:\\Users\\Lorcan\\.aidevspace(本 bug 场景)', () => {
      expect(
        WorkspaceService.resolveRoot({
          AIDEVSPACE_HOME: '/c/Users/Lorcan/.aidevspace',
        }),
      ).toBe('C:\\Users\\Lorcan\\.aidevspace')
    })

    it('盘符大写 /D/Users/foo 同样归一化为 D:\\Users\\foo', () => {
      expect(
        WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: '/D/Users/foo' }),
      ).toBe('D:\\Users\\foo')
    })

    it('Windows 原生 C:\\Users\\me\\aidev 原样返回(不双重转义)', () => {
      // 回归:已有 native 路径必须不被 normalize 误伤
      expect(
        WorkspaceService.resolveRoot({ AIDEVSPACE_HOME: 'C:\\Users\\me\\aidev' }),
      ).toBe('C:\\Users\\me\\aidev')
    })
  })
})
