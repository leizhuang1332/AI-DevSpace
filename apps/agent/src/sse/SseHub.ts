import type { SseEvent } from '@ai-devspace/shared'
import { SSE_HEARTBEAT_MS } from '@ai-devspace/shared'

export type SseListener = (event: SseEvent) => void
export type Unsubscribe = () => void

/**
 * SseHub —— 通用多通道 SSE fan-out(ADR-0010 Q10.2)
 *
 * "通道"是一个任意字符串 key —— 历史用法以 `reqId` 为 key(P0/P4);
 * P5 起引入"每 session 一条独立通道",callers 直接以 `localSid` 为 key
 * 订阅/发布即可,hub 内部不区分语义。
 *
 * 行为契约:
 *  - `publish(key, event)` 只投递到订阅了同一个 `key` 的 listener;无订阅者 → no-op
 *  - `closeChannel(key)` 移除该 key 所有订阅者(用于 session 关闭时的资源回收)
 *  - `close()` 全局销毁,所有 listener 被清空,定时器停掉
 *  - listener 抛错必须不影响其他 listener(隔离 swallow)
 */
export interface SseHub {
  subscribe(key: string, listener: SseListener): Unsubscribe
  publish(key: string, event: SseEvent): void
  /** 移除某个 key 的所有订阅者(per-session 关闭时调用)。 */
  closeChannel(key: string): void
  close(): Promise<void>
  stats(): { subscribers: number; channels: number }
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

  function subscribe(key: string, listener: SseListener): Unsubscribe {
    if (closed) return () => {}
    let set = channels.get(key)
    if (!set) {
      set = new Set()
      channels.set(key, set)
    }
    set.add(listener)
    ensureHeartbeatRunning()
    return () => {
      const s = channels.get(key)
      if (!s) return
      s.delete(listener)
      if (s.size === 0) channels.delete(key)
      maybeStopHeartbeat()
    }
  }

  function publish(key: string, event: SseEvent): void {
    if (closed) return
    const set = channels.get(key)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch {
        /* swallow */
      }
    }
  }

  function closeChannel(key: string): void {
    const set = channels.get(key)
    if (!set) return
    channels.delete(key)
    maybeStopHeartbeat()
  }

  async function close(): Promise<void> {
    closed = true
    if (heartbeatTimer !== null) {
      scheduler.clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    channels.clear()
  }

  function stats(): { subscribers: number; channels: number } {
    return { subscribers: totalSubscribers(), channels: channels.size }
  }

  return { subscribe, publish, closeChannel, close, stats }
}
