/**
 * prdSplitRoutes HTTP 集成测试 — issue 05 / ADR-0027 D4
 *
 * 覆盖(镜像 board-cards-route.test.ts + analysis-run-routes 风格):
 * - POST 201 + {run_id, status:'running'} + fire-and-forget
 * - GET /runs/:runId 200 + {run, cards:[N]} 每条含
 *   title + content + suggested_status='backlog' + suggested_priority
 * - GET /runs 200 + list
 * - GET /runs/:runId 404 unknown
 * - POST 400 bad body / 409 prd_not_ready / 400 empty_prd / 409 already_running
 * - DELETE 204 / 409 running / 404 unknown
 * - 401 无 token
 * - cards.yaml 物理落盘 + 路径符合 analysis/proposals/<run-id>/
 *
 * fake provider 经 buildServer({ provider }) 注入,同步调 propose_card N 次。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../../server.js'
import { proposalCardsPathFor, proposalMetaPathFor } from '../../prd-split/proposalPaths.js'
import { parse as parseYaml } from 'yaml'
import {
  createFakePrdSplitProvider,
  type FakePrdSplitProviderHandle,
} from './__fixtures__/fakePrdSplitProvider.js'

let tmpRoot: string
let app: Awaited<ReturnType<typeof buildServer>>
let token: string
let fakeHandle: FakePrdSplitProviderHandle

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-prdsplitroute-'))
  writeFileSync(join(tmpRoot, 'config.yaml'), 'name: dev\n')
  fakeHandle = createFakePrdSplitProvider({
    cards: [
      { title: '退款接口', content: '实现退款\n\n- 支持原路退回', suggested_priority: 'high', labels: ['p0'] },
      { title: '对账任务', content: '每日对账', suggested_priority: 'medium' },
      { title: '退款回调', content: 'webhook 处理', suggested_priority: null },
    ],
  })
  app = await buildServer({
    workspaceRoot: tmpRoot,
    // 测试不出 log;指向 tmpRoot 外的持久文件,pino transport 不抛 ENOENT,
    // 也不在 afterEach rmSync 时抢占句柄(沿用 board-cards-route c650535 思路,
    // 但 Windows 上 /dev/null 不可靠,改用套件外单一文件)。
    logFilePath: join(tmpdir(), 'aidev-prdsplit-test.log'),
    provider: fakeHandle.provider,
  })
  await app.ready()
  token = readFileSync(join(tmpRoot, '.agent-token'), 'utf8')
})

afterEach(async () => {
  if (app) await app.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token }
}

function seedReq(reqId: string, prdContent: string): void {
  const reqDir = join(tmpRoot, 'requirements', reqId)
  mkdirSync(reqDir, { recursive: true })
  writeFileSync(join(reqDir, 'requirement.md'), prdContent)
}

/**
 * 轮询 GET /runs/:runId 直到 run.status !== 'running' 或超时。
 *
 * fake provider 的 runAnalysisQuery 同步调 propose_card + 返 ok,但
 * fire-and-forget 块 + transitionToSucceeded 走 microtask;固定 sleep 在
 * 不同 CI / 平台抖动不稳。改为短间隔轮询(20ms × 50 = 1s 上限)。
 */
async function pollRunDone(
  reqId: string,
  runId: string,
  opts: { timeoutMs?: number } = {},
): Promise<{ status: string; actual_count: number } | null> {
  const timeoutMs = opts.timeoutMs ?? 1500
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 30))
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${reqId}/board/split-from-prd/runs/${runId}`,
      headers: authHeaders(),
    })
    if (res.statusCode === 200) {
      const body = res.json() as { run: { status: string; actual_count: number } }
      if (body.run.status !== 'running') {
        return { status: body.run.status, actual_count: body.run.actual_count }
      }
    } else {
      return null
    }
  }
  return null
}

const VALID_PRD =
  '# 退款需求\n\n## 背景\n\n本需求实现退款接口,支持原路退回与每日对账,需对接支付渠道与退款回调处理逻辑。\n'

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/split-from-prd
// ---------------------------------------------------------------------------

describe('POST /api/requirement/:id/board/split-from-prd', () => {
  it('201 + {run_id, status:running} on valid payload', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 3, use_context: ['prd'] },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { run_id: string; status: string; requirement_id: string }
    expect(body.run_id).toMatch(/^prd-/)
    expect(body.status).toBe('running')
    expect(body.requirement_id).toBe('req-001')
  })

  it('400 bad_request on missing granularity', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { expected_count: 3 },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('bad_request')
  })

  it('400 bad_request on expected_count > 50', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 51 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('409 prd_not_ready when PRD missing', async () => {
    mkdirSync(join(tmpRoot, 'requirements', 'req-noprd'), { recursive: true })
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-noprd/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '中', expected_count: 3 },
    })
    expect(res.statusCode).toBe(409)
    expect((res.json() as { error: string }).error).toBe('prd_not_ready')
  })

  it('400 empty_prd when PRD < 50 chars', async () => {
    seedReq('req-short', '短 PRD')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-short/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '中', expected_count: 3 },
    })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: string }).error).toBe('empty_prd')
  })

  it('401 without token', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 3 },
    })
    expect(res.statusCode).toBe(401)
  })

  it('409 prd_split_already_running when Run in-flight (pending provider)', async () => {
    // pending provider: 首次 POST 的 Run 永不结束,锁占用 → 第二次 POST 撞 409。
    // 不用 beforeEach 的同步 fake(同步 resolve 后锁已释放,撞不到 409)。
    const pendingRoot = mkdtempSync(join(tmpdir(), 'aidev-prdsplitpending-'))
    try {
      writeFileSync(join(pendingRoot, 'config.yaml'), 'name: dev\n')
      const pendingFake = createFakePrdSplitProvider({
        cards: [{ title: 'a' }],
        result: 'pending',
      })
      const pendingApp = await buildServer({
        workspaceRoot: pendingRoot,
        logFilePath: join(tmpdir(), 'aidev-prdsplit-test.log'),
        provider: pendingFake.provider,
      })
      await pendingApp.ready()
      const pendingToken = readFileSync(join(pendingRoot, '.agent-token'), 'utf8')
      const auth = { 'x-aidevspace-token': pendingToken }
      const reqDir = join(pendingRoot, 'requirements', 'req-001')
      mkdirSync(reqDir, { recursive: true })
      writeFileSync(join(reqDir, 'requirement.md'), VALID_PRD)

      const startRes = await pendingApp.inject({
        method: 'POST',
        url: '/api/requirement/req-001/board/split-from-prd',
        headers: { ...auth, 'content-type': 'application/json' },
        payload: { granularity: '粗', expected_count: 3 },
      })
      expect(startRes.statusCode).toBe(201)

      // 第二次 POST —— 首次 Run pending,锁占用 → 409
      const res2 = await pendingApp.inject({
        method: 'POST',
        url: '/api/requirement/req-001/board/split-from-prd',
        headers: { ...auth, 'content-type': 'application/json' },
        payload: { granularity: '细', expected_count: 5 },
      })
      expect(res2.statusCode).toBe(409)
      expect((res2.json() as { error: string }).error).toBe('prd_split_already_running')

      await pendingApp.close()
    } finally {
      try { rmSync(pendingRoot, { recursive: true, force: true }) } catch { /* best-effort */ }
    }
  })
})

// ---------------------------------------------------------------------------
// GET /runs/:runId —— 拉候选卡片(验收:payload → candidates[N] 返回)
// ---------------------------------------------------------------------------

describe('GET /api/requirement/:id/board/split-from-prd/runs/:runId', () => {
  it('200 + {run, cards:[N]} each with title+content+suggested_status=backlog+suggested_priority', async () => {
    seedReq('req-001', VALID_PRD)
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 3, use_context: ['prd'] },
    })
    const { run_id } = startRes.json() as { run_id: string }

    // 轮询等 fire-and-forget 完成(fake provider 同步 resolve + 落盘)
    const done = await pollRunDone('req-001', run_id)
    expect(done?.status).toBe('succeeded')

    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/req-001/board/split-from-prd/runs/${run_id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      run: { status: string; actual_count: number }
      cards: Array<{
        title: string
        content: string
        suggested_status: string
        suggested_priority: string | null
        ordinal: number
      }>
    }
    expect(body.run.status).toBe('succeeded')
    expect(body.cards).toHaveLength(3)
    // 验收:每条含 title + content + suggested_status='backlog' + suggested_priority
    for (const card of body.cards) {
      expect(card.title).toBeTruthy()
      expect(typeof card.content).toBe('string')
      expect(card.suggested_status).toBe('backlog')
      expect(card.suggested_priority === null || ['low', 'medium', 'high', 'urgent'].includes(card.suggested_priority)).toBe(true)
    }
    // ordinal 递增
    expect(body.cards.map((c) => c.ordinal)).toEqual([1, 2, 3])
    // 第一张是 high
    expect(body.cards[0]!.suggested_priority).toBe('high')
    expect(body.cards[0]!.title).toBe('退款接口')
  })

  it('404 prd_split_run_not_found on unknown runId', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001/board/split-from-prd/runs/prd-nope-xxxxxx',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    expect((res.json() as { error: string }).error).toBe('prd_split_run_not_found')
  })

  it('cards.yaml physically lands at analysis/proposals/<run-id>/', async () => {
    seedReq('req-001', VALID_PRD)
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '中', expected_count: 3 },
    })
    const { run_id } = startRes.json() as { run_id: string }
    await pollRunDone('req-001', run_id)

    const cardsPath = proposalCardsPathFor(tmpRoot, 'req-001', run_id)
    const metaPath = proposalMetaPathFor(tmpRoot, 'req-001', run_id)
    expect(existsSync(cardsPath)).toBe(true)
    expect(existsSync(metaPath)).toBe(true)
    const cardsFile = parseYaml(readFileSync(cardsPath, 'utf8'))
    expect(cardsFile.candidates).toHaveLength(3)
    expect(cardsFile.candidates[0].suggested_status).toBe('backlog')
  })
})

// ---------------------------------------------------------------------------
// GET /runs —— 列表
// ---------------------------------------------------------------------------

describe('GET /api/requirement/:id/board/split-from-prd/runs', () => {
  it('200 + runs list after starting', async () => {
    seedReq('req-001', VALID_PRD)
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 3 },
    })
    const { run_id } = startRes.json() as { run_id: string }
    await pollRunDone('req-001', run_id)

    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001/board/split-from-prd/runs',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { runs: Array<{ run_id: string; status: string }> }
    expect(body.runs).toHaveLength(1)
    expect(body.runs[0]!.status).toBe('succeeded')
  })

  it('200 + empty list when no runs', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001/board/split-from-prd/runs',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { runs: unknown[] }).runs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DELETE /runs/:runId
// ---------------------------------------------------------------------------

describe('DELETE /api/requirement/:id/board/split-from-prd/runs/:runId', () => {
  it('204 + removes dir after succeeded', async () => {
    seedReq('req-001', VALID_PRD)
    const startRes = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001/board/split-from-prd',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { granularity: '粗', expected_count: 3 },
    })
    const { run_id } = startRes.json() as { run_id: string }
    await pollRunDone('req-001', run_id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001/board/split-from-prd/runs/${run_id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(204)
    expect(existsSync(proposalMetaPathFor(tmpRoot, 'req-001', run_id))).toBe(false)
  })

  it('404 on unknown runId', async () => {
    seedReq('req-001', VALID_PRD)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/requirement/req-001/board/split-from-prd/runs/prd-nope',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })
})
