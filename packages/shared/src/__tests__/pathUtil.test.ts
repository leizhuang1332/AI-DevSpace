import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { platform } from 'node:process'
import { normalizeWorkspaceRoot } from '../pathUtil.js'

/**
 * normalizeWorkspaceRoot —— win32 平台把 Git Bash mingw 风格 `/<letter>/...`
 * 归一化为 `<Letter>:\...`;POSIX 上是 no-op。
 *
 * 跨平台测试策略:
 * - 在 win32 上跑 → 跑全部 case(含归一化)
 * - 在 POSIX 上跑 → 跳过归一化 case,只断言 no-op 行为
 *
 * 实现:用 `Object.defineProperty(process, 'platform', ...)` 在 case 间切换
 * 测试视角(模拟 win32 on POSIX runner,或反之)。
 */
const ORIGINAL_PLATFORM = platform

function stubPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true })
}

describe('normalizeWorkspaceRoot', () => {
  afterEach(() => {
    stubPlatform(ORIGINAL_PLATFORM)
  })

  describe('win32 平台', () => {
    beforeEach(() => {
      stubPlatform('win32')
    })

    it('把 /c/Users/Lorcan/.aidevspace 归一化为 C:\\Users\\Lorcan\\.aidevspace', () => {
      expect(normalizeWorkspaceRoot('/c/Users/Lorcan/.aidevspace')).toBe(
        'C:\\Users\\Lorcan\\.aidevspace',
      )
    })

    it('把 /d/foo 归一化为 D:\\foo', () => {
      expect(normalizeWorkspaceRoot('/d/foo')).toBe('D:\\foo')
    })

    it('盘符小写 /d 归一化为大写 D', () => {
      expect(normalizeWorkspaceRoot('/d/Users/foo')).toBe('D:\\Users\\foo')
    })

    it('盘符大写 /D 同样归一化为 D(统一大写)', () => {
      expect(normalizeWorkspaceRoot('/D/Users/foo')).toBe('D:\\Users\\foo')
    })

    it('多层嵌套路径全部 \\ 分隔', () => {
      expect(normalizeWorkspaceRoot('/c/Users/Lorcan/.aidevspace/requirements')).toBe(
        'C:\\Users\\Lorcan\\.aidevspace\\requirements',
      )
    })

    it('已经是 Windows 原生路径 C:\\foo 原样返回(无双重转义)', () => {
      expect(normalizeWorkspaceRoot('C:\\Users\\me\\aidev')).toBe('C:\\Users\\me\\aidev')
    })

    it('已经是 Windows 原生路径 C:/foo 原样返回', () => {
      expect(normalizeWorkspaceRoot('C:/Users/me/aidev')).toBe('C:/Users/me/aidev')
    })

    it('/tmp/foo 不是 mingw 风格(不匹配 ^/[a-zA-Z]/)→ 原样返回', () => {
      // /tmp 后跟 p 不是 [a-zA-Z] 单字母 → 不归一化,避免误把 /tmp 当 /t/mp 路径
      // 实际上正则要求 /[a-zA-Z]/,而 /tmp 是 /t/mp,/t 后面是 m 不是 /,匹配不上
      expect(normalizeWorkspaceRoot('/tmp/foo')).toBe('/tmp/foo')
    })

    it('/foo 不是 mingw 风格(无字母盘符)→ 原样返回', () => {
      expect(normalizeWorkspaceRoot('/foo')).toBe('/foo')
    })

    it('空字符串原样返回', () => {
      expect(normalizeWorkspaceRoot('')).toBe('')
    })

    it('~/foo 不归一化(expandHome 由调用方负责)', () => {
      expect(normalizeWorkspaceRoot('~/foo')).toBe('~/foo')
    })
  })

  describe('POSIX 平台', () => {
    beforeEach(() => {
      stubPlatform('linux')
    })

    it('POSIX 上 /c/Users/foo 原样返回(no-op)', () => {
      expect(normalizeWorkspaceRoot('/c/Users/foo')).toBe('/c/Users/foo')
    })

    it('POSIX 上 /tmp/foo 原样返回', () => {
      expect(normalizeWorkspaceRoot('/tmp/foo')).toBe('/tmp/foo')
    })

    it('POSIX 上空字符串原样返回', () => {
      expect(normalizeWorkspaceRoot('')).toBe('')
    })
  })
})