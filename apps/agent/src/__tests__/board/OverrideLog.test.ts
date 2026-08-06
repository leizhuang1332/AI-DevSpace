/**
 * OverrideLog 单元测试 —— issue 03 / ADR-0025 D2
 *
 * 覆盖(issue 03 ticket 4):
 * - 文件位置:`~/.aidevspace/requirements/<id>/board/overrides.log`
 * - JSONL 格式,append-only(同 req 多条独立行)
 * - 自动 `mkdir -p board/`(父目录不存在时建)
 * - `card_id` 是数组(命中多张冲突卡);`ts` / `kind` / `parent_status` 齐
 * - `appendFromConflict` 便捷方法把 conflicts 数组转 entry
 * - 注入 clock 后 ts 来自 clock(测试可控)
 * - 写盘失败抛 Error(不静默吞)
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OverrideLog } from '../../services/board/OverrideLog.js'
import type { ConstraintConflict } from '../../services/board/StatusConstraintGuard.js'
import { RequirementStatus } from '@ai-devspace/shared'

let root: string
let log: OverrideLog

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-overrides-'))
  const fixedDate = new Date('2026-08-06T08:00:00.000Z')
  log = new OverrideLog({ root }, () => fixedDate)
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// 文件位置 / 格式
// ---------------------------------------------------------------------------

describe('OverrideLog — file location and format', () => {
  it('writes JSONL line to ~/.aidevspace/requirements/<id>/board/overrides.log', () => {
    log.append('req-001', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.IMPLEMENTING,
      card_id: ['01J7X3K2P5EVR0Z3YQJD8HFKAA'],
      rules: ['no_backlog_for_implementing'],
    })

    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    expect(existsSync(file)).toBe(true)
    const content = readFileSync(file, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    const parsed = JSON.parse(content.trim())
    expect(parsed).toMatchObject({
      ts: '2026-08-06T08:00:00.000Z',
      kind: 'child_status_force_apply',
      parent_status: 'implementing',
      card_id: ['01J7X3K2P5EVR0Z3YQJD8HFKAA'],
      rules: ['no_backlog_for_implementing'],
    })
  })

  it('appends (does not overwrite) when called multiple times', () => {
    log.append('req-001', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.IMPLEMENTING,
      card_id: ['CARD_A'],
      rules: ['no_backlog_for_implementing'],
    })
    log.append('req-001', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.SUBMITTING,
      card_id: ['CARD_B'],
      rules: ['no_in_progress_for_submitting'],
    })

    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    const first = JSON.parse(lines[0]!)
    const second = JSON.parse(lines[1]!)
    expect(first.parent_status).toBe('implementing')
    expect(second.parent_status).toBe('submitting')
  })

  it('creates the parent board/ directory if missing', () => {
    // 注入一个 req 路径不预先建 —— append 应自动 mkdir
    expect(
      existsSync(join(root, 'requirements', 'req-fresh', 'board')),
    ).toBe(false)
    log.append('req-fresh', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.DONE,
      card_id: ['CARD_X'],
      rules: ['all_done_for_parent_done'],
    })
    expect(
      existsSync(join(root, 'requirements', 'req-fresh', 'board')),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// appendFromConflict
// ---------------------------------------------------------------------------

describe('OverrideLog — appendFromConflict', () => {
  it('flattens multiple conflicts into one entry (card_id array, rules array)', () => {
    const conflicts: ConstraintConflict[] = [
      {
        card_id: 'CARD_A',
        card_status: 'backlog',
        rule: 'no_backlog_for_implementing',
      },
      {
        card_id: 'CARD_B',
        card_status: 'backlog',
        rule: 'no_backlog_for_implementing',
      },
    ]
    log.appendFromConflict('req-001', {
      kind: 'child_status_force_apply',
      parentStatus: RequirementStatus.IMPLEMENTING,
      conflicts,
    })
    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.card_id).toEqual(['CARD_A', 'CARD_B'])
    expect(parsed.rules).toEqual([
      'no_backlog_for_implementing',
      'no_backlog_for_implementing',
    ])
    expect(parsed.parent_status).toBe('implementing')
    expect(parsed.kind).toBe('child_status_force_apply')
  })

  it('records a single conflict as a one-element array (issue 03 ticket 4 semantics)', () => {
    log.appendFromConflict('req-001', {
      kind: 'child_status_force_apply',
      parentStatus: RequirementStatus.SUBMITTING,
      conflicts: [
        {
          card_id: 'CARD_A',
          card_status: 'in_progress',
          rule: 'no_in_progress_for_submitting',
        },
      ],
    })
    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.card_id).toEqual(['CARD_A'])
    expect(parsed.rules).toEqual(['no_in_progress_for_submitting'])
  })
})

// ---------------------------------------------------------------------------
// ts / 时钟
// ---------------------------------------------------------------------------

describe('OverrideLog — clock injection', () => {
  it('uses the injected clock when no explicit ts is given', () => {
    const custom = new OverrideLog(
      { root },
      () => new Date('2030-01-01T00:00:00.000Z'),
    )
    custom.append('req-001', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.DONE,
      card_id: ['CARD'],
      rules: ['all_done_for_parent_done'],
    })
    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.ts).toBe('2030-01-01T00:00:00.000Z')
  })

  it('honors an explicit ts over the clock', () => {
    log.append('req-001', {
      kind: 'child_status_force_apply',
      parent_status: RequirementStatus.DONE,
      card_id: ['CARD'],
      rules: ['all_done_for_parent_done'],
      ts: '2025-12-31T23:59:59.999Z',
    })
    const file = join(root, 'requirements', 'req-001', 'board', 'overrides.log')
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    expect(parsed.ts).toBe('2025-12-31T23:59:59.999Z')
  })
})