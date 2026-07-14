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

  it('tracks channel count in stats', () => {
    const hub = createSseHub()
    expect(hub.stats().channels).toBe(0)
    const u1 = hub.subscribe('r1', () => {})
    const u2 = hub.subscribe('r1', () => {})
    const u3 = hub.subscribe('r2', () => {})
    expect(hub.stats().channels).toBe(2)
    u1()
    expect(hub.stats().channels).toBe(2)
    u2()
    u3()
    expect(hub.stats().channels).toBe(0)
  })

  it('closeChannel removes all subscribers for that key only', () => {
    const hub = createSseHub()
    const a: SseEvent[] = []
    const b: SseEvent[] = []
    hub.subscribe('s1', (e) => a.push(e))
    hub.subscribe('s1', (e) => b.push(e))
    hub.subscribe('s2', () => {})
    expect(hub.stats().channels).toBe(2)
    expect(hub.stats().subscribers).toBe(3)
    hub.closeChannel('s1')
    expect(hub.stats().channels).toBe(1)
    expect(hub.stats().subscribers).toBe(1)
    hub.publish('s1', { type: 'heartbeat', ts: 1 })
    expect(a).toHaveLength(0)
    expect(b).toHaveLength(0)
  })

  it('closeChannel stops heartbeat when last channel closes', () => {
    const setIntervalSpy = vi.fn(
      () => 0 as unknown as NodeJS.Timeout,
    ) as unknown as typeof setInterval
    const clearIntervalSpy = vi.fn() as unknown as typeof clearInterval
    const hub = createSseHub({
      scheduler: { setInterval: setIntervalSpy, clearInterval: clearIntervalSpy },
      heartbeatMs: 30_000,
    })
    hub.subscribe('s1', () => {})
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    hub.closeChannel('s1')
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('closeChannel on unknown key is a no-op', () => {
    const hub = createSseHub()
    expect(() => hub.closeChannel('does-not-exist')).not.toThrow()
    expect(hub.stats().channels).toBe(0)
  })

  it('per-session key works as a first-class channel (Q10.2 N SSE)', () => {
    // N 个 session 各开独立通道,事件互不串台(Q10.2 验收)
    const hub = createSseHub()
    const s1: SseEvent[] = []
    const s2: SseEvent[] = []
    const s3: SseEvent[] = []
    const u1 = hub.subscribe('session-aaa', (e) => s1.push(e))
    const u2 = hub.subscribe('session-bbb', (e) => s2.push(e))
    const u3 = hub.subscribe('session-ccc', (e) => s3.push(e))
    hub.publish('session-bbb', { type: 'heartbeat', ts: 1 })
    expect(s1).toHaveLength(0)
    expect(s2).toHaveLength(1)
    expect(s3).toHaveLength(0)
    // 关闭 session-bbb → 仅清掉自己的订阅者,s1/s3 不受影响
    hub.closeChannel('session-bbb')
    expect(hub.stats().channels).toBe(2)
    expect(hub.stats().subscribers).toBe(2)
    u1(); u2(); u3()
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

  it('does not call scheduler.setInterval when no subscribers (lazy heartbeat)', () => {
    const setIntervalSpy = vi.fn(
      () => 0 as unknown as NodeJS.Timeout,
    ) as unknown as typeof setInterval
    const clearIntervalSpy = vi.fn() as unknown as typeof clearInterval
    const hub = createSseHub({
      scheduler: { setInterval: setIntervalSpy, clearInterval: clearIntervalSpy },
      heartbeatMs: 30_000,
    })
    expect(setIntervalSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(hub.stats().subscribers).toBe(0)
  })

  it('starts heartbeat after first subscribe', () => {
    const setIntervalSpy = vi.fn(
      () => 0 as unknown as NodeJS.Timeout,
    ) as unknown as typeof setInterval
    const clearIntervalSpy = vi.fn() as unknown as typeof clearInterval
    const hub = createSseHub({
      scheduler: { setInterval: setIntervalSpy, clearInterval: clearIntervalSpy },
      heartbeatMs: 30_000,
    })
    expect(setIntervalSpy).not.toHaveBeenCalled()
    hub.subscribe('r1', () => {})
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)
  })

  it('delivers heartbeat event to subscribers when timer fires', () => {
    const received: SseEvent[] = []
    const hub = createSseHub({ heartbeatMs: 30_000 })
    hub.subscribe('r1', (e) => received.push(e))
    expect(received).toHaveLength(0)
    vi.advanceTimersByTime(30_000)
    expect(received).toHaveLength(1)
    const ev = received[0]
    expect(ev.type).toBe('heartbeat')
    if (ev.type === 'heartbeat') {
      expect(typeof ev.ts).toBe('number')
    }
  })
})
