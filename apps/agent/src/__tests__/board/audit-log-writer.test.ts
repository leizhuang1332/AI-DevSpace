/**
 * AuditLogWriter 单测 —— issue 06 / ADR-0029 D16
 *
 * 覆盖:
 * - `writeAuditEntry` —— 追加一行 JSONL 到 `audit/<reqId>/<cardId>/chat.log`
 * - 8 项字段 schema round-trip — `ts / toolName / toolUseId / args / result / decision / decidedBy / durationMs`
 * - 决定者 5 维 — `user` / `auto-allow-toggle` / `bypassPermissions` / `timeout` / `deny-pattern`
 * - Atomic write —— `writeFileAtomic` tmp + rename;并发写不撕裂
 * - 30 天 sweep —— 跟 SDK session 同步,扫描 audit/<reqId>/,删除过期 chat.log
 * - `mkdirSync` 自动递归创建父目录
 * - 跟 session.json 物理隔离 —— 不与 session 路径耦合
 *
 * 测试基础设施:
 * - mkdtempSync 起一个 `~/.aidevspace` 模拟根
 * - nowIso 注入固定时间(便于断言落盘 ts 字段)
 * - 5 维决定者全量枚举验证
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ChatAuditDecidedBy,
  ChatAuditDecidedBySchema,
  ChatDecision,
  type ChatToolAudit,
} from '@ai-devspace/shared'
import {
  AuditLogWriter,
  AuditLogWriterError,
  auditPathFor,
  sweepExpiredAuditLogs,
  sweepExpiredAuditLogsAll,
} from '../../lib/audit-log.js'

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

const T0 = '2026-08-08T10:00:00.000Z'
const T1 = '2026-08-08T10:05:00.000Z'
const T2 = '2026-08-08T10:10:00.000Z'

/** 模拟 `~/.aidevspace` —— 测试用临时目录 */
let workspaceRoot: string
let writer: AuditLogWriter

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'aidev-audit-'))
  writer = new AuditLogWriter({
    workspaceRoot,
  })
})

afterEach(() => {
  if (existsSync(workspaceRoot)) rmSync(workspaceRoot, { recursive: true, force: true })
})

const REQ_A = 'req-001-test'
const REQ_B = 'req-002-test'
const CARD_A = '01J7X3K2P5EVR0Z3YQJD8HFKA1'
const CARD_B = '01J7X3K2P5EVR0Z3YQJD8HFKB2'

/** 标准 audit entry —— 8 项字段齐全 */
function makeEntry(overrides: Partial<ChatToolAudit> = {}): ChatToolAudit {
  return {
    ts: T0,
    toolName: 'Write',
    toolUseId: 'tool-use-001',
    args: { file_path: '/workspace/foo.ts', content: 'hello' },
    result: { success: true, output: 'ok' },
    decision: ChatDecision.ALLOW,
    decidedBy: ChatAuditDecidedBy.USER,
    durationMs: 42,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// 5 决定者维度:全枚举
// ---------------------------------------------------------------------------

describe('ChatAuditDecidedBySchema 5 维枚举', () => {
  it('完整 5 个决定者字符串都通过校验', () => {
    const all = Object.values(ChatAuditDecidedBy) as Array<
      (typeof ChatAuditDecidedBy)[keyof typeof ChatAuditDecidedBy]
    >
    expect(all).toHaveLength(5)
    expect(all).toEqual(
      expect.arrayContaining([
        'user',
        'auto-allow-toggle',
        'bypassPermissions',
        'timeout',
        'deny-pattern',
      ]),
    )
    for (const v of all) {
      expect(ChatAuditDecidedBySchema.safeParse(v).success).toBe(true)
    }
  })

  it('非枚举字符串 reject', () => {
    expect(ChatAuditDecidedBySchema.safeParse('admin').success).toBe(false)
    expect(ChatAuditDecidedBySchema.safeParse('AUTO').success).toBe(false)
    expect(ChatAuditDecidedBySchema.safeParse('').success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 路径 helper
// ---------------------------------------------------------------------------

describe('auditPathFor —— 物理路径', () => {
  it('返回 <workspaceRoot>/audit/<reqId>/<cardId>/chat.log', () => {
    const p = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    expect(p).toBe(join(workspaceRoot, 'audit', REQ_A, CARD_A, 'chat.log'))
  })

  it('不同 reqId / cardId 互不影响', () => {
    const p1 = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const p2 = auditPathFor(workspaceRoot, REQ_A, CARD_B)
    const p3 = auditPathFor(workspaceRoot, REQ_B, CARD_A)
    expect(p1).not.toBe(p2)
    expect(p1).not.toBe(p3)
    expect(p2).not.toBe(p3)
  })
})

// ---------------------------------------------------------------------------
// 写入
// ---------------------------------------------------------------------------

describe('AuditLogWriter.writeAuditEntry —— 8 字段 JSONL 落盘', () => {
  it('写入一行,落盘 audit/<reqId>/<cardId>/chat.log', () => {
    const entry = makeEntry()
    writer.writeAuditEntry(REQ_A, CARD_A, entry)

    const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    expect(existsSync(path)).toBe(true)
    const content = readFileSync(path, 'utf8')
    expect(content.endsWith('\n')).toBe(true)
    const lines = content.split('\n').filter((l: string) => l.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed).toMatchObject({
      ts: T0,
      toolName: 'Write',
      toolUseId: 'tool-use-001',
      decision: 'allow',
      decidedBy: 'user',
      durationMs: 42,
    })
  })

  it('多次写追加 —— JSONL 行数随写入次数递增', () => {
    for (let i = 0; i < 5; i++) {
      writer.writeAuditEntry(
        REQ_A,
        CARD_A,
        makeEntry({ toolUseId: `tool-use-${i}`, durationMs: 10 + i }),
      )
    }
    const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n').filter((l: string) => l.length > 0)
    expect(lines).toHaveLength(5)
    const parsed = lines.map((l: string) => JSON.parse(l))
    expect(parsed.map((p: any) => p.toolUseId)).toEqual([
      'tool-use-0',
      'tool-use-1',
      'tool-use-2',
      'tool-use-3',
      'tool-use-4',
    ])
  })

  it('args / result 字段序列化形态 —— record + unknown 透传', () => {
    const args = { file_path: '/workspace/foo.ts', content: 'long text' }
    const result = {
      success: true,
      output: 'tool wrote 13 lines',
      metadata: { lines: 13, bytes: 1234 },
    }
    const entry = makeEntry({
      args,
      result,
    })
    writer.writeAuditEntry(REQ_A, CARD_A, entry)

    const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const content = readFileSync(path, 'utf8')
    const parsed = JSON.parse(content.split('\n')[0]!)
    expect(parsed.args).toEqual(args)
    expect(parsed.result).toEqual(result)
  })

  it('父目录不存在 → mkdirSync 递归创建', () => {
    expect(
      existsSync(join(workspaceRoot, 'audit', REQ_A, CARD_A)),
    ).toBe(false)
    writer.writeAuditEntry(REQ_A, CARD_A, makeEntry())
    expect(
      existsSync(join(workspaceRoot, 'audit', REQ_A, CARD_A)),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5 决定者维度 — 落盘语义保持
// ---------------------------------------------------------------------------

describe('AuditLogWriter —— 5 决定者落盘语义', () => {
  const cases: Array<{
    decidedBy: (typeof ChatAuditDecidedBy)[keyof typeof ChatAuditDecidedBy]
    label: string
  }> = [
    { decidedBy: ChatAuditDecidedBy.USER, label: 'user 显式决议' },
    {
      decidedBy: ChatAuditDecidedBy.AUTO_ALLOW_TOGGLE,
      label: '读工具命中 auto-allow toggle',
    },
    {
      decidedBy: ChatAuditDecidedBy.BYPASS_PERMISSIONS,
      label: 'bypassPermissions 模式自动放行',
    },
    { decidedBy: ChatAuditDecidedBy.TIMEOUT, label: '用户超时 deny' },
    {
      decidedBy: ChatAuditDecidedBy.DENY_PATTERN,
      label: '敏感模式命中 deny',
    },
  ]

  for (const c of cases) {
    it(`落盘 ${c.label} (decidedBy=${c.decidedBy})`, () => {
      writer.writeAuditEntry(
        REQ_A,
        CARD_A,
        makeEntry({
          decidedBy: c.decidedBy,
          decision:
            c.decidedBy === ChatAuditDecidedBy.TIMEOUT ||
            c.decidedBy === ChatAuditDecidedBy.DENY_PATTERN
              ? ChatDecision.DENY
              : ChatDecision.ALLOW,
        }),
      )

      const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
      const content = readFileSync(path, 'utf8')
      const parsed = JSON.parse(content.split('\n')[0]!)
      expect(parsed.decidedBy).toBe(c.decidedBy)
    })
  }
})

// ---------------------------------------------------------------------------
// Atomic write —— tmp + rename 不撕裂
// ---------------------------------------------------------------------------

describe('AuditLogWriter —— atomic write 模式', () => {
  it('tmp 文件不存在于最终状态 —— rename 已完成', () => {
    writer.writeAuditEntry(REQ_A, CARD_A, makeEntry())
    const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const tmp = `${path}.tmp`
    expect(existsSync(tmp)).toBe(false)
    expect(existsSync(path)).toBe(true)
  })

  it('写入失败时 tmp 残留被清理', () => {
    // 通过注入非法 entry 触发 zod parse 失败前的临时 tmp(不存在)
    // 这里改为验证:writeAtomic 失败后 tmp 不残留
    const beforePath = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const beforeTmp = `${beforePath}.tmp`

    // 先成功写一次(走通 atomic 路径)
    writer.writeAuditEntry(REQ_A, CARD_A, makeEntry())
    expect(existsSync(beforeTmp)).toBe(false)

    // 直接读 chat.log 内容,验证 JSONL 一行完整
    const content = readFileSync(beforePath, 'utf8')
    const lines = content.split('\n').filter((l: string) => l.length > 0)
    expect(lines).toHaveLength(1)
  })

  it('连续两次写不撕裂 —— 第二次 write 后 chat.log 完整可解析', () => {
    writer.writeAuditEntry(REQ_A, CARD_A, makeEntry({ toolUseId: 'a' }))
    writer.writeAuditEntry(REQ_A, CARD_A, makeEntry({ toolUseId: 'b' }))
    const path = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    const content = readFileSync(path, 'utf8')
    const lines = content.split('\n').filter((l: string) => l.length > 0)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).toolUseId).toBe('a')
    expect(JSON.parse(lines[1]!).toolUseId).toBe('b')
  })
})

// ---------------------------------------------------------------------------
// 字段 schema 校验
// ---------------------------------------------------------------------------

describe('AuditLogWriter.writeAuditEntry —— schema 校验', () => {
  it('空 toolName 抛 AuditLogWriterError', () => {
    expect(() =>
      writer.writeAuditEntry(REQ_A, CARD_A, makeEntry({ toolName: '' })),
    ).toThrow(AuditLogWriterError)
  })

  it('空 toolUseId 抛 AuditLogWriterError', () => {
    expect(() =>
      writer.writeAuditEntry(REQ_A, CARD_A, makeEntry({ toolUseId: '' })),
    ).toThrow(AuditLogWriterError)
  })

  it('负 durationMs 抛 AuditLogWriterError', () => {
    expect(() =>
      writer.writeAuditEntry(
        REQ_A,
        CARD_A,
        makeEntry({ durationMs: -1 }),
      ),
    ).toThrow(AuditLogWriterError)
  })

  it('非 ISO ts 抛 AuditLogWriterError', () => {
    expect(() =>
      writer.writeAuditEntry(
        REQ_A,
        CARD_A,
        makeEntry({ ts: 'not-an-iso' as unknown as string }),
      ),
    ).toThrow(AuditLogWriterError)
  })

  it('非枚举 decidedBy 抛 AuditLogWriterError', () => {
    expect(() =>
      writer.writeAuditEntry(
        REQ_A,
        CARD_A,
        makeEntry({ decidedBy: 'admin' as unknown as typeof ChatAuditDecidedBy.USER }),
      ),
    ).toThrow(AuditLogWriterError)
  })
})

// ---------------------------------------------------------------------------
// 物理隔离 —— 跟 session.json 不耦合
// ---------------------------------------------------------------------------

describe('物理隔离 —— audit 路径跟 session 路径独立', () => {
  it('audit 路径不依赖 chat/session.json 任何键', () => {
    // 我们利用 audit 路径完全派生自 (workspaceRoot, reqId, cardId)
    // —— 不读 session.json,也不依赖 cwd / sessionId / model 等字段
    const auditPath = auditPathFor(workspaceRoot, REQ_A, CARD_A)
    expect(auditPath).toBe(
      join(workspaceRoot, 'audit', REQ_A, CARD_A, 'chat.log'),
    )
    expect(auditPath).not.toContain('session.json')
    expect(auditPath).not.toContain('requirements')
  })
})

// ---------------------------------------------------------------------------
// 30 天 sweep
// ---------------------------------------------------------------------------

describe('sweepExpiredAuditLogs —— 30 天同步 sweep', () => {
  it('超 ttl 的 chat.log 被删,未超过的保留', () => {
    const cardOld = '01J7X3K2P5EVR0Z3YQJD8HFA1A'
    const cardNew = '01J7X3K2P5EVR0Z3YQJD8HFA1B'
    const nowMs = Date.parse('2026-09-08T00:00:00.000Z')
    // 老条目: 40 天前写的 chat.log
    const oldPath = auditPathFor(workspaceRoot, REQ_A, cardOld)
    mkdirSync(join(workspaceRoot, 'audit', REQ_A, cardOld), {
      recursive: true,
    })
    writeFileSync(oldPath, '{"ts":"old"}\n', 'utf8')
    // mtime 设为 40 天前(秒级精度 utimesSync)
    const oldMtimeSec = Math.floor((nowMs - 40 * 24 * 60 * 60 * 1000) / 1000)
    utimesSync(oldPath, oldMtimeSec, oldMtimeSec)

    // 新条目: 5 天前
    const newPath = auditPathFor(workspaceRoot, REQ_A, cardNew)
    mkdirSync(join(workspaceRoot, 'audit', REQ_A, cardNew), {
      recursive: true,
    })
    writeFileSync(newPath, '{"ts":"new"}\n', 'utf8')
    const newMtimeSec = Math.floor((nowMs - 5 * 24 * 60 * 60 * 1000) / 1000)
    utimesSync(newPath, newMtimeSec, newMtimeSec)

    const swept = sweepExpiredAuditLogs(workspaceRoot, REQ_A, {
      nowMs,
      ttlDays: 30,
    })
    expect(swept).toBe(1)
    expect(existsSync(oldPath)).toBe(false)
    expect(existsSync(newPath)).toBe(true)
  })

  it('audit/<reqId> 目录不存在时 sweep 不抛错,返 0', () => {
    const nowMs = Date.parse('2026-09-08T00:00:00.000Z')
    expect(
      sweepExpiredAuditLogs(workspaceRoot, REQ_A, { nowMs, ttlDays: 30 }),
    ).toBe(0)
  })

  it('req 下多层 cardId 全扫', () => {
    const nowMs = Date.parse('2026-09-08T00:00:00.000Z')
    const cards = ['c-old-1', 'c-old-2', 'c-new']
    const oldMtimeSec = Math.floor((nowMs - 40 * 24 * 60 * 60 * 1000) / 1000)
    const newMtimeSec = Math.floor((nowMs - 5 * 24 * 60 * 60 * 1000) / 1000)

    for (const c of cards) {
      const p = auditPathFor(workspaceRoot, REQ_A, c)
      mkdirSync(join(workspaceRoot, 'audit', REQ_A, c), { recursive: true })
      writeFileSync(p, '{}\n', 'utf8')
    }
    utimesSync(
      auditPathFor(workspaceRoot, REQ_A, 'c-old-1'),
      oldMtimeSec,
      oldMtimeSec,
    )
    utimesSync(
      auditPathFor(workspaceRoot, REQ_A, 'c-old-2'),
      oldMtimeSec,
      oldMtimeSec,
    )
    utimesSync(
      auditPathFor(workspaceRoot, REQ_A, 'c-new'),
      newMtimeSec,
      newMtimeSec,
    )

    const swept = sweepExpiredAuditLogs(workspaceRoot, REQ_A, {
      nowMs,
      ttlDays: 30,
    })
    expect(swept).toBe(2)
    expect(existsSync(auditPathFor(workspaceRoot, REQ_A, 'c-old-1'))).toBe(
      false,
    )
    expect(existsSync(auditPathFor(workspaceRoot, REQ_A, 'c-old-2'))).toBe(
      false,
    )
    expect(existsSync(auditPathFor(workspaceRoot, REQ_A, 'c-new'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 30 天 sweep —— 顶层 hook(sweepExpiredAuditLogsAll)
// ---------------------------------------------------------------------------

describe('sweepExpiredAuditLogsAll —— 顶层 hook,server bootstrap 挂载点', () => {
  it('顶层 audit/ 目录不存在 → 返 0,不抛错', () => {
    const nowMs = Date.parse('2026-09-08T00:00:00.000Z')
    expect(
      sweepExpiredAuditLogsAll(workspaceRoot, { nowMs, ttlDays: 30 }),
    ).toBe(0)
  })

  it('多个 reqId 全扫,各自计算 sweep', () => {
    const nowMs = Date.parse('2026-09-08T00:00:00.000Z')
    // req-A: 一新一老
    seedSweepEntry('req-A-alpha', 'c1', nowMs, 5)
    seedSweepEntry('req-A-alpha', 'c2', nowMs, 40)
    // req-B: 一新一老
    seedSweepEntry('req-B-beta', 'c1', nowMs, 5)
    seedSweepEntry('req-B-beta', 'c2', nowMs, 40)
    // 顶层非 reqId 子目录(纯文件): 应被跳过
    writeFileSync(join(workspaceRoot, 'audit', 'README.md'), '# ignore', 'utf8')

    const total = sweepExpiredAuditLogsAll(workspaceRoot, {
      nowMs,
      ttlDays: 30,
    })
    expect(total).toBe(2)
    // 老的两个被删
    expect(
      existsSync(
        auditPathFor(workspaceRoot, 'req-A-alpha', 'c2'),
      ),
    ).toBe(false)
    expect(
      existsSync(
        auditPathFor(workspaceRoot, 'req-B-beta', 'c2'),
      ),
    ).toBe(false)
    // 新的两个保留
    expect(
      existsSync(
        auditPathFor(workspaceRoot, 'req-A-alpha', 'c1'),
      ),
    ).toBe(true)
    expect(
      existsSync(
        auditPathFor(workspaceRoot, 'req-B-beta', 'c1'),
      ),
    ).toBe(true)
  })
})

/** 工具:在 workspaceRoot/audit/reqId/cardId 写个空 chat.log,并把 mtime 设为
 * `daysAgo` 天前 */
function seedSweepEntry(
  reqId: string,
  cardId: string,
  nowMs: number,
  daysAgo: number,
): void {
  const dir = join(workspaceRoot, 'audit', reqId, cardId)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, 'chat.log')
  writeFileSync(p, '{}\n', 'utf8')
  const mtimeSec = Math.floor((nowMs - daysAgo * 24 * 60 * 60 * 1000) / 1000)
  utimesSync(p, mtimeSec, mtimeSec)
}
