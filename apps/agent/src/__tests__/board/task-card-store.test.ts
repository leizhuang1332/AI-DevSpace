/**
 * TaskCardStore 单测 —— issue 02 / ADR-0024
 *
 * 覆盖:
 * - CRUD round-trip:create → get → update → list
 * - 列表过滤:status / priority / source / label / include_archived
 * - 软删:archive → is_archived=true;list 默认不显示;include_archived=true 显示
 * - 错误分支:req 不存在 / card 不存在 / 无效 ULID / schema 失败
 * - 字段白名单:只接受约定的 patch 字段;created_at/updated_at/completed_at 自动维护
 * - completed_at 联动:status=done 时填;离开 done 时清空
 *
 * 测试基础设施:
 * - mkdtempSync 起一个临时 workspaceRoot
 * - ulidFactory 注入确定性 ID(便于断言)
 * - nowIso 注入固定时间(便于断言 created_at / updated_at)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TASK_CARD_ID_RE,
  TaskCardPriority,
  TaskCardSource,
  TaskCardStatus,
  type TaskCard,
} from '@ai-devspace/shared'
import { TaskCardStore, TaskCardStoreError } from '../../services/board/TaskCardStore.js'

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

const T0 = '2026-08-06T10:00:00.000Z'
const T1 = '2026-08-06T10:05:00.000Z'
const T2 = '2026-08-06T10:10:00.000Z'

let tmpRoot: string
let store: TaskCardStore
let idCounter: number

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-taskcard-'))
  idCounter = 0
  store = new TaskCardStore({
    root: tmpRoot,
    // 确定性 ID:按调用顺序生成 26 位 ULID(满足正则)
    ulidFactory: () => {
      idCounter += 1
      const hex = idCounter.toString(16).padStart(2, '0').toUpperCase()
      return `01J7X3K2P5EVR0Z3YQJD8HFK${hex}${'A'.repeat(0)}`.slice(0, 26)
    },
    nowIso: () => T0,
  })
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

/** 提前把 req 目录建出来(create 必依赖)。 */
function seedRequirement(reqId = 'req-001-test'): void {
  const { mkdirSync } = require('node:fs') as typeof import('node:fs')
  mkdirSync(join(tmpRoot, 'requirements', reqId), { recursive: true })
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('TaskCardStore.create', () => {
  it('creates a manual card with sensible defaults and writes JSON to disk', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: '退款接口' })

    expect(card.id).toMatch(TASK_CARD_ID_RE)
    expect(card.parent_id).toBe('req-001-test')
    expect(card.status).toBe(TaskCardStatus.BACKLOG)
    expect(card.title).toBe('退款接口')
    expect(card.content).toBe('')
    expect(card.priority).toBeNull()
    expect(card.assignee).toBeNull()
    expect(card.labels).toEqual([])
    expect(card.depends_on).toEqual([])
    expect(card.order_index).toBeNull()
    expect(card.source).toBe(TaskCardSource.MANUAL)
    expect(card.is_archived).toBe(false)
    expect(card.created_at).toBe(T0)
    expect(card.updated_at).toBe(T0)
    expect(card.completed_at).toBeNull()

    // 物理文件存在
    const file = store.cardPath('req-001-test', card.id)
    expect(existsSync(file)).toBe(true)
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as TaskCard
    expect(onDisk.id).toBe(card.id)
  })

  it('trims the title', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: '  开发退款  ' })
    expect(card.title).toBe('开发退款')
  })

  it('defaults source to manual when not provided', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: '普通卡' })
    expect(card.source).toBe(TaskCardSource.MANUAL)
  })

  it('passes through source=prd_split when explicitly provided (issue 08 PRD 拆落地)', () => {
    seedRequirement()
    const card = store.create('req-001-test', {
      title: 'PRD 拆候选',
      content: '从 PRD 拆出来的卡',
      source: TaskCardSource.PRD_SPLIT,
      priority: TaskCardPriority.HIGH,
      labels: ['security'],
    })
    expect(card.source).toBe(TaskCardSource.PRD_SPLIT)
    // 落盘也一致
    const file = store.cardPath('req-001-test', card.id)
    const onDisk = JSON.parse(readFileSync(file, 'utf8')) as TaskCard
    expect(onDisk.source).toBe(TaskCardSource.PRD_SPLIT)
  })

  it('rejects empty title via schema', () => {
    seedRequirement()
    expect(() => store.create('req-001-test', { title: '   ' })).toThrow(
      TaskCardStoreError,
    )
  })

  it('throws E_REQUIREMENT_NOT_FOUND when req dir does not exist', () => {
    expect(() => store.create('req-999-missing', { title: 'x' })).toThrow(
      TaskCardStoreError,
    )
    try {
      store.create('req-999-missing', { title: 'x' })
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_REQUIREMENT_NOT_FOUND')
    }
  })

  it('rejects an explicitly-passed invalid id', () => {
    seedRequirement()
    try {
      store.create('req-001-test', { title: 'x', id: 'not-a-ulid' })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_INVALID_CARD_ID')
    }
  })

  it('honors optional status / priority / assignee / labels / depends_on / order_index', () => {
    seedRequirement()
    const card = store.create('req-001-test', {
      title: '退款接口',
      status: TaskCardStatus.IN_PROGRESS,
      priority: TaskCardPriority.HIGH,
      assignee: 'alice',
      labels: ['backend', 'p0'],
      depends_on: ['01J7X3K2P5EVR0Z3YQJD8HFKXB'],
      order_index: 3,
    })
    expect(card.status).toBe('in_progress')
    expect(card.priority).toBe('high')
    expect(card.assignee).toBe('alice')
    expect(card.labels).toEqual(['backend', 'p0'])
    expect(card.depends_on).toEqual(['01J7X3K2P5EVR0Z3YQJD8HFKXB'])
    expect(card.order_index).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

describe('TaskCardStore.get', () => {
  it('returns null for non-existent card', () => {
    seedRequirement()
    expect(store.get('req-001-test', '01J7X3K2P5EVR0Z3YQJD8HFKXX')).toBeNull()
  })

  it('returns null for invalid ULID format (no oracle)', () => {
    seedRequirement()
    expect(store.get('req-001-test', 'not-a-ulid')).toBeNull()
  })

  it('returns the persisted card', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const got = store.get('req-001-test', created.id)
    expect(got?.id).toBe(created.id)
    expect(got?.title).toBe('x')
  })
})

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('TaskCardStore.update', () => {
  it('patches title and bumps updated_at (created_at unchanged)', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'old' })

    // 改时间到 T1
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => created.id,
      nowIso: () => T1,
    })
    const updated = store.update('req-001-test', created.id, { title: 'new' })

    expect(updated.title).toBe('new')
    expect(updated.created_at).toBe(T0) // 不变
    expect(updated.updated_at).toBe(T1) // 改了
    expect(updated.completed_at).toBeNull()
  })

  it('sets completed_at when status changes to done; clears it on leaving', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })

    // 切到 done(T1)
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => created.id,
      nowIso: () => T1,
    })
    const done = store.update('req-001-test', created.id, {
      status: TaskCardStatus.DONE,
    })
    expect(done.status).toBe('done')
    expect(done.completed_at).toBe(T1)

    // 切回 in_progress(T2)→ completed_at 清空
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => created.id,
      nowIso: () => T2,
    })
    const reopened = store.update('req-001-test', created.id, {
      status: TaskCardStatus.IN_PROGRESS,
    })
    expect(reopened.status).toBe('in_progress')
    expect(reopened.completed_at).toBeNull()
  })

  it('updates priority / assignee / labels / depends_on / order_index / source', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const updated = store.update('req-001-test', created.id, {
      priority: TaskCardPriority.URGENT,
      assignee: 'bob',
      labels: ['a', 'b'],
      depends_on: ['01J7X3K2P5EVR0Z3YQJD8HFKXC'],
      order_index: 7,
      source: TaskCardSource.PRD_SPLIT,
    })
    expect(updated.priority).toBe('urgent')
    expect(updated.assignee).toBe('bob')
    expect(updated.labels).toEqual(['a', 'b'])
    expect(updated.depends_on).toEqual(['01J7X3K2P5EVR0Z3YQJD8HFKXC'])
    expect(updated.order_index).toBe(7)
    expect(updated.source).toBe('prd_split')
  })

  it('sets parent_id to null (unlink) and back to a card id', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    expect(created.parent_id).toBe('req-001-test')

    const unlinked = store.update('req-001-test', created.id, { parent_id: null })
    expect(unlinked.parent_id).toBeNull()

    const reparented = store.update('req-001-test', created.id, {
      parent_id: '01J7X3K2P5EVR0Z3YQJD8HFKXB',
    })
    expect(reparented.parent_id).toBe('01J7X3K2P5EVR0Z3YQJD8HFKXB')
  })

  it('throws E_CARD_NOT_FOUND for non-existent cardId', () => {
    seedRequirement()
    try {
      store.update('req-001-test', '01J7X3K2P5EVR0Z3YQJD8HFKXY', {
        title: 'x',
      })
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_CARD_NOT_FOUND')
    }
  })
})

// ---------------------------------------------------------------------------
// archive
// ---------------------------------------------------------------------------

describe('TaskCardStore.archive', () => {
  it('soft-deletes via is_archived=true; file stays on disk', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const file = store.cardPath('req-001-test', created.id)

    const archived = store.archive('req-001-test', created.id)
    expect(archived.is_archived).toBe(true)
    expect(existsSync(file)).toBe(true)
  })

  it('list() hides archived by default; includeArchived=true shows it', () => {
    seedRequirement()
    const a = store.create('req-001-test', { title: 'a' })
    store.create('req-001-test', { title: 'b' })
    store.archive('req-001-test', a.id)

    expect(store.list('req-001-test').map((c) => c.title)).toEqual(['b'])
    expect(store.list('req-001-test', { includeArchived: true }).map((c) => c.title).sort())
      .toEqual(['a', 'b'])
  })
})

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('TaskCardStore.list', () => {
  it('returns [] when tasks dir does not exist', () => {
    seedRequirement()
    expect(store.list('req-001-test')).toEqual([])
  })

  it('orders by updated_at desc', () => {
    seedRequirement()
    const a = store.create('req-001-test', { title: 'a' })
    // 推进时间,建 b
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => `01J7X3K2P5EVR0Z3YQJD8HFK${'B'.repeat(0)}`.padEnd(26, 'B'),
      nowIso: () => T1,
    })
    const b = store.create('req-001-test', { title: 'b' })
    // 再推进到 T2,改 a
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => a.id,
      nowIso: () => T2,
    })
    store.update('req-001-test', a.id, { title: 'a!' })

    const cards = store.list('req-001-test', { includeArchived: true })
    // a 应该是最新的(updated_at=T2),b 旧(updated_at=T1)
    expect(cards[0]?.id).toBe(a.id)
    expect(cards[1]?.id).toBe(b.id)
  })

  it('filters by status / priority / source / label', () => {
    seedRequirement()
    store.create('req-001-test', { title: 'a', priority: TaskCardPriority.HIGH, labels: ['p0'] })
    store.create('req-001-test', { title: 'b', priority: TaskCardPriority.LOW, labels: ['p1'] })
    // create 强制 source=manual;用 update 把它改成 prd_split 以验证 source 过滤
    const c = store.create('req-001-test', {
      title: 'c',
      priority: TaskCardPriority.HIGH,
      labels: ['p0', 'p1'],
    })
    store.update('req-001-test', c.id, { source: TaskCardSource.PRD_SPLIT })

    const cards = store.list('req-001-test')
    expect(cards).toHaveLength(3)

    expect(store.list('req-001-test', { status: TaskCardStatus.BACKLOG })).toHaveLength(3)
    expect(store.list('req-001-test', { priority: TaskCardPriority.HIGH })).toHaveLength(2)
    expect(store.list('req-001-test', { source: TaskCardSource.MANUAL })).toHaveLength(2)
    expect(store.list('req-001-test', { source: TaskCardSource.PRD_SPLIT })).toHaveLength(1)
    expect(store.list('req-001-test', { label: 'p0' })).toHaveLength(2)
    expect(store.list('req-001-test', { label: 'p1' })).toHaveLength(2)
    expect(
      store.list('req-001-test', {
        priority: TaskCardPriority.HIGH,
        label: 'p0',
      }),
    ).toHaveLength(2)
  })

  it('hides archived by default', () => {
    seedRequirement()
    const a = store.create('req-001-test', { title: 'a' })
    store.create('req-001-test', { title: 'b' })
    store.archive('req-001-test', a.id)
    const cards = store.list('req-001-test')
    expect(cards).toHaveLength(1)
    expect(cards[0]?.title).toBe('b')
  })

  it('skips malformed JSON files with a console.warn (does not throw)', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: 'x' })
    // 故意写一个 schema-invalid 的 json
    const { writeFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(store.tasksDir('req-001-test'), { recursive: true })
    writeFileSync(join(store.tasksDir('req-001-test'), 'garbage.json'), '{not-json', 'utf8')
    const cards = store.list('req-001-test')
    expect(cards.map((c) => c.id)).toEqual([card.id])
  })
})

// ---------------------------------------------------------------------------
// updateStatus (legacy 入口,Guard 仍会调用)
// ---------------------------------------------------------------------------

describe('TaskCardStore.updateStatus (legacy)', () => {
  it('changes status and sets completed_at when entering done', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: 'x' })
    store = new TaskCardStore({
      root: tmpRoot,
      ulidFactory: () => card.id,
      nowIso: () => T1,
    })
    const updated = store.updateStatus('req-001-test', card.id, TaskCardStatus.DONE)
    expect(updated.status).toBe('done')
    expect(updated.completed_at).toBe(T1)
    expect(updated.updated_at).toBe(T1)
  })

  it('throws E_CARD_NOT_FOUND for archived card', () => {
    seedRequirement()
    const card = store.create('req-001-test', { title: 'x' })
    store.archive('req-001-test', card.id)
    try {
      store.updateStatus('req-001-test', card.id, TaskCardStatus.DONE)
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_CARD_NOT_FOUND')
    }
  })
})

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('TaskCardStore.exists', () => {
  it('returns true for an existing requirement dir, false otherwise', () => {
    seedRequirement('req-001-test')
    expect(store.exists('req-001-test')).toBe(true)
    expect(store.exists('req-999-missing')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// delete (issue 02 / ADR-0036 D1)
// ---------------------------------------------------------------------------

describe('TaskCardStore.delete', () => {
  it('removes the .json file physically; subsequent get() returns null', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const file = store.cardPath('req-001-test', created.id)
    expect(existsSync(file)).toBe(true)

    await store.delete('req-001-test', created.id)

    expect(existsSync(file)).toBe(false)
    expect(store.get('req-001-test', created.id)).toBeNull()
  })

  it('removes the per-card transcript directory <tasksDir>/<cardId>/', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
    const transcriptDir = join(tmpRoot, 'requirements', 'req-001-test', 'board', 'tasks', created.id)
    mkdirSync(transcriptDir, { recursive: true })
    writeFileSync(join(transcriptDir, 'transcript.yaml'), 'entries: []\n', 'utf8')
    expect(existsSync(transcriptDir)).toBe(true)

    await store.delete('req-001-test', created.id)

    expect(existsSync(transcriptDir)).toBe(false)
    expect(existsSync(store.cardPath('req-001-test', created.id))).toBe(false)
  })

  it('throws E_CARD_NOT_FOUND on a second delete call (idempotency surface)', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    await store.delete('req-001-test', created.id)

    try {
      await store.delete('req-001-test', created.id)
      expect.fail('expected throw on second delete')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_CARD_NOT_FOUND')
    }
  })

  it('throws E_CARD_NOT_FOUND when card never existed', async () => {
    seedRequirement()
    try {
      await store.delete('req-001-test', '01J7X3K2P5EVR0Z3YQJD8HFKXX')
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_CARD_NOT_FOUND')
    }
  })

  it('throws E_INVALID_CARD_ID when cardId is not a valid ULID', async () => {
    seedRequirement()
    try {
      await store.delete('req-001-test', 'not-a-ulid')
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_INVALID_CARD_ID')
    }
  })

  it('throws E_REQUIREMENT_NOT_FOUND when req dir missing', async () => {
    try {
      await store.delete('req-999-missing', '01J7X3K2P5EVR0Z3YQJD8HFKXX')
      expect.fail('expected throw')
    } catch (err) {
      expect((err as TaskCardStoreError).code).toBe('E_REQUIREMENT_NOT_FOUND')
    }
  })

  it('deletes an archived card (ADR-0036 D5: archived 不参与父 status 校验,物理删同样适用)', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    store.archive('req-001-test', created.id)
    const file = store.cardPath('req-001-test', created.id)
    expect(existsSync(file)).toBe(true)

    await store.delete('req-001-test', created.id)

    expect(existsSync(file)).toBe(false)
  })

  it('serializes concurrent delete calls on the same cardId (withCardLock)', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const file = store.cardPath('req-001-test', created.id)
    // 并发发起 5 次 delete —— 第一次成功,后续 4 次都抛 E_CARD_NOT_FOUND
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => store.delete('req-001-test', created.id)),
    )
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(4)
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(TaskCardStoreError)
      expect(((r as PromiseRejectedResult).reason as TaskCardStoreError).code).toBe(
        'E_CARD_NOT_FOUND',
      )
    }
    expect(existsSync(file)).toBe(false)
  })

  it('archive still works (regression AC: 后端软删路径保留,UI 不再触发但 API 仍可用)', () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    const archived = store.archive('req-001-test', created.id)
    expect(archived.is_archived).toBe(true)
    const file = store.cardPath('req-001-test', created.id)
    expect(existsSync(file)).toBe(true) // 软删 → 文件保留
  })

  it('archive + delete composes: archive-then-delete removes the file', async () => {
    seedRequirement()
    const created = store.create('req-001-test', { title: 'x' })
    store.archive('req-001-test', created.id)
    await store.delete('req-001-test', created.id)
    const file = store.cardPath('req-001-test', created.id)
    expect(existsSync(file)).toBe(false)
  })
})
