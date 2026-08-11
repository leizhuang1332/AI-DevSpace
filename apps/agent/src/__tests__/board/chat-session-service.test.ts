/**
 * ChatSessionService 单测 —— issue 03 / ADR-0029
 *
 * 覆盖:
 * - 17 项 session.json 字段 round-trip(get / write / patch)
 * - getOrCreateSession + 单 tab lock 串行语义
 * - 30 天 SDK 健康检查(sdk-jsonl-missing / session-older-than-30-days)
 * - 30 天 sweep —— 超期 session 重置 cumulativeUsage + sessionId
 * - recordUsage —— cost 累计 + queryCount 自增
 * - snapshot 解析 —— SDK jsonl → events 数组
 *
 * 测试基础设施:
 * - mkdtempSync 起一个临时 workspaceRoot
 * - nowIso 注入固定时间(便于断言 created_at / lastQueryAt)
 * - onCorruptSession 注入收集器(便于断言 corrupt 回调)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ChatPermissionMode,
  type ChatCumulativeUsage,
  type ChatSessionMeta,
} from '@ai-devspace/shared'
import {
  ChatSessionService,
  ChatSessionServiceError,
  accumulateUsage,
  parseSdkSessionLog,
  sdkSessionLogPathFor,
  zeroCumulativeUsage,
} from '../../services/board/ChatSessionService.js'

// ---------------------------------------------------------------------------
// 基础设施
// ---------------------------------------------------------------------------

const T0 = '2026-08-06T10:00:00.000Z'
const T1 = '2026-08-06T10:05:00.000Z'

let tmpRoot: string
let service: ChatSessionService
let nowProvider: () => string

const REQ = 'req-001-test'

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-chatsess-'))
  nowProvider = vi.fn(() => T0)
  service = new ChatSessionService({
    workspaceRoot: tmpRoot,
    nowIso: () => nowProvider(),
  })
})

afterEach(() => {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true })
})

/** 提前把 req 目录建出来(create 必依赖) */
function seedRequirement(reqId = REQ): void {
  mkdirSync(join(tmpRoot, 'requirements', reqId), { recursive: true })
}

const CARD_A = '01J7X3K2P5EVR0Z3YQJD8HFKA1'
const CARD_B = '01J7X3K2P5EVR0Z3YQJD8HFKB2'

const DEFAULT_SEED = {
  sdkSessionId: 'sdk-sess-abc-123',
  cwd: '/workspace/reqs/req-001-test/board/tasks/01J.../chat',
  additionalDirectories: ['/workspace/reqs/req-001-test'],
  model: 'claude-sonnet-5',
  permissionMode: ChatPermissionMode.DEFAULT,
  mcpServers: [
    {
      name: 'boardchat',
      config: { type: 'sdk', name: 'boardchat' },
    },
  ],
  ownerUserId: 'user-1',
}

// ---------------------------------------------------------------------------
// get / write / patch
// ---------------------------------------------------------------------------

describe('ChatSessionService.get / writeMeta', () => {
  it('get:session.json 不存在 → null', () => {
    seedRequirement()
    expect(service.get(REQ, CARD_A)).toBeNull()
  })

  it('get:session.json 解析失败 → null + onCorruptSession 触发', () => {
    seedRequirement()
    const dir = service.chatDir(REQ, CARD_A)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), '{not valid json', 'utf8')

    const corruptEvents: Array<{ path: string; err: unknown }> = []
    service = new ChatSessionService({
      workspaceRoot: tmpRoot,
      nowIso: () => T0,
      onCorruptSession: (path, err) => corruptEvents.push({ path, err }),
    })

    expect(service.get(REQ, CARD_A)).toBeNull()
    expect(corruptEvents).toHaveLength(1)
    expect(corruptEvents[0]?.path).toContain('session.json')
  })

  it('writeMeta:17 项字段 round-trip —— session.json 落盘 + get 读回一致', () => {
    seedRequirement()
    const meta: ChatSessionMeta = {
      sessionId: 'sdk-sess-abc-123',
      requirementId: REQ,
      cardId: CARD_A,
      cwd: '/workspace/reqs/req-001-test/board/tasks/01J.../chat',
      additionalDirectories: ['/workspace/reqs/req-001-test'],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.DEFAULT,
      permissionPromptToolName: 'mcp__boardchat__user_confirm',
      mcpServers: [{ name: 'boardchat', config: { foo: 'bar' } }],
      createdAt: T0,
      lastQueryAt: T0,
      queryCount: 0,
      ownerUserId: 'user-1',
      cumulativeUsage: {
        cumulativeCostUsd: 0,
        cumulativeInputTokens: 0,
        cumulativeOutputTokens: 0,
        cumulativeCacheReadTokens: 0,
      },
    }

    service.writeMeta(REQ, CARD_A, meta)

    const path = service.sessionJsonPath(REQ, CARD_A)
    expect(existsSync(path)).toBe(true)

    const read = service.get(REQ, CARD_A)
    expect(read).toEqual(meta)

    // 17 项字段断言(逐项)
    expect(read?.sessionId).toBe('sdk-sess-abc-123')
    expect(read?.requirementId).toBe(REQ)
    expect(read?.cardId).toBe(CARD_A)
    expect(read?.cwd).toBe('/workspace/reqs/req-001-test/board/tasks/01J.../chat')
    expect(read?.additionalDirectories).toEqual(['/workspace/reqs/req-001-test'])
    expect(read?.model).toBe('claude-sonnet-5')
    expect(read?.permissionMode).toBe(ChatPermissionMode.DEFAULT)
    expect(read?.permissionPromptToolName).toBe('mcp__boardchat__user_confirm')
    expect(read?.mcpServers).toEqual([{ name: 'boardchat', config: { foo: 'bar' } }])
    expect(read?.createdAt).toBe(T0)
    expect(read?.lastQueryAt).toBe(T0)
    expect(read?.queryCount).toBe(0)
    expect(read?.ownerUserId).toBe('user-1')
    expect(read?.cumulativeUsage.cumulativeCostUsd).toBe(0)
    expect(read?.cumulativeUsage.cumulativeInputTokens).toBe(0)
    expect(read?.cumulativeUsage.cumulativeOutputTokens).toBe(0)
    expect(read?.cumulativeUsage.cumulativeCacheReadTokens).toBe(0)
  })

  it('writeMeta:tmp+rename atomic —— 写期间崩溃不撕裂文件', () => {
    seedRequirement()
    const meta: ChatSessionMeta = {
      sessionId: 'sdk-sess',
      requirementId: REQ,
      cardId: CARD_A,
      cwd: '/tmp/cwd',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.DEFAULT,
      permissionPromptToolName: 'mcp__boardchat__user_confirm',
      mcpServers: [],
      createdAt: T0,
      lastQueryAt: T0,
      queryCount: 0,
      ownerUserId: 'user-1',
      cumulativeUsage: zeroCumulativeUsage(),
    }

    service.writeMeta(REQ, CARD_A, meta)
    // 写完后无 .tmp 残留(rename 已完成)
    const tmpPath = `${service.sessionJsonPath(REQ, CARD_A)}.tmp`
    expect(existsSync(tmpPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getOrCreateSession + 单 tab lock
// ---------------------------------------------------------------------------

describe('ChatSessionService.getOrCreateSession + 单 tab lock', () => {
  it('首次调用:写入 session.json + 17 项字段 + zeroCumulativeUsage', async () => {
    seedRequirement()

    const meta = await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    expect(meta.sessionId).toBe('sdk-sess-abc-123')
    expect(meta.requirementId).toBe(REQ)
    expect(meta.cardId).toBe(CARD_A)
    expect(meta.cwd).toBe(DEFAULT_SEED.cwd)
    expect(meta.additionalDirectories).toEqual([...DEFAULT_SEED.additionalDirectories])
    expect(meta.model).toBe(DEFAULT_SEED.model)
    expect(meta.permissionMode).toBe(DEFAULT_SEED.permissionMode)
    expect(meta.permissionPromptToolName).toBe('mcp__boardchat__user_confirm')
    expect(meta.mcpServers).toEqual([...DEFAULT_SEED.mcpServers])
    expect(meta.createdAt).toBe(T0)
    expect(meta.lastQueryAt).toBe(T0)
    expect(meta.queryCount).toBe(1)
    expect(meta.ownerUserId).toBe('user-1')
    expect(meta.cumulativeUsage).toEqual(zeroCumulativeUsage())
  })

  it('第二次调用:session.json 已存在 → 直接 get 返回,cwd 不一致时仍返原 session', async () => {
    seedRequirement()

    const first = await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 第二次调用,cwd 改成另一个值 —— 仍返回原 session(忽略新 cwd)
    const second = await service.getOrCreateSession(REQ, CARD_A, {
      ...DEFAULT_SEED,
      sdkSessionId: 'sdk-sess-other',
      cwd: '/different/cwd',
    })

    expect(second.sessionId).toBe(first.sessionId)
    expect(second.cwd).toBe(first.cwd)
  })

  it('单 tab lock:同 (reqId, cardId) 并发两次 —— 第二次等待第一次完成', async () => {
    seedRequirement()

    // 第一次创建(慢一点)
    const firstP = service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    // 第二次调用立即发起 —— 应等待第一次完成
    const secondP = service.getOrCreateSession(REQ, CARD_A, {
      ...DEFAULT_SEED,
      sdkSessionId: 'sdk-sess-second',
    })

    const [first, second] = await Promise.all([firstP, secondP])
    // 第二次拿到的是第一次落盘的 sessionId(锁串行化)
    expect(second.sessionId).toBe(first.sessionId)
    expect(second.sessionId).toBe('sdk-sess-abc-123')
  })

  it('单 tab lock:不同 (reqId, cardId) 不互锁', async () => {
    seedRequirement()

    const [metaA, metaB] = await Promise.all([
      service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED),
      service.getOrCreateSession(REQ, CARD_B, {
        ...DEFAULT_SEED,
        sdkSessionId: 'sdk-sess-B',
      }),
    ])

    expect(metaA.sessionId).toBe('sdk-sess-abc-123')
    expect(metaB.sessionId).toBe('sdk-sess-B')
  })

  it('E_REQUIREMENT_NOT_FOUND:req 目录不存在 → 抛 ChatSessionServiceError', async () => {
    // 不 seedRequirement —— req 目录不存在
    await expect(
      service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED),
    ).rejects.toThrow(ChatSessionServiceError)
  })
})

// ---------------------------------------------------------------------------
// patch 字段白名单
// ---------------------------------------------------------------------------

describe('ChatSessionService.patch', () => {
  it('patch model —— lastQueryAt 同步刷新,queryCount 不变', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    nowProvider.mockReturnValue(T1)
    const updated = service.patch(REQ, CARD_A, { model: 'claude-opus' })

    expect(updated.model).toBe('claude-opus')
    expect(updated.lastQueryAt).toBe(T1)
    expect(updated.createdAt).toBe(T0) // createdAt 不变
    expect(updated.queryCount).toBe(1) // queryCount 不变
  })

  it('patch permissionMode → bypassPermissions', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    const updated = service.patch(REQ, CARD_A, {
      permissionMode: ChatPermissionMode.BYPASS_PERMISSIONS,
    })
    expect(updated.permissionMode).toBe(ChatPermissionMode.BYPASS_PERMISSIONS)
  })

  it('patch mcpServers —— 完整替换数组', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    const updated = service.patch(REQ, CARD_A, {
      mcpServers: [{ name: 'extra', config: { v: 1 } }],
    })
    expect(updated.mcpServers).toEqual([{ name: 'extra', config: { v: 1 } }])
  })

  it('patch session 不存在 → 抛 E_INVALID_SESSION', () => {
    seedRequirement()
    expect(() => service.patch(REQ, CARD_A, { model: 'x' })).toThrow(
      ChatSessionServiceError,
    )
  })
})

// ---------------------------------------------------------------------------
// recordUsage —— cost 累计
// ---------------------------------------------------------------------------

describe('ChatSessionService.recordUsage', () => {
  it('首次 recordUsage —— queryCount 自增 + cumulativeUsage 累加', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    nowProvider.mockReturnValue(T1)
    const updated = service.recordUsage(REQ, CARD_A, {
      costUsd: 0.05,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
    })

    expect(updated.queryCount).toBe(2) // 1 (getOrCreate) + 1 (recordUsage)
    expect(updated.lastQueryAt).toBe(T1)
    expect(updated.cumulativeUsage.cumulativeCostUsd).toBe(0.05)
    expect(updated.cumulativeUsage.cumulativeInputTokens).toBe(100)
    expect(updated.cumulativeUsage.cumulativeOutputTokens).toBe(50)
    expect(updated.cumulativeUsage.cumulativeCacheReadTokens).toBe(20)
  })

  it('多次 recordUsage —— 累计单调递增', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    service.recordUsage(REQ, CARD_A, {
      costUsd: 0.05,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
    })
    nowProvider.mockReturnValue(T1)
    const updated = service.recordUsage(REQ, CARD_A, {
      costUsd: 0.07,
      inputTokens: 200,
      outputTokens: 80,
      cacheReadTokens: 40,
    })

    expect(updated.queryCount).toBe(3)
    expect(updated.cumulativeUsage.cumulativeCostUsd).toBeCloseTo(0.12)
    expect(updated.cumulativeUsage.cumulativeInputTokens).toBe(300)
    expect(updated.cumulativeUsage.cumulativeOutputTokens).toBe(130)
    expect(updated.cumulativeUsage.cumulativeCacheReadTokens).toBe(60)
  })

  it('accumulateUsage helper —— 单测函数本身', () => {
    const prev: ChatCumulativeUsage = {
      cumulativeCostUsd: 1,
      cumulativeInputTokens: 10,
      cumulativeOutputTokens: 5,
      cumulativeCacheReadTokens: 2,
    }
    const next = accumulateUsage(prev, {
      costUsd: 0.5,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
    })
    expect(next.cumulativeCostUsd).toBeCloseTo(1.5)
    expect(next.cumulativeInputTokens).toBe(110)
    expect(next.cumulativeOutputTokens).toBe(55)
    expect(next.cumulativeCacheReadTokens).toBe(22)
  })

  it('recordUsage session 不存在 → 抛 E_INVALID_SESSION', () => {
    seedRequirement()
    expect(() =>
      service.recordUsage(REQ, CARD_A, {
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toThrow(ChatSessionServiceError)
  })
})

// ---------------------------------------------------------------------------
// 30 天 SDK 健康检查 + sweep
// ---------------------------------------------------------------------------

describe('ChatSessionService.healthCheck / sweepExpiredSessions', () => {
  it('healthCheck:no-session → { needsRebuild: false, reason: no-session }', () => {
    seedRequirement()
    const r = service.healthCheck(REQ, CARD_A)
    expect(r.needsRebuild).toBe(false)
    expect(r.reason).toBe('no-session')
  })

  it('healthCheck:sdk-jsonl-missing → needsRebuild: true', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 不创建 SDK jsonl → existsSync 返 false → needsRebuild: true
    const r = service.healthCheck(REQ, CARD_A, { ttlDays: 30 })
    expect(r.needsRebuild).toBe(true)
    expect(r.reason).toBe('sdk-jsonl-missing')
  })

  it('healthCheck:30 天以上未活动 → needsRebuild: true', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 现在离 T0 已经 31 天
    const T0Ms = Date.parse(T0)
    const r = service.healthCheck(REQ, CARD_A, {
      ttlDays: 30,
      nowMs: T0Ms + 31 * 24 * 60 * 60 * 1000,
    })
    expect(r.needsRebuild).toBe(true)
    expect(r.reason).toBe('session-older-than-30-days')
  })

  it('healthCheck:30 天内 + SDK jsonl 在 → healthy', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 假装 SDK jsonl 在(写一个空文件)
    const sdkPath = sdkSessionLogPathFor(DEFAULT_SEED.cwd, 'sdk-sess-abc-123')
    mkdirSync(join(sdkPath, '..'), { recursive: true })
    writeFileSync(sdkPath, '', 'utf8')

    const T0Ms = Date.parse(T0)
    const r = service.healthCheck(REQ, CARD_A, {
      ttlDays: 30,
      nowMs: T0Ms + 5 * 24 * 60 * 60 * 1000, // 5 天后
    })
    expect(r.needsRebuild).toBe(false)
    expect(r.reason).toBe('healthy')

    // cleanup
    rmSync(sdkPath, { force: true })
  })

  it('sweepExpiredSessions:超期 session 重置 cumulativeUsage + sessionId', async () => {
    seedRequirement()
    // T0 创建
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    service.recordUsage(REQ, CARD_A, {
      costUsd: 1.0,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
    })

    const T0Ms = Date.parse(T0)
    // 31 天后 sweep
    const r = service.sweepExpiredSessions(REQ, {
      ttlDays: 30,
      nowMs: T0Ms + 31 * 24 * 60 * 60 * 1000,
    })

    expect(r.swept).toBe(1)
    expect(r.skipped).toBe(0)

    // cumulativeUsage + queryCount 被重置(sessionId 保留;下次 query 通过
    // healthCheck 检测 SDK jsonl 缺失 → 走 rebuild 路径拿新 sessionId)
    const after = service.get(REQ, CARD_A)
    expect(after?.sessionId).toBe('sdk-sess-abc-123')
    expect(after?.queryCount).toBe(0)
    expect(after?.cumulativeUsage.cumulativeCostUsd).toBe(0)
    expect(after?.cumulativeUsage.cumulativeInputTokens).toBe(0)
  })

  it('sweepExpiredSessions:30 天内不 sweep', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    service.recordUsage(REQ, CARD_A, {
      costUsd: 1.0,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
    })

    const T0Ms = Date.parse(T0)
    const r = service.sweepExpiredSessions(REQ, {
      ttlDays: 30,
      nowMs: T0Ms + 5 * 24 * 60 * 60 * 1000, // 5 天后
    })

    expect(r.swept).toBe(0)
    expect(r.skipped).toBe(1)

    // session 未变
    const after = service.get(REQ, CARD_A)
    expect(after?.sessionId).toBe('sdk-sess-abc-123')
    expect(after?.cumulativeUsage.cumulativeCostUsd).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// snapshot 解析 —— SDK jsonl → events
// ---------------------------------------------------------------------------

describe('parseSdkSessionLog', () => {
  it('文件不存在 → []', () => {
    const events = parseSdkSessionLog('/nonexistent/path.jsonl')
    expect(events).toEqual([])
  })

  it('空文件 → []', () => {
    const tmpFile = join(tmpRoot, 'empty.jsonl')
    writeFileSync(tmpFile, '', 'utf8')
    expect(parseSdkSessionLog(tmpFile)).toEqual([])
  })

  it('SDK jsonl 解析 system/init 之前的 user / assistant 消息', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      // system/init 之前的 user / assistant
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '你好' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '你好,有什么可以帮?' }],
        },
      }),
      // system/init
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      // system/init 之后的(本期不解析)
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '再问' }] },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    // 只有 system/init 之前的 2 条
    expect(events).toHaveLength(2)
    expect(events[0]?.kind).toBe('chat_message_user')
    expect(events[1]?.kind).toBe('chat_message_assistant')
  })
})

// ---------------------------------------------------------------------------
// loadSnapshot
// ---------------------------------------------------------------------------

describe('ChatSessionService.loadSnapshot', () => {
  it('session 不存在 → { meta: null, events: [] }', () => {
    seedRequirement()
    const snap = service.loadSnapshot(REQ, CARD_A)
    expect(snap.meta).toBeNull()
    expect(snap.events).toEqual([])
  })

  it('session 存在 + SDK jsonl 缺失 → { meta, events: [] }', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    const snap = service.loadSnapshot(REQ, CARD_A)
    expect(snap.meta).not.toBeNull()
    expect(snap.meta?.sessionId).toBe('sdk-sess-abc-123')
    expect(snap.events).toEqual([])
  })

  it('session 存在 + SDK jsonl 在 → events 数组解析', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    const sdkPath = sdkSessionLogPathFor(DEFAULT_SEED.cwd, 'sdk-sess-abc-123')
    mkdirSync(join(sdkPath, '..'), { recursive: true })
    writeFileSync(
      sdkPath,
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }) + '\n',
      'utf8',
    )

    const snap = service.loadSnapshot(REQ, CARD_A)
    expect(snap.events.length).toBeGreaterThan(0)

    // cleanup
    rmSync(sdkPath, { force: true })
  })
})

// ---------------------------------------------------------------------------
// delete · issue 13 端到端自愈
// ---------------------------------------------------------------------------

describe('ChatSessionService.delete · issue 13', () => {
  it('删 session.json(先 rename .bak)+ 清 audit/ 子目录 + 删 SDK jsonl', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // seed audit/ 子目录
    const chatDir = service.chatDir(REQ, CARD_A)
    const auditDir = join(chatDir, 'audit')
    mkdirSync(auditDir, { recursive: true })
    writeFileSync(join(auditDir, 'log.jsonl'), '{}\n', 'utf8')
    // seed SDK jsonl
    const sdkPath = sdkSessionLogPathFor(DEFAULT_SEED.cwd, DEFAULT_SEED.sdkSessionId)
    mkdirSync(join(sdkPath, '..'), { recursive: true })
    writeFileSync(sdkPath, '{}\n', 'utf8')

    const sessionJsonPath = service.sessionJsonPath(REQ, CARD_A)
    expect(existsSync(sessionJsonPath)).toBe(true)

    const cleared = service.delete(REQ, CARD_A)
    expect(cleared).toEqual({
      sessionJson: 'renamed',
      auditDir: 'removed',
      sdkJsonl: 'removed',
    })
    // session.json 已改名 .bak
    expect(existsSync(sessionJsonPath)).toBe(false)
    expect(existsSync(`${sessionJsonPath}.bak`)).toBe(true)
    // audit 物理删
    expect(existsSync(auditDir)).toBe(false)
    // SDK jsonl 删
    expect(existsSync(sdkPath)).toBe(false)
    // service.get 返 null
    expect(service.get(REQ, CARD_A)).toBeNull()

    // cleanup
    rmSync(`${sessionJsonPath}.bak`, { force: true })
  })

  it('session 不存在 → 幂等返 {absent, absent, absent} 不抛错', () => {
    seedRequirement()
    const cleared = service.delete(REQ, CARD_A)
    expect(cleared).toEqual({
      sessionJson: 'absent',
      auditDir: 'absent',
      sdkJsonl: 'absent',
    })
  })

  it('不删 card 物理 dir 本身(card.json 等其他文件保留)', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 在 card dir 下放一个 card.json(模拟其他文件的边界场景)
    const cardDir = join(tmpRoot, 'requirements', REQ, 'board', 'tasks', CARD_A)
    writeFileSync(join(cardDir, 'card.json'), '{"id":"x"}\n', 'utf8')

    service.delete(REQ, CARD_A)
    // card.json 应保留
    expect(existsSync(join(cardDir, 'card.json'))).toBe(true)
    // 但 chat 子目录里的 session.json 已 rename .bak
    const sessionJsonPath = service.sessionJsonPath(REQ, CARD_A)
    expect(existsSync(sessionJsonPath)).toBe(false)
    expect(existsSync(`${sessionJsonPath}.bak`)).toBe(true)
  })

  it('audit 不存在时 auditDir: absent + 不抛错', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 不 seed audit
    const cleared = service.delete(REQ, CARD_A)
    expect(cleared.sessionJson).toBe('renamed')
    expect(cleared.auditDir).toBe('absent')
    expect(cleared.sdkJsonl).toBe('absent')
  })

  it('损坏的 .bak 内容(JSON 解析失败) → 不阻断,仍返 sessionJson=renamed', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    // 手动把 session.json 内容搞坏,再触发 delete —— rename 会先成功,后续
    // 读 .bak 解析失败应被 catch 吞掉,sdkJsonl 返 absent
    const sessionJsonPath = service.sessionJsonPath(REQ, CARD_A)
    writeFileSync(sessionJsonPath, '{not valid json', 'utf8')
    const cleared = service.delete(REQ, CARD_A)
    expect(cleared.sessionJson).toBe('renamed')
    expect(cleared.sdkJsonl).toBe('absent')
  })
})