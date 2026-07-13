import { describe, expect, it } from 'vitest'
import { classifyError } from '../error/ErrorClassifier.js'

describe('classifyError', () => {
  it.each([
    [{ status: 429, type: 'rate_limit_error', message: 'slow down' }, 'A'],
    [{ code: 'rate_limit', message: 'SDK rate limit' }, 'A'],
    [{ status: 503, type: 'api_error', message: 'unavailable' }, 'A'],
    [{ code: 'API_TIMEOUT', message: 'API request timed out' }, 'A'],
    [{ status: 401, type: 'authentication_error', message: 'bad key' }, 'B'],
    [{ status: 403, type: 'billing_error', message: 'quota exhausted' }, 'B'],
    [{ status: 400, type: 'invalid_request_error', message: 'bad request' }, 'B'],
    [{ code: 'ENOENT', syscall: 'spawn claude', message: 'spawn failed' }, 'C'],
    [{ exitCode: 7, message: 'CLI exited' }, 'C'],
    [{ code: 'ECONNRESET', message: 'socket closed' }, 'D'],
    [{ code: 'error_max_turns', message: 'max turns reached' }, 'E'],
  ])('classifies %j as %s', (error, category) => {
    expect(classifyError(error).category).toBe(category)
  })

  it('treats quota 429 as permanent before generic rate-limit matching', () => {
    expect(classifyError({ status: 429, type: 'billing_error', message: 'out of credits' })).toMatchObject({
      category: 'B', retryable: false, maxRetries: 0,
    })
  })

  it('classifies AbortError and an aborted signal as cancelled', () => {
    expect(classifyError(new DOMException('stopped', 'AbortError')).category).toBe('cancelled')
    const controller = new AbortController()
    controller.abort('user')
    expect(classifyError(new Error('anything'), controller.signal).category).toBe('cancelled')
  })

  it('walks cause and defaults unknown failures to B', () => {
    expect(classifyError(new Error('outer', { cause: { code: 'ECONNREFUSED' } })).category).toBe('D')
    expect(classifyError(new Error('mystery'))).toMatchObject({ category: 'B', retryable: false })
  })
})
