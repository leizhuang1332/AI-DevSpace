/**
 * analysis-snapshot helper 单元测试(ticket 06 · ADR-0020 D10)
 *
 * 直接对 helpers 跑 round-trip:write chunks.jsonl → snapshot → list → restore。
 * 不走 REST 路由(端到端在 routes-analysis-start.test.ts)。
 *
 * 覆盖:
 * - snapshotSessionBeforeTurn / stampSnapshotSession 写入正确路径
 * - listSessionSnapshots 正确过滤(只列存在的 id,sidecar .session-id 读取)
 * - restoreSnapshot 写回 chunks.jsonl 行数还原 + 空 snapshot 报 404
 * - removeSessionSnapshot best-effort
 * - env 未设时所有 helper 静默 no-op
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SESSION_SNAPSHOT_IDS,
  takeSessionSnapshot,
  removeSessionSnapshot,
  listSessionSnapshots,
  restoreSnapshot,
  isSessionSnapshotId,
} from '../routes/analysis-snapshot.js'

let root: string
let snapshotDir: string
let sessionDir: string
let workDir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidevsp-as-helper-'))
  snapshotDir = mkdtempSync(join(tmpdir(), 'aidevsp-as-helper-snap-'))
  process.env.AIDEVSPACE_ROOT = root
  process.env.AIDEVSPACE_SNAPSHOT_DIR = snapshotDir
  // workspaceRoot() 走 AIDEVSPACE_ROOT → 在 root 下造一个 req 的 sessionDir
  workDir = join(root, 'requirements', 'req-helper', 'analysis', 'sessions', 'sess-helper')
  sessionDir = workDir
  mkdirSync(sessionDir, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(snapshotDir, { recursive: true, force: true })
  delete process.env.AIDEVSPACE_ROOT
  delete process.env.AIDEVSPACE_SNAPSHOT_DIR
})

describe('analysis-snapshot helpers (ADR-0020 D10)', () => {
  it('SESSION_SNAPSHOT_IDS 暴露两个语义 id', () => {
    expect(SESSION_SNAPSHOT_IDS).toEqual(['before_admission', 'before_brainstorm'])
  })

  it('isSessionSnapshotId:白名单校验', () => {
    expect(isSessionSnapshotId('before_admission')).toBe(true)
    expect(isSessionSnapshotId('before_brainstorm')).toBe(true)
    expect(isSessionSnapshotId('bogus')).toBe(false)
    expect(isSessionSnapshotId(undefined)).toBe(false)
    expect(isSessionSnapshotId(null)).toBe(false)
    expect(isSessionSnapshotId(42)).toBe(false)
  })

  it('takeSessionSnapshot 原子写入 chunks.jsonl + .session-id sidecar', () => {
    writeFileSync(join(sessionDir, 'chunks.jsonl'), '{"id":"a"}\n{"id":"b"}\n', 'utf8')
    takeSessionSnapshot(sessionDir, 'req-helper', 'before_admission', 'sess-helper')

    expect(existsSync(join(snapshotDir, 'req-helper', 'before_admission', 'chunks.jsonl'))).toBe(true)
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_admission', '.session-id'))).toBe(true)
    expect(readFileSync(join(snapshotDir, 'req-helper', 'before_admission', '.session-id'), 'utf8')).toBe(
      'sess-helper',
    )
    expect(readFileSync(join(snapshotDir, 'req-helper', 'before_admission', 'chunks.jsonl'), 'utf8')).toBe(
      '{"id":"a"}\n{"id":"b"}\n',
    )
  })

  it('takeSessionSnapshot:source 不存在时只建空目录(不抛)', () => {
    takeSessionSnapshot(sessionDir, 'req-helper', 'before_brainstorm', 'sess-helper')
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_brainstorm'))).toBe(true)
    // chunks.jsonl 不应被创建(因为 source 不存在)
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_brainstorm', 'chunks.jsonl'))).toBe(false)
  })

  it('listSessionSnapshots 只列存在的 id,空 req 返 []', () => {
    expect(listSessionSnapshots('req-missing')).toEqual([])

    // 预写 source chunks.jsonl(snapshot helper 只在 source 存在时拷出 chunks.jsonl)
    writeFileSync(join(sessionDir, 'chunks.jsonl'), '{"id":"x"}\n', 'utf8')
    takeSessionSnapshot(sessionDir, 'req-helper', 'before_admission', 'sess-helper')
    const list = listSessionSnapshots('req-helper')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('before_admission')
    expect(list[0].sessionId).toBe('sess-helper')
    expect(typeof list[0].takenAt).toBe('string')
  })

  it('removeSessionSnapshot:best-effort 删除,目录不存在时静默', () => {
    takeSessionSnapshot(sessionDir, 'req-helper', 'before_admission', 'sess-helper')
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_admission'))).toBe(true)
    removeSessionSnapshot('req-helper', 'before_admission')
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_admission'))).toBe(false)
    // 重复 remove 不抛
    removeSessionSnapshot('req-helper', 'before_admission')
    expect(existsSync(join(snapshotDir, 'req-helper', 'before_admission'))).toBe(false)
  })

  it('restoreSnapshot:把 snapshot 写回 latest session 的 chunks.jsonl', () => {
    // 把 sessionDir 下的 chunks.jsonl 写成 turn-1 + turn-2 的产物
    writeFileSync(join(sessionDir, 'chunks.jsonl'), '{"id":"t1"}\n{"id":"t2"}\n', 'utf8')
    // snapshot = turn-1 开始时的空 jsonl(预建 dir + 写空文件)
    mkdirSync(join(snapshotDir, 'req-helper', 'before_admission'), { recursive: true })
    writeFileSync(
      join(snapshotDir, 'req-helper', 'before_admission', 'chunks.jsonl'),
      '',
      'utf8',
    )

    const result = restoreSnapshot('req-helper', 'before_admission')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.restoredSessionId).toBe('sess-helper')
      expect(result.chunksLines).toBe(0)
      expect(readFileSync(join(sessionDir, 'chunks.jsonl'), 'utf8')).toBe('')
    }
  })

  it('restoreSnapshot:不存在的 snapshot_id → ok:false snapshot_not_found', () => {
    const result = restoreSnapshot('req-helper', 'before_admission')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('snapshot_not_found')
    }
  })

  it('restoreSnapshot:env 未设 → ok:false snapshot_dir_unset', () => {
    delete process.env.AIDEVSPACE_SNAPSHOT_DIR
    const result = restoreSnapshot('req-helper', 'before_admission')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('snapshot_dir_unset')
    }
  })

  it('snapshot 失败(snapshot 父是已存在文件):helper 静默 no-op,后续 turn 不阻断', () => {
    // 把 AIDEVSPACE_SNAPSHOT_DIR 改成"已存在的文件",让 mkdirSync 失败
    const blocker = mkdtempSync(join(tmpdir(), 'aidevsp-as-block-'))
    try {
      writeFileSync(join(blocker, 'blocker'), '', 'utf8')
      process.env.AIDEVSPACE_SNAPSHOT_DIR = join(blocker, 'blocker')

      writeFileSync(join(sessionDir, 'chunks.jsonl'), '{"id":"x"}\n', 'utf8')
      // 不抛
      takeSessionSnapshot(sessionDir, 'req-helper', 'before_admission', 'sess-helper')

      // list 返空(因 mkdirSync 失败,目录未建)
      expect(listSessionSnapshots('req-helper')).toEqual([])
    } finally {
      rmSync(blocker, { recursive: true, force: true })
    }
  })
})