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

  it('analysis_chunk event carries reqId/sessionId/chunk(issue 19b SSE 推送)', () => {
    const e: SseEvent = {
      type: 'analysis_chunk',
      reqId: 'req-001',
      sessionId: 'sess-arch',
      ts: 1718000000000,
      chunk: {
        id: 'c-18',
        ts: '14:23:20',
        label: 'INFER',
        kind: 'narration',
        tone: 'info',
        text: '基于用户插话补充:退款限额的合规边界...',
      },
    }
    if (e.type === 'analysis_chunk') {
      expect(e.reqId).toBe('req-001')
      expect(e.sessionId).toBe('sess-arch')
      expect(e.chunk.id).toBe('c-18')
      expect(e.chunk.kind).toBe('narration')
      expect(e.chunk.text).toContain('合规边界')
    } else {
      throw new Error('expected analysis_chunk')
    }
  })
})
