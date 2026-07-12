import { describe, it, expect } from 'vitest'
import { SSE_HEARTBEAT_MS, type SseEvent } from '../sse.js'

describe('sse constants', () => {
  it('exports a 30s heartbeat constant', () => {
    expect(SSE_HEARTBEAT_MS).toBe(30_000)
  })
})

describe('SseEvent type narrowing', () => {
  it('hello event has sid and reqId', () => {
    const e: SseEvent = { type: 'hello', sid: 'x', reqId: 'r', ts: 1 }
    if (e.type === 'hello') {
      expect(e.sid).toBe('x')
      expect(e.reqId).toBe('r')
    } else {
      throw new Error('expected hello')
    }
  })

  it('heartbeat event has only ts', () => {
    const e: SseEvent = { type: 'heartbeat', ts: 1 }
    if (e.type === 'heartbeat') expect(e.ts).toBe(1)
  })

  it('placeholder event has message', () => {
    const e: SseEvent = { type: 'placeholder', message: 'no events yet' }
    if (e.type === 'placeholder') expect(e.message).toBe('no events yet')
  })
})
