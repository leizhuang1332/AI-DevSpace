/**
 * boardCardRoutes HTTP 端点测试 —— issue 02 / ADR-0024
 *
 * 覆盖(ticket 02 验收):
 * - GET 列表(空 → 200 {cards: [], total: 0};带过滤参数 → 200 {cards: [...], total: N})
 * - GET 单卡(存在 → 200;不存在 → 404 card-not-found;格式错 → 404 card-not-found 不区分)
 * - POST 创建(成功 → 201 + card;空 title → 400 invalid-body;req 不存在 → 404)
 * - PATCH 字段白名单(成功 → 200 + 改后的 card;空 body → 400;卡不存在 → 404)
 * - POST archive(成功 → 200 + is_archived=true;再 archive → 200 幂等)
 * - 错误返回形态:`{error, reason, message}` 400/404/500 区分
 * - 鉴权失败:无 token → 401(authPlugin 拦截)
 *
 * 设计:
 * - 用 Fastify + inject 测路由层,避免拉起完整 buildServer(不依赖 SDK / token init)
 * - 通过 buildServer opts 注入一个 fake store + 一个 root(避免 Home 目录污染)
 *
 * 注:鉴权走 authPlugin,所以每个测试都需要先把 token 写到 `root/.agent-token`。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildServer } from '../../server.js'
import { TaskCardStore } from '../../services/board/TaskCardStore.js'

let tmpRoot: string
let app: Awaited<ReturnType<typeof buildServer>>
let token: string

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-boardcards-'))
  // buildServer initWorkspace 需要 config.yaml
  writeFileSync(join(tmpRoot, 'config.yaml'), 'name: dev\n')
  app = await buildServer({
    workspaceRoot: tmpRoot,
    // 测试不出 log 到 tmpRoot 内 —— pino transport (pino/file worker) 异步写是
    // fire-and-forget,afterEach rmSync tmpRoot 后仍可能抛 ENOENT(c650535 同款)。
    // 改用 tmpdir() 外的持久文件:Windows 上 /dev/null 不可靠,套件外单文件最稳。
    logFilePath: join(tmpdir(), 'aidev-boardcards-test.log'),
  })
  await app.ready()
  token = readFileSync(join(tmpRoot, '.agent-token'), 'utf8')
})

afterEach(async () => {
  if (app) await app.close()
  // 给 pino 30ms flush 缓冲,避免 ENOENT on agent.log(参见 repos-attach.e2e.test.ts 同样处理)
  await new Promise((r) => setTimeout(r, 30))
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token }
}

/** 给 server.ts 注入的 store(避免 import 私有变量;buildServer 内部 new 了一个,
 *  这里额外起一个对应 tmpRoot 的 store 用于预置 fixture)。 */
function freshStore(): TaskCardStore {
  return new TaskCardStore({
    root: tmpRoot,
    // 确定性 ID 注入
    ulidFactory: () => {
      const ids = [
        '01J7X3K2P5EVR0Z3YQJD8HFKAA',
        '01J7X3K2P5EVR0Z3YQJD8HFKBX',
        '01J7X3K2P5EVR0Z3YQJD8HFKCC',
        '01J7X3K2P5EVR0Z3YQJD8HFKDD',
      ]
      const i = (freshStore as unknown as { __n?: number }).__n ?? 0
      ;(freshStore as unknown as { __n?: number }).__n = i + 1
      return ids[i % ids.length]!
    },
  })
}

function seedRequirement(reqId: string): void {
  mkdirSync(join(tmpRoot, 'requirements', reqId), { recursive: true })
}

// ---------------------------------------------------------------------------
// GET /api/requirement/:id/board/cards
// ---------------------------------------------------------------------------

describe('GET /api/requirement/:id/board/cards', () => {
  it('200 + {cards: [], total: 0} when no cards exist', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ requirementId: 'req-001-test', cards: [], total: 0 })
  })

  it('404 E_REQUIREMENT_NOT_FOUND when req dir missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-999-missing/board/cards',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
    expect(body.reason).toBe('requirement-not-found')
  })

  it('200 with cards after seeding via store', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    store.create('req-001-test', { title: 'a' })
    store.create('req-001-test', { title: 'b' })

    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { cards: Array<{ title: string }>; total: number }
    expect(body.total).toBe(2)
    expect(body.cards.map((c) => c.title).sort()).toEqual(['a', 'b'])
  })

  it('200 + filtered list via query params', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const a = store.create('req-001-test', { title: 'a', priority: 'high' })
    store.create('req-001-test', { title: 'b', priority: 'low' })
    store.update('req-001-test', a.id, { labels: ['p0'] })

    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards?priority=high&label=p0',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { cards: Array<{ title: string }>; total: number }
    expect(body.total).toBe(1)
    expect(body.cards[0]?.title).toBe('a')
  })

  it('400 invalid-body for unknown query enum', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards?status=frozen',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_INVALID_BODY')
    expect(body.reason).toBe('invalid-body')
  })

  it('401 without token (authPlugin intercepts)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards',
    })
    expect(res.statusCode).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// GET /api/requirement/:id/board/cards/:cardId
// ---------------------------------------------------------------------------

describe('GET /api/requirement/:id/board/cards/:cardId', () => {
  it('200 + card on hit', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { card: { id: string; title: string } }
    expect(body.card.id).toBe(card.id)
    expect(body.card.title).toBe('x')
  })

  it('404 E_CARD_NOT_FOUND when card missing', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
    expect(body.reason).toBe('card-not-found')
  })

  it('404 E_CARD_NOT_FOUND for invalid ULID (no oracle)', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards/not-a-ulid',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })

  it('404 E_REQUIREMENT_NOT_FOUND when req missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-999-missing/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/cards
// ---------------------------------------------------------------------------

describe('POST /api/requirement/:id/board/cards', () => {
  it('201 + card on manual create (parent_id=reqId, source=manual)', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: '退款接口' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { card: { id: string; parent_id: string; source: string; title: string } }
    expect(body.card.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(body.card.parent_id).toBe('req-001-test')
    expect(body.card.source).toBe('manual')
    expect(body.card.title).toBe('退款接口')
  })

  it('201 + trimmed title; honors optional fields', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        title: '  紧急退款  ',
        content: '实现退款',
        priority: 'urgent',
        assignee: 'alice',
        labels: ['p0'],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { card: { title: string; priority: string; assignee: string; labels: string[] } }
    expect(body.card.title).toBe('紧急退款')
    expect(body.card.priority).toBe('urgent')
    expect(body.card.assignee).toBe('alice')
    expect(body.card.labels).toEqual(['p0'])
  })

  it('201 + source=prd_split when explicitly provided (issue 08 PRD 拆落地)', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {
        title: 'PRD 拆候选',
        content: '从 PRD 拆出来的卡',
        source: 'prd_split',
        priority: 'high',
        labels: ['security'],
      },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json() as { card: { source: string; parent_id: string } }
    expect(body.card.source).toBe('prd_split')
    expect(body.card.parent_id).toBe('req-001-test')
  })

  it('400 E_INVALID_BODY for missing title', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_INVALID_BODY')
    expect(body.reason).toBe('invalid-body')
  })

  it('400 E_INVALID_BODY for empty title', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: '   ' },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_INVALID_BODY')
  })

  it('404 E_REQUIREMENT_NOT_FOUND when req missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-999-missing/board/cards',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'x' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/requirement/:id/board/cards/:cardId
// ---------------------------------------------------------------------------

describe('PATCH /api/requirement/:id/board/cards/:cardId', () => {
  it('200 + updated card on title change', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'old' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'new' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { card: { title: string; updated_at: string; created_at: string } }
    expect(body.card.title).toBe('new')
    expect(body.card.created_at).toBe(card.created_at)
    expect(body.card.updated_at).not.toBe(card.updated_at)
  })

  it('200 + priority / labels / assignee updated', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { priority: 'high', labels: ['p0'], assignee: 'bob' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { card: { priority: string; labels: string[]; assignee: string } }
    expect(body.card.priority).toBe('high')
    expect(body.card.labels).toEqual(['p0'])
    expect(body.card.assignee).toBe('bob')
  })

  it('400 E_INVALID_BODY for empty patch', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_INVALID_BODY')
  })

  it('400 E_INVALID_BODY strips created_at/updated_at (whitelist)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { created_at: '2099-01-01T00:00:00.000Z' },
    })
    expect(res.statusCode).toBe(400) // 空(被 strip 后只剩空)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_INVALID_BODY')
  })

  it('404 E_CARD_NOT_FOUND when card missing', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/requirement/req-001-test/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      payload: { title: 'x' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/cards/:cardId/archive
// ---------------------------------------------------------------------------

describe('POST /api/requirement/:id/board/cards/:cardId/archive', () => {
  it('200 + is_archived=true on hit', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/req-001-test/board/cards/${card.id}/archive`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { card: { id: string; is_archived: boolean } }
    expect(body.card.is_archived).toBe(true)
    expect(body.card.id).toBe(card.id)
  })

  it('archive is idempotent — second call still 200', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    for (let i = 0; i < 2; i++) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requirement/req-001-test/board/cards/${card.id}/archive`,
        headers: authHeaders(),
      })
      expect(res.statusCode).toBe(200)
    }
  })

  it('archived card is hidden from list (default)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })
    store.create('req-001-test', { title: 'y' })

    // 先 archive
    await app.inject({
      method: 'POST',
      url: `/api/requirement/req-001-test/board/cards/${card.id}/archive`,
      headers: authHeaders(),
    })

    // list 默认不再返回
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement/req-001-test/board/cards',
      headers: authHeaders(),
    })
    const body = res.json() as { total: number; cards: Array<{ id: string }> }
    expect(body.total).toBe(1)
    expect(body.cards[0]?.id).not.toBe(card.id)
  })

  it('404 E_CARD_NOT_FOUND when card missing', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement/req-001-test/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/archive',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/requirement/:id/board/cards/:cardId (issue 02 / ADR-0036)
// ---------------------------------------------------------------------------

describe('DELETE /api/requirement/:id/board/cards/:cardId', () => {
  it('200 + { deleted: true } on hit; the .json file is physically gone', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })
    const filePath = store.cardPath('req-001-test', card.id)
    expect(existsSync(filePath)).toBe(true)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { deleted: boolean; id: string }
    expect(body.deleted).toBe(true)
    expect(body.id).toBe(card.id)
    expect(existsSync(filePath)).toBe(false)
  })

  it('404 E_REQUIREMENT_NOT_FOUND when req missing', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/requirement/req-999-missing/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_REQUIREMENT_NOT_FOUND')
  })

  it('404 E_CARD_NOT_FOUND when card missing', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/requirement/req-001-test/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })

  it('404 E_CARD_NOT_FOUND on a second delete (idempotency surface)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    // 第一次成功
    const first = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(first.statusCode).toBe(200)

    // 第二次 404
    const second = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(second.statusCode).toBe(404)
    const body = second.json() as { error: string; reason: string }
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })

  it('409 E_CARD_HAS_BLOCKERS with blockers body when a subtask exists', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const parent = store.create('req-001-test', { title: 'parent' })
    // create 强制 parent_id=reqId,用 update 把 child reparent 到 parent(模拟子任务)
    const child = store.create('req-001-test', { title: '子任务' })
    store.update('req-001-test', child.id, { parent_id: parent.id })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${parent.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(409)
    const body = res.json() as {
      error: string
      reason: string
      blockers: {
        subtasks: Array<{ id: string; title: string }>
        dependents: Array<{ id: string; title: string }>
      }
    }
    expect(body.error).toBe('E_CARD_HAS_BLOCKERS')
    expect(body.reason).toBe('card-has-blockers')
    expect(body.blockers.subtasks).toEqual([{ id: child.id, title: '子任务' }])
    expect(body.blockers.dependents).toEqual([])

    // 父卡文件应仍在(被拒绝,没删)
    const filePath = store.cardPath('req-001-test', parent.id)
    expect(existsSync(filePath)).toBe(true)
  })

  it('409 E_CARD_HAS_BLOCKERS with dependents body when a card depends_on the target', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const target = store.create('req-001-test', { title: 'target' })
    const dependent = store.create('req-001-test', {
      title: '依赖方',
      depends_on: [target.id],
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${target.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(409)
    const body = res.json() as {
      error: string
      reason: string
      blockers: {
        subtasks: Array<{ id: string; title: string }>
        dependents: Array<{ id: string; title: string }>
      }
    }
    expect(body.error).toBe('E_CARD_HAS_BLOCKERS')
    expect(body.blockers.subtasks).toEqual([])
    expect(body.blockers.dependents).toEqual([
      { id: dependent.id, title: '依赖方' },
    ])
  })

  it('archived blockers are NOT counted (regression: ADR-0025 D6 + ADR-0036 D2 archived 豁免)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const parent = store.create('req-001-test', { title: 'parent' })
    // 子任务先 reparent 到 parent,再 archive(模拟:之前归档过,但仍占 parent_id 引用)
    const child = store.create('req-001-test', { title: 'archived child' })
    store.update('req-001-test', child.id, { parent_id: parent.id })
    store.archive('req-001-test', child.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${parent.id}`,
      headers: authHeaders(),
    })
    // archived 子任务不算 blocker → 应直接 200
    expect(res.statusCode).toBe(200)
  })

  it('archived card can itself be deleted (ADR-0036 D5: 物理删 = 等同 archived)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })
    store.archive('req-001-test', card.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const filePath = join(
      tmpRoot,
      'requirements',
      'req-001-test',
      'board',
      'tasks',
      `${card.id}.json`,
    )
    expect(existsSync(filePath)).toBe(false)
  })

  it('401 without token (authPlugin intercepts)', async () => {
    seedRequirement('req-001-test')
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/requirement/req-001-test/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX',
    })
    expect(res.statusCode).toBe(401)
  })

  it('removes the per-card transcript directory on success', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })
    // 模拟 transcript 子目录已存在
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
    const transcriptDir = join(
      tmpRoot,
      'requirements',
      'req-001-test',
      'board',
      'tasks',
      card.id,
    )
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(join(transcriptDir, 'transcript.yaml'), 'entries: []\n', 'utf8')

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/requirement/req-001-test/board/cards/${card.id}`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    expect(existsSync(transcriptDir)).toBe(false)
    expect(existsSync(join(
      tmpRoot,
      'requirements',
      'req-001-test',
      'board',
      'tasks',
      `${card.id}.json`,
    ))).toBe(false)
  })

  it('serializes concurrent DELETE on the same cardId (withCardLock at HTTP layer)', async () => {
    seedRequirement('req-001-test')
    const store = freshStore()
    const card = store.create('req-001-test', { title: 'x' })

    // 并发 5 次
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'DELETE',
          url: `/api/requirement/req-001-test/board/cards/${card.id}`,
          headers: authHeaders(),
        }),
      ),
    )
    const statusCounts = responses.reduce<Record<number, number>>((acc, r) => {
      acc[r.statusCode] = (acc[r.statusCode] ?? 0) + 1
      return acc
    }, {})
    // 1 个 200 + 4 个 404(card-not-found)
    expect(statusCounts).toEqual({ 200: 1, 404: 4 })
  })
})
