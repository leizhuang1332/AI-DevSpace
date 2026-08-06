/**
 * PATCH /api/requirement/:id/board/cards/:cardId/status 路由测试 —— issue 03 / ADR-0025
 *
 * 覆盖(issue 03 ticket 5 + 7):
 * - 改 status 后 Guard 校验,不冲突 → 200 {ok:true, card: {...}}
 * - 改 status 触发 Guard 冲突 + override=false → 200 {ok:false, conflicts: [...]}
 * - 冲突 + override=true → 200 {ok:true, override_applied:true} + overrides.log 多一行
 * - 反向不约束(ADR-0025 D3):不改父 status(即便所有非 archived 子都 done)
 * - archived 卡 → 404 E_CARD_NOT_FOUND(Guard 与 route 都拒绝操作)
 * - 卡不存在 → 404 E_CARD_NOT_FOUND
 * - 父 Requirement 不存在 → 404 E_REQUIREMENT_NOT_FOUND
 * - 入参校验失败(非合法 status)→ 400 E_INVALID_BODY
 * - 无 token → 401
 *
 * 设计:用 Fastify + inject,直接调 `boardRoutes` + `boardCardRoutes`,
 * 注入 fakeRequirementService(走 listRequirements 派生父 status);
 * 不拉完整 buildServer(避免 SDK init)。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  RequirementStatus,
  TaskCardStatus,
  type RequirementSummary,
  type TaskCard,
  type TaskCardStatusT,
} from '@ai-devspace/shared'
import { authPlugin } from '../../auth/authPlugin.js'
import { TokenManager } from '../../auth/TokenManager.js'
import { OverrideLog } from '../../services/board/OverrideLog.js'
import { TaskCardStore } from '../../services/board/TaskCardStore.js'
import { boardRoutes } from '../../routes/board.js'
import { boardCardRoutes } from '../../routes/board-cards.js'
import type { RequirementService } from '../../services/RequirementService.js'

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

let tmpRoot: string
let app: FastifyInstance
let token: string
let store: TaskCardStore
let overrideLog: OverrideLog
let requirementService: RequirementService

const REQ_ID = 'req-001-refund'
const CARD_A = '01J7X3K2P5EVR0Z3YQJD8HFKAA'
const CARD_B = '01J7X3K2P5EVR0Z3YQJD8HFKBX'
const CARD_C = '01J7X3K2P5EVR0Z3YQJD8HFKCC'

/** 确定性 ID 序列(按调用顺序消费);注入到 store ulidFactory */
const DETERMINISTIC_IDS = [CARD_A, CARD_B, CARD_C, '01J7X3K2P5EVR0Z3YQJD8HFKDD']
let idCursor = 0

function nextId(): string {
  const id = DETERMINISTIC_IDS[idCursor % DETERMINISTIC_IDS.length]!
  idCursor++
  return id
}

beforeEach(async () => {
  idCursor = 0
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-boardstatus-'))
  // 建 req 目录(让 store.exists(reqId) = true)
  mkdirSync(join(tmpRoot, 'requirements', REQ_ID), { recursive: true })
  writeFileSync(join(tmpRoot, 'requirements', REQ_ID, 'meta.yaml'), 'id: x\n')

  // token init(authPlugin 需要)
  const tm = new TokenManager(tmpRoot)
  token = await tm.ensure()

  store = new TaskCardStore({ root: tmpRoot, ulidFactory: nextId })
  overrideLog = new OverrideLog({ root: tmpRoot })

  // fake RequirementService —— 只 stub `get` + `listRequirements`(Guard 用)
  requirementService = {
    get: vi.fn(() => ({ id: REQ_ID })),
    listRequirements: vi.fn(() => [
      {
        id: REQ_ID,
        title: 'demo',
        status: RequirementStatus.IMPLEMENTING,
        progress: 70,
        repos: [],
        createdAt: '2026-08-06T00:00:00.000Z',
        updatedAt: '2026-08-06T00:00:00.000Z',
      } satisfies RequirementSummary,
    ]),
  } as unknown as RequirementService

  app = Fastify({ logger: false })
  await app.register(authPlugin, { tokenManager: tm, allowedOrigins: [] })
  await app.register(boardCardRoutes, { store })
  await app.register(boardRoutes, {
    taskCardStore: store,
    overrideLog,
    requirementService,
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

async function patchStatus(
  cardId: string,
  body: Record<string, unknown>,
  withAuth = true,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = withAuth
    ? { 'x-aidevspace-token': token, 'content-type': 'application/json' }
    : { 'content-type': 'application/json' }
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/requirement/${REQ_ID}/board/cards/${cardId}/status`,
    headers,
    payload: JSON.stringify(body),
  })
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> }
}

/** 预置一张 manual 卡(走 store.create);返回 create 后的 TaskCard */
function seedCard(
  cardId: string,
  status: TaskCardStatusT,
  overrides: Partial<TaskCard> = {},
): TaskCard {
  return store.create(REQ_ID, {
    id: cardId,
    title: `card ${cardId}`,
    status,
    ...overrides,
  })
}

// ===========================================================================
// 基础场景
// ===========================================================================

describe('PATCH /board/cards/:cardId/status — basic', () => {
  it('switches status to a new value with no conflict', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
    })
    expect(statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect((body.card as TaskCard).status).toBe('todo')
    expect(body.override_applied).toBe(false)
  })

  it('returns 400 E_INVALID_BODY when status is missing', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, {})
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BODY')
  })

  it('returns 400 E_INVALID_BODY when status is not a TaskCardStatus enum value', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, { status: 'frozen' })
    expect(statusCode).toBe(400)
    expect(body.error).toBe('E_INVALID_BODY')
  })

  it('returns 401 when no auth token is provided', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, { status: 'todo' }, false)
    expect(statusCode).toBe(401)
    expect(body).toBeDefined()
  })

  it('returns 404 E_CARD_NOT_FOUND when card does not exist', async () => {
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
    })
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_CARD_NOT_FOUND')
    expect(body.cardId).toBe(CARD_A)
  })

  it('returns 404 E_CARD_NOT_FOUND for archived cards (no writes)', async () => {
    const card = seedCard(CARD_A, TaskCardStatus.BACKLOG)
    // 软删
    store.archive(REQ_ID, card.id)
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
    })
    expect(statusCode).toBe(404)
    expect(body.error).toBe('E_CARD_NOT_FOUND')
  })
})

// ===========================================================================
// Guard 冲突场景 —— issue 03 ticket 5
// ===========================================================================

describe('PATCH /board/cards/:cardId/status — Guard conflict', () => {
  it('returns conflicts when parent implementing and a backlog card remains after switch', async () => {
    // 父 implementing;A 当前 backlog(改到 todo 后仍合规),B backlog 保留
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
    })
    expect(statusCode).toBe(200)
    expect(body.ok).toBe(false)
    const conflicts = body.conflicts as Array<{ card_id: string; rule: string }>
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.card_id).toBe(CARD_B)
    expect(conflicts[0]?.rule).toBe('no_backlog_for_implementing')
    expect(body.parent_status).toBe('implementing')
  })

  it('does NOT write overrides.log when override=false', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    await patchStatus(CARD_A, { status: TaskCardStatus.TODO })
    const logFile = join(tmpRoot, 'requirements', REQ_ID, 'board', 'overrides.log')
    expect(existsSync(logFile)).toBe(false)
  })

  it('does NOT update the card status when override=false', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    await patchStatus(CARD_A, { status: TaskCardStatus.TODO })
    const after = store.get(REQ_ID, CARD_A)
    expect(after?.status).toBe('backlog')
  })

  it('writes overrides.log AND applies status when override=true', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
      override: true,
    })
    expect(statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.override_applied).toBe(true)
    const logFile = join(tmpRoot, 'requirements', REQ_ID, 'board', 'overrides.log')
    expect(existsSync(logFile)).toBe(true)
    const entry = JSON.parse(readFileSync(logFile, 'utf8').trim())
    expect(entry.kind).toBe('child_status_force_apply')
    expect(entry.parent_status).toBe('implementing')
    expect(entry.card_id).toEqual([CARD_B])
    expect(entry.rules).toEqual(['no_backlog_for_implementing'])
    const after = store.get(REQ_ID, CARD_A)
    expect(after?.status).toBe('todo')
  })

  it('flags submitting rule when parent submitting and a card remains in_progress', async () => {
    // override listRequirements to submitting
    vi.mocked(requirementService.listRequirements).mockReturnValue([
      {
        id: REQ_ID,
        title: 'demo',
        status: RequirementStatus.SUBMITTING,
        progress: 90,
        repos: [],
        createdAt: '',
        updatedAt: '',
      },
    ])
    seedCard(CARD_A, TaskCardStatus.IN_REVIEW)
    seedCard(CARD_B, TaskCardStatus.IN_PROGRESS)
    const { body } = await patchStatus(CARD_A, { status: TaskCardStatus.DONE })
    expect(body.ok).toBe(false)
    const conflicts = body.conflicts as Array<{ card_id: string; rule: string }>
    expect(conflicts).toEqual([
      {
        card_id: CARD_B,
        card_status: 'in_progress',
        rule: 'no_in_progress_for_submitting',
      },
    ])
  })

  it('flags done rule when parent done and any non-done card remains', async () => {
    vi.mocked(requirementService.listRequirements).mockReturnValue([
      {
        id: REQ_ID,
        title: 'demo',
        status: RequirementStatus.DONE,
        progress: 100,
        repos: [],
        createdAt: '',
        updatedAt: '',
      },
    ])
    seedCard(CARD_A, TaskCardStatus.DONE)
    seedCard(CARD_B, TaskCardStatus.IN_PROGRESS)
    const { body } = await patchStatus(CARD_A, { status: TaskCardStatus.DONE })
    expect(body.ok).toBe(false)
    const conflicts = body.conflicts as Array<{ card_id: string; rule: string }>
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.rule).toBe('all_done_for_parent_done')
  })

  it('passes when parent implementing and the only backlog becomes non-backlog', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    const { statusCode, body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
    })
    expect(statusCode).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.override_applied).toBe(false)
  })
})

// ===========================================================================
// 反向不约束(ADR-0025 D3)
// ===========================================================================

describe('PATCH /board/cards/:cardId/status — reverse direction does not mutate parent', () => {
  it('does NOT mutate the parent status (no setter on RequirementService is invoked)', async () => {
    // 父 implementing;让所有非 archived 子卡 → done
    seedCard(CARD_A, TaskCardStatus.IN_PROGRESS)
    seedCard(CARD_B, TaskCardStatus.IN_REVIEW)
    await patchStatus(CARD_A, { status: TaskCardStatus.DONE })
    await patchStatus(CARD_B, { status: TaskCardStatus.DONE })
    // 路由只读 parent status(派生),不应有 setter 调用 —— fake 上没有 setter 方法,
    // 若有调用会得到 undefined 报错。当前 fake 上只有 get + listRequirements,
    // 强校验"没有 setter"通过 Object.keys 排除所有匹配 update/set/change 的 key。
    const keys = Object.keys(requirementService)
    const setterKeys = keys.filter((k) => /update|set|change/i.test(k))
    expect(setterKeys).toEqual([])
    // listRequirements 应该被调过(每次 PATCH 都要重新派生)
    expect(requirementService.listRequirements).toHaveBeenCalled()
    // 派生状态保持 'implementing' —— 没有自动切到 done
    expect(vi.mocked(requirementService.listRequirements).mock.results[0]?.value[0]?.status).toBe('implementing')
  })

  it('does not produce override log entries for non-conflicting switches', async () => {
    seedCard(CARD_A, TaskCardStatus.IN_PROGRESS)
    await patchStatus(CARD_A, { status: TaskCardStatus.DONE })
    const logFile = join(tmpRoot, 'requirements', REQ_ID, 'board', 'overrides.log')
    expect(existsSync(logFile)).toBe(false)
  })
})

// ===========================================================================
// 入参 schema 边界
// ===========================================================================

describe('PATCH /board/cards/:cardId/status — input schema', () => {
  it('accepts override=true explicitly', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    const { body } = await patchStatus(CARD_A, {
      status: TaskCardStatus.TODO,
      override: true,
    })
    expect(body.override_applied).toBe(true)
  })

  it('treats override absent as false', async () => {
    seedCard(CARD_A, TaskCardStatus.BACKLOG)
    seedCard(CARD_B, TaskCardStatus.BACKLOG)
    const { body } = await patchStatus(CARD_A, { status: TaskCardStatus.TODO })
    expect(body.ok).toBe(false)
  })

  it('accepts all 5 TaskCardStatus enum values (forward path, no conflict)', async () => {
    // 把父 status mock 成 'draft'(不约束),逐个建卡 + 切 5 个 status。
    // 用 BACKLOG 当 seedCard 初始值(等同 board 实际默认)。
    vi.mocked(requirementService.listRequirements).mockReturnValue([
      {
        id: REQ_ID,
        title: 'demo',
        status: RequirementStatus.DRAFT,
        progress: 0,
        repos: [],
        createdAt: '',
        updatedAt: '',
      },
    ])
    const ids = [CARD_A, CARD_B, CARD_C, '01J7X3K2P5EVR0Z3YQJD8HFKDD', '01J7X3K2P5EVR0Z3YQJD8HFKEE']
    const targets = [
      TaskCardStatus.BACKLOG,
      TaskCardStatus.TODO,
      TaskCardStatus.IN_PROGRESS,
      TaskCardStatus.IN_REVIEW,
      TaskCardStatus.DONE,
    ]
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!
      const id = ids[i]!
      seedCard(id, TaskCardStatus.BACKLOG)
      const { statusCode, body } = await patchStatus(id, { status: target })
      expect(statusCode).toBe(200)
      expect((body.card as TaskCard).status).toBe(target)
    }
  })
})