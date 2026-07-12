import { describe, it, expect } from 'vitest'
import { parseCookie } from '../auth/cookie.js'

describe('parseCookie', () => {
  it('reads single cookie from header', () => {
    expect(parseCookie('aidevspace_token=abc123', 'aidevspace_token')).toBe('abc123')
  })

  it('reads cookie among multiple', () => {
    expect(parseCookie('foo=1; bar=2; aidevspace_token=xyz; baz=3', 'aidevspace_token')).toBe('xyz')
  })

  it('returns null when name not present', () => {
    expect(parseCookie('foo=1', 'aidevspace_token')).toBeNull()
  })

  it('returns null for null/undefined header', () => {
    expect(parseCookie(null, 'aidevspace_token')).toBeNull()
    expect(parseCookie(undefined, 'aidevspace_token')).toBeNull()
  })

  it('trims whitespace and ignores empty pairs', () => {
    expect(parseCookie('  ;  aidevspace_token=tok  ;  ', 'aidevspace_token')).toBe('tok')
  })

  it('returns first value when name appears twice', () => {
    expect(parseCookie('aidevspace_token=first; aidevspace_token=second', 'aidevspace_token')).toBe('first')
  })

  it('handles zero-length value', () => {
    expect(parseCookie('aidevspace_token=', 'aidevspace_token')).toBe('')
  })
})
