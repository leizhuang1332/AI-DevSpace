/**
 * pathUtil tests
 */

import { describe, it, expect } from 'vitest'
import { posixJoin, toPosixPath } from '../worktree/pathUtil.js'

describe('posixJoin', () => {
  it('joins segments with /', () => {
    expect(posixJoin('/a', 'b', 'c')).toBe('/a/b/c')
  })

  it('always returns absolute path (leading slash)', () => {
    expect(posixJoin('a', 'b')).toBe('/a/b')
  })

  it('collapses double slashes', () => {
    expect(posixJoin('/a/', '/b')).toBe('/a/b')
  })

  it('ignores empty segments and "."', () => {
    expect(posixJoin('/a', '', '.', 'b')).toBe('/a/b')
  })

  it('resolves ..', () => {
    expect(posixJoin('/a', 'b', '..', 'c')).toBe('/a/c')
  })

  it('handles Windows drive-letter absolute path (C:\\...)', () => {
    // 关键回归:mkdtempSync 在 Windows 上返回 `C:\Users\...\Temp\xxx`,
    // 旧的 posixJoin 简单 prepend `/` 会得到 `/C:/Users/...`(不存在),
    // 导致 existsSync 失败。新实现把 drive letter 转成 `/c/...` 形态。
    expect(posixJoin('C:\\Users\\test\\Temp\\aidevsp', 'repos', 'a')).toBe(
      '/c/Users/test/Temp/aidevsp/repos/a',
    )
  })

  it('handles Windows drive-letter with mixed separators', () => {
    expect(posixJoin('C:/Users/test', 'repos', 'a')).toBe(
      '/c/Users/test/repos/a',
    )
  })
})

describe('toPosixPath', () => {
  it('converts POSIX native path (unchanged)', () => {
    expect(toPosixPath('/fake/aidevspace/repos/a')).toBe('/fake/aidevspace/repos/a')
  })

  it('converts Windows native path with backslashes', () => {
    expect(toPosixPath('C:\\Users\\test\\Temp\\aidevsp\\repos\\a')).toBe(
      '/c/Users/test/Temp/aidevsp/repos/a',
    )
  })

  it('converts Windows native path with forward slashes', () => {
    expect(toPosixPath('C:/Users/test/repos/a')).toBe('/c/Users/test/repos/a')
  })

  it('handles empty input', () => {
    expect(toPosixPath('')).toBe('/')
  })
})