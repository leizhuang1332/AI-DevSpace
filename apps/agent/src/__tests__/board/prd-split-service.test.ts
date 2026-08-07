/**
 * PrdSplitService 单测 — issue 05 / ADR-0027 D4
 *
 * 覆盖(无 provider,纯 fs + tmpRoot):
 * - createRun:落 meta.yaml + 空 cards.yaml;单运行约束(mkdir 锁);
 * - appendProposal:ordinal 派生 + tool_use_id 幂等 + suggested_status=backlog 固定;
 * - transitionToSucceeded/Failed:更新 meta + 清 toolUseIndex;
 * - readCards/listRuns/readMeta 容错;
 * - deleteRun + run_still_running 门禁;
 * - reconcileOrphanRuns:boot 时 running Run → failed;
 * - PrdSplitServiceError on IO 失败(不在此测,留 route 层)。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrdSplitService } from '../../prd-split/PrdSplitService.js'
import {
  proposalCardsPathFor,
  proposalMetaPathFor,
  prdSplitLockPath,
} from '../../prd-split/proposalPaths.js'
import { parse as parseYaml } from 'yaml'

let tmpRoot: string
let svc: PrdSplitService

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-prdsplit-'))
  svc = new PrdSplitService({
    root: tmpRoot,
    runIdFactory: () => 'prd-test-aaaaaa',
    nowIso: () => '2026-08-07T08:00:00.000Z',
  })
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

function seedReq(reqId: string): void {
  mkdirSync(join(tmpRoot, 'requirements', reqId), { recursive: true })
}

describe('PrdSplitService.createRun — issue 05', () => {
  it('creates meta.yaml + empty cards.yaml + returns running meta', async () => {
    seedReq('req-001')
    const r = await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 5,
      useContext: ['prd'],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.run.run_id).toBe('prd-test-aaaaaa')
    expect(r.run.status).toBe('running')
    expect(r.run.granularity).toBe('粗')
    expect(r.run.expected_count).toBe(5)
    expect(r.run.actual_count).toBe(0)

    // meta.yaml 落盘
    const metaRaw = readFileSync(
      proposalMetaPathFor(tmpRoot, 'req-001', 'prd-test-aaaaaa'),
      'utf8',
    )
    expect(parseYaml(metaRaw).status).toBe('running')
    // cards.yaml 落盘 + 空 candidates
    const cardsRaw = readFileSync(
      proposalCardsPathFor(tmpRoot, 'req-001', 'prd-test-aaaaaa'),
      'utf8',
    )
    expect(parseYaml(cardsRaw).candidates).toEqual([])
  })

  it('rejects second running Run (single-run constraint)', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '中',
      expectedCount: 3,
      useContext: [],
    })
    const r2 = await svc.createRun({
      requirementId: 'req-001',
      granularity: '细',
      expectedCount: 8,
      useContext: [],
    })
    expect(r2.ok).toBe(false)
    if (r2.ok) return
    expect(r2.code).toBe('prd_split_already_running')
  })

  it('uses .prd-split.lock (distinct from analysis .startup.lock)', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 5,
      useContext: [],
    })
    expect(existsSync(prdSplitLockPath(tmpRoot, 'req-001'))).toBe(true)
  })
})

describe('PrdSplitService.appendProposal — issue 05', () => {
  it('appends a proposal with ordinal + suggested_status=backlog', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    const r = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'mcp-propose_card-1',
      input: { title: '退款接口', content: '实现退款', suggested_priority: 'high', labels: ['p0'] },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.created).toBe(true)
    expect(r.proposal.ordinal).toBe(1)
    expect(r.proposal.suggested_status).toBe('backlog')
    expect(r.proposal.suggested_priority).toBe('high')
    expect(r.proposal.title).toBe('退款接口')
  })

  it('assigns incrementing ordinals across calls', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-1',
      input: { title: 'a' },
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-2',
      input: { title: 'b' },
    })
    const r3 = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-3',
      input: { title: 'c' },
    })
    expect(r3.ok).toBe(true)
    if (!r3.ok) return
    expect(r3.proposal.ordinal).toBe(3)
  })

  it('is idempotent by tool_use_id (duplicate → created=false)', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-dup',
      input: { title: 'a' },
    })
    const r2 = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-dup',
      input: { title: 'a CHANGED' },
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.created).toBe(false)
    expect(r2.proposal.title).toBe('a') // 不覆盖
  })

  it('rejects empty title (invalid_input)', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    const r = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-bad',
      input: { title: '   ' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('invalid_input')
  })

  it('rejects when run not found', async () => {
    seedReq('req-001')
    const r = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-nope',
      toolUseId: 'tu-x',
      input: { title: 'a' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_not_found')
  })

  it('rejects when run not running (after succeeded)', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    svc.transitionToSucceeded('req-001', 'prd-test-aaaaaa')
    const r = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-after',
      input: { title: 'a' },
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_not_running')
  })

  it('defaults suggested_priority to null when omitted', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    const r = svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-nopr',
      input: { title: 'a' },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.proposal.suggested_priority).toBeNull()
  })

  it('updates meta.yaml actual_count after append', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 3,
      useContext: [],
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-1',
      input: { title: 'a' },
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-2',
      input: { title: 'b' },
    })
    const meta = svc.readMeta('req-001', 'prd-test-aaaaaa')
    expect(meta?.actual_count).toBe(2)
  })
})

describe('PrdSplitService transitions — issue 05', () => {
  it('transitionToSucceeded sets status + finished_at + actual_count', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 2,
      useContext: [],
    })
    svc.appendProposal({
      requirementId: 'req-001',
      runId: 'prd-test-aaaaaa',
      toolUseId: 'tu-1',
      input: { title: 'a' },
    })
    const r = svc.transitionToSucceeded('req-001', 'prd-test-aaaaaa')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.run.status).toBe('succeeded')
    expect(r.run.finished_at).toBe('2026-08-07T08:00:00.000Z')
    expect(r.run.actual_count).toBe(1)
  })

  it('transitionToFailed sets error + status', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 2,
      useContext: [],
    })
    const r = svc.transitionToFailed('req-001', 'prd-test-aaaaaa', 'SDK timeout')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.run.status).toBe('failed')
    expect(r.run.error).toBe('SDK timeout')
  })

  it('releaseLock after transition allows new Run', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 2,
      useContext: [],
    })
    svc.transitionToSucceeded('req-001', 'prd-test-aaaaaa')
    await svc.releaseLock('req-001')
    const r2 = await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 2,
      useContext: [],
    })
    expect(r2.ok).toBe(true)
  })
})

describe('PrdSplitService read / list / delete — issue 05', () => {
  it('readCards returns [] for missing run', () => {
    expect(svc.readCards('req-x', 'prd-nope')).toEqual([])
  })

  it('listRuns returns sorted-by-created_at-desc', async () => {
    seedReq('req-001')
    let n = 0
    const svc2 = new PrdSplitService({
      root: tmpRoot,
      runIdFactory: () => [`prd-a`, `prd-b`, `prd-c`][n++],
      nowIso: () => [`2026-08-07T08:00:00.000Z`, `2026-08-07T09:00:00.000Z`, `2026-08-07T07:00:00.000Z`][n - 1],
    })
    for (const g of ['粗', '中', '细'] as const) {
      await svc2.createRun({
        requirementId: 'req-001',
        granularity: g,
        expectedCount: 1,
        useContext: [],
      })
      await svc2.releaseLock('req-001')
      // reset n/nowIso offset by recreating with new factory closure vars
    }
    const runs = svc2.listRuns('req-001')
    expect(runs).toHaveLength(3)
    // created_at 倒序(09:00 > 08:00 > 07:00)
    expect(runs[0]!.run_id).toBe('prd-b')
    expect(runs[2]!.run_id).toBe('prd-c')
  })

  it('deleteRun removes dir; rejects when running', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 1,
      useContext: [],
    })
    // running → reject
    const r1 = svc.deleteRun('req-001', 'prd-test-aaaaaa')
    expect(r1.ok).toBe(false)
    if (r1.ok) return
    expect(r1.code).toBe('run_still_running')
    // succeed → delete
    svc.transitionToSucceeded('req-001', 'prd-test-aaaaaa')
    const r2 = svc.deleteRun('req-001', 'prd-test-aaaaaa')
    expect(r2.ok).toBe(true)
    expect(existsSync(proposalMetaPathFor(tmpRoot, 'req-001', 'prd-test-aaaaaa'))).toBe(false)
  })

  it('deleteRun 404 on unknown', () => {
    seedReq('req-001')
    const r = svc.deleteRun('req-001', 'prd-nope')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.code).toBe('run_not_found')
  })
})

describe('PrdSplitService.reconcileOrphanRuns — issue 05', () => {
  it('converges orphan running Run to failed on boot', async () => {
    seedReq('req-001')
    await svc.createRun({
      requirementId: 'req-001',
      granularity: '粗',
      expectedCount: 1,
      useContext: [],
    })
    // 模拟 agent 重启:新 svc 实例(无 in-flight 句柄)
    const svc2 = new PrdSplitService({ root: tmpRoot })
    const result = await svc2.reconcileOrphanRuns()
    expect(result.recovered).toHaveLength(1)
    expect(result.recovered[0]!.runId).toBe('prd-test-aaaaaa')
    const meta = svc2.readMeta('req-001', 'prd-test-aaaaaa')
    expect(meta?.status).toBe('failed')
    expect(meta?.error).toBe('agent_restart_orphan_recovery')
    // lock 被释放
    expect(existsSync(prdSplitLockPath(tmpRoot, 'req-001'))).toBe(false)
  })

  it('no-op when no running Runs', async () => {
    seedReq('req-001')
    const result = await svc.reconcileOrphanRuns()
    expect(result.recovered).toEqual([])
  })
})
