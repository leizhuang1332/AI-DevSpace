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

  it('analysis_run_created event carries runId/skillName/createdAt(issue 02 SSE 推送)', () => {
    const e: SseEvent = {
      type: 'analysis_run_created',
      reqId: 'req-001',
      runId: 'run-1',
      ts: 1718000000000,
      skillName: 'prd-completeness',
      createdAt: '2026-08-01T10:00:00.000Z',
    }
    if (e.type === 'analysis_run_created') {
      expect(e.reqId).toBe('req-001')
      expect(e.runId).toBe('run-1')
      expect(e.skillName).toBe('prd-completeness')
    } else {
      throw new Error('expected analysis_run_created')
    }
  })
})