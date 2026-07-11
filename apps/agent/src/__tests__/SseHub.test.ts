import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createSseHub } from '../sse/SseHub.js'
import type { SseEvent } from '@ai-devspace/shared'

describe('createSseHub', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a published event to a subscriber', () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    hub.subscribe('r1', (e) => received.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(received).toEqual([{ type: 'heartbeat', ts: 1 }])
  })

  it('does not deliver to subscribers of a different reqId', () => {
    const hub = createSseHub()
    const r1: SseEvent[] = []
    const r2: SseEvent[] = []
    hub.subscribe('r1', (e) => r1.push(e))
    hub.subscribe('r2', (e) => r2.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(0)
  })

  it('unsubscribe stops future deliveries', () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    const unsub = hub.subscribe('r1', (e) => received.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    unsub()
    hub.publish('r1', { type: 'heartbeat', ts: 2 })
    expect(received).toEqual([{ type: 'heartbeat', ts: 1 }])
  })

  it('does not start heartbeat timer when no subscribers', () => {
    const hub = createSseHub()
    expect(hub.stats().subscribers).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(hub.stats().subscribers).toBe(0)
  })

  it('sends heartbeat to all subscribers of a reqId', () => {
    const hub = createSseHub()
    const a: SseEvent[] = []
    const b: SseEvent[] = []
    hub.subscribe('r1', (e) => a.push(e))
    hub.subscribe('r1', (e) => b.push(e))
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(a).toHaveLength(1)
    expect(b).toHaveLength(1)
  })

  it('returns subscriber count from stats', () => {
    const hub = createSseHub()
    expect(hub.stats().subscribers).toBe(0)
    const u1 = hub.subscribe('r1', () => {})
    expect(hub.stats().subscribers).toBe(1)
    const u2 = hub.subscribe('r2', () => {})
    expect(hub.stats().subscribers).toBe(2)
    u1()
    expect(hub.stats().subscribers).toBe(1)
    u2()
    expect(hub.stats().subscribers).toBe(0)
  })

  it('close() removes all subscribers and stops timers', async () => {
    const hub = createSseHub()
    const received: SseEvent[] = []
    hub.subscribe('r1', (e) => received.push(e))
    await hub.close()
    expect(hub.stats().subscribers).toBe(0)
    hub.publish('r1', { type: 'heartbeat', ts: 1 })
    expect(received).toHaveLength(0)
  })

  it('does not throw on publish to reqId with no subscribers', () => {
    const hub = createSseHub()
    expect(() => hub.publish('none', { type: 'heartbeat', ts: 1 })).not.toThrow()
  })
})
