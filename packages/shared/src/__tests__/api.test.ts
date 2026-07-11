import { describe, it, expect } from 'vitest'
import {
  NotImplementedError,
  ApiError,
  BootstrapResponse,
  ApiErrorCode,
} from '../api.js'

describe('NotImplementedError', () => {
  it('parses valid 501 body', () => {
    const r = NotImplementedError.safeParse({
      error: 'not_implemented',
      feature: 'requirement.create',
      message: 'pending',
      issue: '05',
    })
    expect(r.success).toBe(true)
  })

  it('rejects missing feature', () => {
    const r = NotImplementedError.safeParse({
      error: 'not_implemented',
      message: 'p',
      issue: '05',
    })
    expect(r.success).toBe(false)
  })
})

describe('ApiError', () => {
  it('parses minimal shape', () => {
    const r = ApiError.safeParse({ error: 'unauthorized' })
    expect(r.success).toBe(true)
  })

  it('rejects non-string error', () => {
    const r = ApiError.safeParse({ error: 123 })
    expect(r.success).toBe(false)
  })
})

describe('BootstrapResponse', () => {
  it('accepts full payload', () => {
    const r = BootstrapResponse.safeParse({
      ok: true,
      token: 'a'.repeat(43),  // 32-byte random base64url token, length 43
      cookieName: 'aidevspace_token',
      cookieAttributes: { SameSite: 'Strict', Path: '/', MaxAge: 2592000 },
      apiBase: 'http://localhost:7777',
      agentVersion: '0.0.0',
      sseNote: 'use cookie',
    })
    expect(r.success).toBe(true)
  })
})

describe('ApiErrorCode', () => {
  it('includes canonical codes', () => {
    expect(ApiErrorCode.unauthorized).toBe('unauthorized')
    expect(ApiErrorCode.origin_not_allowed).toBe('origin_not_allowed')
    expect(ApiErrorCode.not_implemented).toBe('not_implemented')
    expect(ApiErrorCode.internal).toBe('internal')
  })
})
