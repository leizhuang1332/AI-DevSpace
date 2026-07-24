import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../server.js'
import type { AIProvider, AISession, CreateSessionOptions } from '../providers/AIProvider.js'
import type { AIEvent } from '../providers/AIEvent.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length) {
    const fn = cleanups.pop()!
    await fn()
  }
})

/**
 * ticket 01 (ADR-0020 D8):start handler 真接 SDK,e2e 必须用 fake provider 避免
 * CI 触发真 SDK 子进程。fake provider 每个 turn emit 1 条 text + done,
 * 让 e2e 能验 SSE / jsonl 路径。契约放宽:chunks ≥ 1(不再是旧 mock 的 5 行)
 */
function fakeProviderForE2E(): AIProvider {
  return {
    name: 'fake-e2e',
    async createSession(_reqId, o: CreateSessionOptions): Promise<AISession> {
      const subs = new Set<{
        queue: AIEvent[]
        pending: Array<(v: IteratorResult<AIEvent>) => void>
        closed: boolean
      }>()
      const push = (ev: AIEvent): void => {
        for (const s of subs) {
          if (s.closed) continue
          const r = s.pending.shift()
          if (r) r({ value: ev, done: false })
          else s.queue.push(ev)
        }
      }
      const closeAll = (): void => {
        for (const s of subs) {
          if (s.closed) continue
          s.closed = true
          while (s.pending.length) s.pending.shift()!({ value: undefined, done: true })
        }
      }
      const toAsyncIter = () => {
        const sub = {
          queue: [] as AIEvent[],
          pending: [] as Array<(v: IteratorResult<AIEvent>) => void>,
          closed: false,
        }
        subs.add(sub)
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => new Promise<IteratorResult<AIEvent>>((resolve) => {
              const head = sub.queue.shift()
              if (head !== undefined) resolve({ value: head, done: false })
              else if (sub.closed) resolve({ value: undefined, done: true })
              else sub.pending.push(resolve)
            }),
            return: async () => {
              sub.closed = true
              return { value: undefined, done: true }
            },
          }),
        }
      }
      return {
        id: o.localSid ?? 'fake-e2e-sid',
        reqId: _reqId,
        kind: o.kind,
        topic: o.topic,
        state: 'idle',
        sdkSessionId: 'fake-e2e-sdk',
        model: undefined,
        events: () => toAsyncIter(),
        async send() {
          // 每个 turn 推 1 条 text + done
          push({ type: 'text', text: 'fake e2e output', delta: false })
          push({ type: 'done', reason: 'end_turn', sessionId: 'fake-e2e-sdk' })
          closeAll()
        },
        async cancel() { closeAll() },
        async close() { closeAll() },
      }
    },
    async shutdown() {},
  }
}

async function boot(): Promise<{ url: string; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'aidevsp-e2e-'))
  writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
  const app = await buildServer({
    workspaceRoot: root,
    logFilePath: join(root, 'agent.log'),
    provider: fakeProviderForE2E(),
  })
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  cleanups.push(async () => {
    await app.close()
    // Brief give pino transport time to flush + release the log fd
    await new Promise((r) => setTimeout(r, 30))
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* pino still flushing; safe to ignore */
    }
  })
  cleanups.push(async () => {
    try { await app.close() } catch { /* double-close guard */ }
  })
  return { url, root }
}

// Windows 上 pino transport flush + temp dir teardown 竞态会触发 uncaught agent.log ENOENT;
// 整个 e2e suite 依赖稳定 temp dir 生命周期,Windows 上统一跳过
describe.skipIf(process.platform === 'win32')('agent skeleton e2e', () => {
  it('GET /api/health returns structured payload', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(typeof body.bootTime).toBe('string')
  })

  it('GET /api/agent/bootstrap returns token (no auth needed)', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/agent/bootstrap`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; cookieName: string }
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.cookieName).toBe('aidevspace_token')
  })

  it('GET /api/requirements without token → 401', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirements`)
    expect(res.status).toBe(401)
  })

  it('GET /api/requirements with wrong token → 401', async () => {
    const { url } = await boot()
    const res = await fetch(`${url}/api/requirements`, {
      headers: { 'x-aidevspace-token': 'a'.repeat(43) },
    })
    expect(res.status).toBe(401)
  })

  it('GET /api/requirements with correct token → 200 + 空数组(新实装 ticket 07a)', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const res = await fetch(`${url}/api/requirements`, {
      headers: { 'x-aidevspace-token': token },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { requirements: unknown[] }
    expect(Array.isArray(body.requirements)).toBe(true)
  })

  it('request with bad Origin → 403', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const res = await fetch(`${url}/api/requirements`, {
      headers: {
        'x-aidevspace-token': token,
        origin: 'http://evil.com',
      },
    })
    expect(res.status).toBe(403)
  })

  it('SSE GET /api/requirement/REFUND-001/events emits hello', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')
    const controller = new AbortController()
    const res = await fetch(
      `${url}/api/requirement/REFUND-001/events`,
      {
        method: 'GET',
        headers: { 'x-aidevspace-token': token },
        signal: controller.signal,
      },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/)

    // Read the streamed body briefly to capture hello event
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), 2000)
    try {
      while (!acc.includes('event: hello')) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value)
        if (Date.now() - startedAt > 1500) break
      }
    } catch {
      /* aborted */
    } finally {
      clearTimeout(timeout)
      try { controller.abort() } catch { /* already aborted */ }
    }
    expect(acc).toMatch(/event: hello/)
    expect(acc).toMatch(/REFUND-001/)
  })

  // ========================================================================
  // ADR-0020 ticket 01 (ADR-0020 D8)· 端到端验收(对应 ticket "集成验证"段):
  // 1. POST /api/requirements/<id>/analysis/start → 201
  // 2. chunks.jsonl 读出 ≥ 2 行(双 turn fake provider 各推 1 条 text),全 narration
  // 3. SSE /events 收到 ≥ 2 个 analysis_chunk,payload 全 narration 无 source_refs
  //
  // 注:ticket 01 后 chunks 数量可变(真 SDK 流式),source_refs 由 ticket 02 升
  // 级 admission-check SKILL.md 引入结构化 prompt 后才挂上。本 case 仅验证
  // "流式通路打通 + narration 契约保持"。
  // ========================================================================
  it('start end-to-end:chunks.jsonl ≥ 2 行,全 narration 无 source_refs', async () => {
    const { url, root } = await boot()
    const token = readFileSync(join(root, '.agent-token'), 'utf8')

    // 1. seed requirement.md
    const reqId = 'req-source-refs-e2e'
    const reqDir = join(root, 'requirements', reqId)
    mkdirSync(reqDir, { recursive: true })
    writeFileSync(join(reqDir, 'requirement.md'), '# e2e PRD\n', 'utf8')

    // 2. SSE 抢先订阅 /events(ticket 00 baseline 校正:原 ticket 06 在此步骤
    //    顺位 POST → SSE,因 POST 期间即 publish 5 events,订阅时已错过;
    //    调 ticket 06 既有步骤顺序:订阅 + 等 hello → POST → 读流)
    const controller = new AbortController()
    const sse = await fetch(`${url}/api/requirement/${reqId}/events`, {
      method: 'GET',
      headers: { 'x-aidevspace-token': token },
      signal: controller.signal,
    })
    expect(sse.status).toBe(200)
    expect(sse.headers.get('content-type')).toMatch(/^text\/event-stream/)

    const reader = sse.body!.getReader()
    const decoder = new TextDecoder()
    let acc = ''
    // drain 到 hello 事件,确保 SseHub.subscribe(reqId) 已注册
    const helloDeadline = Date.now() + 2000
    while (!acc.includes('event: hello') && Date.now() < helloDeadline) {
      const { done, value } = await reader.read()
      if (done) break
      acc += decoder.decode(value)
    }
    expect(acc).toMatch(/event: hello/)

    // 3. POST /api/requirements/:id/analysis/start → 201
    const post = await fetch(
      `${url}/api/requirements/${reqId}/analysis/start`,
      {
        method: 'POST',
        headers: {
          'x-aidevspace-token': token,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ angle: 'architecture', session_id: 'sess-e2e-sr' }),
      },
    )
    expect(post.status).toBe(201)
    const postBody = (await post.json()) as { sessionId: string; chunks_path: string }
    expect(postBody.sessionId).toBe('sess-e2e-sr')

    // 4. 读 chunks.jsonl → ticket 01 后:fake provider 每个 turn 推 1 条 text,
    //    双 turn → ≥ 2 行;全部 kind=narration,无 source_refs(ADR-0017 D3 契约)。
    const text = readFileSync(postBody.chunks_path, 'utf8')
    const lines = text.split('\n').filter((l) => l.trim().length > 0)
    expect(lines.length).toBeGreaterThanOrEqual(2)
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    for (const c of parsed) {
      // ticket 01 后默认全 narration(真 SDK 流式输出无结构化 source_refs)
      expect(c.kind).toBe('narration')
      expect('source_refs' in c).toBe(false)
    }

    // 5. 接读 SSE 流(订阅窗口已建,即可收到 ≥ 2 个 analysis_chunk)
    const startedAt = Date.now()
    const timeout = setTimeout(() => controller.abort(), 2500)
    try {
      while (Date.now() - startedAt < 2000) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value)
        if ((acc.match(/event: analysis_chunk/g) ?? []).length >= 2) break
      }
    } catch {
      /* aborted */
    } finally {
      clearTimeout(timeout)
      try { controller.abort() } catch { /* already aborted */ }
    }

    // 解析 SSE data 行,验证每条 chunk 是 narration + 无 source_refs
    const dataLines = acc
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim())
      .filter((l) => l.length > 0)
    let narration = 0
    for (const dl of dataLines) {
      try {
        const obj = JSON.parse(dl) as Record<string, unknown>
        if (obj.type !== 'analysis_chunk') continue
        const chunk = obj.chunk as Record<string, unknown>
        if (chunk.kind === 'narration') {
          narration++
          expect('source_refs' in chunk).toBe(false)
        }
      } catch {
        /* non-JSON */
      }
    }
    expect(narration).toBeGreaterThanOrEqual(2)
  })
}, 30_000)
