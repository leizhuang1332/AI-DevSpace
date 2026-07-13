/**
 * pathUtil tests
 */

import { describe, it, expect } from 'vitest'
import { posixJoin } from '../worktree/pathUtil.js'

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
})