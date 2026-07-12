import type { SseEvent } from '@ai-devspace/shared'
import { SSE_HEARTBEAT_MS } from '@ai-devspace/shared'

export type SseListener = (event: SseEvent) => void
export type Unsubscribe = () => void

export interface SseHub {
  subscribe(reqId: string, listener: SseListener): Unsubscribe
  publish(reqId: string, event: SseEvent): void
  close(): Promise<void>
  stats(): { subscribers: number }
}

export interface SseScheduler {
  setInterval(handler: () => void, ms: number): NodeJS.Timeout
  clearInterval(handle: NodeJS.Timeout): void
}

export interface CreateSseHubOptions {
  heartbeatMs?: number
  /** Injectable timer functions for tests. Defaults to global setInterval/clearInterval. */
  scheduler?: SseScheduler
}

const defaultScheduler: SseScheduler = {
  setInterval: ((handler: () => void, ms: number) =>
    setInterval(handler, ms) as unknown as NodeJS.Timeout) as SseScheduler['setInterval'],
  clearInterval: ((handle: NodeJS.Timeout) =>
    clearInterval(handle as unknown as ReturnType<typeof setInterval>)) as SseScheduler['clearInterval'],
}

export function createSseHub(opts: CreateSseHubOptions = {}): SseHub {
  const channels = new Map<string, Set<SseListener>>()
  const heartbeatMs = opts.heartbeatMs ?? SSE_HEARTBEAT_MS
  const scheduler = opts.scheduler ?? defaultScheduler
  let heartbeatTimer: NodeJS.Timeout | null = null
  let closed = false

  function totalSubscribers(): number {
    let n = 0
    for (const set of channels.values()) n += set.size
    return n
  }

  function ensureHeartbeatRunning(): void {
    if (heartbeatTimer !== null) return
    heartbeatTimer = scheduler.setInterval(() => {
      const ts = Date.now()
      const ev: SseEvent = { type: 'heartbeat', ts }
      for (const set of channels.values()) {
        for (const listener of set) {
          try {
            listener(ev)
          } catch {
            /* listener errors must not break others */
          }
        }
      }
    }, heartbeatMs)
    // Allow Node to exit even if timer is referenced
    heartbeatTimer.unref?.()
  }

  function maybeStopHeartbeat(): void {
    if (heartbeatTimer !== null && totalSubscribers() === 0) {
      scheduler.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function subscribe(reqId: string, listener: SseListener): Unsubscribe {
    if (closed) return () => {}
    let set = channels.get(reqId)
    if (!set) {
      set = new Set()
      channels.set(reqId, set)
    }
    set.add(listener)
    ensureHeartbeatRunning()
    return () => {
      const s = channels.get(reqId)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) channels.delete(reqId)
      maybeStopHeartbeat()
    }
  }

  function publish(reqId: string, event: SseEvent): void {
    if (closed) return
    const set = channels.get(reqId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        /* swallow */
      }
    }
  }

  async function close(): Promise<void> {
    closed = true
    if (heartbeatTimer !== null) {
      scheduler.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    channels.clear()
  }

  function stats(): { subscribers: number } {
    return { subscribers: totalSubscribers() }
  }

  return { subscribe, publish, close, stats }
}
