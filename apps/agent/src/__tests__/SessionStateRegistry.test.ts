/**
 * SessionStateRegistry tests —— ADR-0010 Q10.4 + 决策 49 StatusBar 4 指示器
 *
 * 覆盖:
 *  - get(localSid):活 session 快照(state + recentWrites)
 *  - recordWrite(localSid):窗口内累加,窗口外重置
 *  - statusBar():4 指示器聚合(stateCounts/pending/queued/recentWrites)
 *  - providerSemaphore 集成:queued 取自 limiter.stats()
 */

import { describe, it, expect } from 'vitest'
import { SessionStateRegistry } from '../session/SessionStateRegistry.js'
import { ProviderSemaphore } from '../error/ProviderSemaphore.js'
import type { AISession } from '../providers/AIProvider.js'

function fakeSession(id: string, reqId: string, state: AISession['state']): AISession {
  return {
    id,
    reqId,
    kind: 'chat',
    topic: 'test',
    state,
    sdkSessionId: undefined,
    model: undefined,
    events: () => {
      throw new Error('not used in this test')
    },
    send: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    close: () => Promise.resolve(),
  }
}

describe('SessionStateRegistry', () => {
  it('get() returns null for unknown localSid', () => {
    const reg = new SessionStateRegistry()
    expect(reg.get('ghost')).toBeNull()
  })

  it('get() reflects the AISession.state at read time', () => {
    const reg = new SessionStateRegistry()
    const s = fakeSession('s1', 'REQ-001', 'busy')
    reg.register(s)
    expect(reg.get('s1')).toMatchObject({ localSid: 's1', reqId: 'REQ-001', state: 'busy', recentWrites: 0 })
  })

  it('get() picks up state changes via the AISession ref (live snapshot)', () => {
    const reg = new SessionStateRegistry()
    const s = fakeSession('s1', 'REQ-001', 'idle')
    reg.register(s)
    // 模拟外部把 state 改掉 —— registry 应该读出来新值
    ;(s as { state: AISession['state'] }).state = 'busy'
    expect(reg.get('s1')?.state).toBe('busy')
  })

  it('unregister() removes both session and writes', () => {
    const reg = new SessionStateRegistry()
    const s = fakeSession('s1', 'REQ-001', 'idle')
    reg.register(s)
    reg.recordWrite('s1')
    reg.unregister('s1')
    expect(reg.get('s1')).toBeNull()
  })

  it('recordWrite() accumulates within window, resets after', () => {
    let now = 1_000_000
    const reg = new SessionStateRegistry({ nowMs: () => now, recentWritesWindowMs: 1000 })
    const s = fakeSession('s1', 'REQ-001', 'idle')
    reg.register(s)
    reg.recordWrite('s1')
    reg.recordWrite('s1')
    reg.recordWrite('s1')
    expect(reg.get('s1')?.recentWrites).toBe(3)
    now += 1500 // 跨过窗口
    expect(reg.get('s1')?.recentWrites).toBe(0)
  })

  it('statusBar() aggregates stateCounts + pending + queued + recentWrites', () => {
    let now = 1_000_000
    const sem = new ProviderSemaphore({ limit: 5 })
    const reg = new SessionStateRegistry({ nowMs: () => now, providerSemaphore: sem })

    const a = fakeSession('s1', 'REQ-001', 'busy')
    const b = fakeSession('s2', 'REQ-001', 'busy')
    const c = fakeSession('s3', 'REQ-001', 'idle')
    reg.register(a); reg.register(b); reg.register(c)
    reg.recordWrite('s1')
    reg.recordWrite('s2')

    const snap = reg.statusBar()
    expect(snap.stateCounts).toEqual({ idle: 1, busy: 2, closed: 0, errored: 0 })
    expect(snap.pending).toBe(2) // busy 数
    expect(snap.queued).toBe(0)  // sem 没人排队
    expect(snap.recentWrites).toBe(2)
  })

  it('statusBar() reads queued from providerSemaphore.stats()', () => {
    // 模拟 queue:占住 1 个 slot,第二个进入 queue,queueDepth = 1
    const sem = new ProviderSemaphore({ limit: 1 })
    const reg = new SessionStateRegistry({ providerSemaphore: sem })
    // 启动一个无限期挂起的 op 占住 slot(不持有 release,close 收拾)
    void sem.run(() => new Promise<void>(() => {}))
    // 第 2 个请求进入 queue
    const queued = sem.run(() => new Promise<void>(() => {}))
    expect(reg.statusBar().queued).toBe(1)
    sem.close() // 拒绝所有 waiter + 清 slot
    void queued.catch(() => {})
  })

  it('statusBar() survives closed providerSemaphore (no throw)', () => {
    const sem = new ProviderSemaphore({ limit: 5 })
    sem.close()
    const reg = new SessionStateRegistry({ providerSemaphore: sem })
    expect(() => reg.statusBar()).not.toThrow()
    expect(reg.statusBar().queued).toBe(0)
  })

  it('listActive() exposes registered localSids', () => {
    const reg = new SessionStateRegistry()
    reg.register(fakeSession('s1', 'REQ-001', 'idle'))
    reg.register(fakeSession('s2', 'REQ-001', 'busy'))
    expect(reg.listActive().sort()).toEqual(['s1', 's2'])
  })
})