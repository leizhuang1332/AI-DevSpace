/**
 * ChatSessionService 单测 —— issue 03 / ADR-0029
 *
 * 覆盖:
 * - 18 项 session.json 字段 round-trip(get / write / patch)
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
  sanitizeCwdForSdkProjectDir,
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

  it('writeMeta:18 项字段 round-trip —— session.json 落盘 + get 读回一致', () => {
    // issue 17 新增第 18 项 sdkSessionEstablished:false —— 默认值是迁移策略:
    // 老 session.json 没这个字段 → zod default(false) → 读出来是 false → 下次
    // /query 自动走"用 server UUID 新建"路径 → 坏的旧 session 自动修好。
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
      sdkSessionEstablished: false,
    }

    service.writeMeta(REQ, CARD_A, meta)

    const path = service.sessionJsonPath(REQ, CARD_A)
    expect(existsSync(path)).toBe(true)

    const read = service.get(REQ, CARD_A)
    expect(read).toEqual(meta)

    // 18 项字段断言(逐项)
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
    expect(read?.sdkSessionEstablished).toBe(false)
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
  it('首次调用:写入 session.json + 18 项字段 + zeroCumulativeUsage + sdkSessionEstablished=false', async () => {
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
    // issue 17:首次落盘默认 sdkSessionEstablished=false(/query 首轮传 newSessionId)
    expect(meta.sdkSessionEstablished).toBe(false)
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
// SDK project dir sanitize —— SDK 0.3.206 真实规则(2026-08-13 探底)
// ---------------------------------------------------------------------------

describe('sanitizeCwdForSdkProjectDir / sdkSessionLogPathFor', () => {
  it('Windows cwd + 中文字符 + .aidevspace → SDK 真实 dir 形态(用户实测)', () => {
    // 用户实测 2026-08-13:
    //   cwd: C:\Users\Lorcan\.aidevspace\requirements\req-003-这下可以了吧\board\tasks\<ulid>\chat
    //   实际 dir: C--Users-Lorcan--aidevspace-requirements-req-003--------board-tasks-<ulid>-chat
    // 这条守门:若 SDK 升级改 sanitize 规则,这里会红,需要重新对齐 SDK 行为
    const cwd =
      'C:\\Users\\Lorcan\\.aidevspace\\requirements\\req-003-这下可以了吧\\board\\tasks\\01J7X3K2P5EVR0Z3YQJD8HFKA1\\chat'
    const expected =
      'C--Users-Lorcan--aidevspace-requirements-req-003--------board-tasks-01J7X3K2P5EVR0Z3YQJD8HFKA1-chat'
    expect(sanitizeCwdForSdkProjectDir(cwd)).toBe(expected)
  })

  it('正斜杠 cwd(类 Unix 路径)→ / 替换为 -', () => {
    expect(sanitizeCwdForSdkProjectDir('/Users/foo/bar.baz')).toBe(
      '-Users-foo-bar-baz',
    )
  })

  it('纯 ASCII + 无分隔符 → 原样保留', () => {
    expect(sanitizeCwdForSdkProjectDir('plainpath')).toBe('plainpath')
  })

  it('sdkSessionLogPathFor 派生路径以 homedir()/.claude/projects/<sanitized>/<sid>.jsonl 形态', () => {
    const cwd = 'C:\\workspace\\proj'
    const sid = '0f6ad1fc-8438-40a9-9efb-75a987088c50'
    const p = sdkSessionLogPathFor(cwd, sid)
    const { homedir } = require('node:os') as typeof import('node:os')
    expect(p).toBe(
      require('node:path').join(
        homedir(),
        '.claude',
        'projects',
        'C--workspace-proj',
        `${sid}.jsonl`,
      ),
    )
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

  it('SDK jsonl 解析 system/init 之后的 user / assistant 消息(init 自身不返)', () => {
    // 注:2026-08-13 复盘后,sawInit gate 已拆;init 行存在时仍 skip(不构成
    // event),但 user/assistant 不再依赖 init 触发。新加的"无 init 行"测试
    // 覆盖真实场景(/start 走纯本地,SDK 2.1.206 首次 /query jsonl 无 init)。
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      // system/init —— 自身不解析为 event
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      // init 之后:user / assistant / user(3 条)
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
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '再问' }] },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    // 解析 init 之后 3 条 messages(init 自身不计)
    expect(events).toHaveLength(3)
    expect(events[0]?.kind).toBe('chat_message_user')
    expect(events[1]?.kind).toBe('chat_message_assistant')
    expect(events[2]?.kind).toBe('chat_message_user')
  })

  it('SDK 2.1.206 真实 jsonl:无 system/init 行,第 1 行就是 user → 仍解析(2026-08-13 复盘守门)', () => {
    // 用户实测 2026-08-13:cwd 里有中文 + .aidevspace,SDK 2.1.206 实际写 jsonl 时
    // 不写 system/init 行(首行 type:'user',带 timestamp / parentUuid / uuid /
    // promptSource:'sdk' / userType:'external' / entrypoint:'sdk-ts' / version:'2.1.206')。
    // 旧 sawInit gate 会让这条 jsonl 全部 skip → events=[];现已拆。
    const tmpFile = join(tmpRoot, 'sdk-real.jsonl')
    const lines = [
      JSON.stringify({
        parentUuid: '9d758f07-2da1-4e1e-8a3c-4ca5e2c8d0ab',
        isSidechain: false,
        promptId: 'eb826d60-ab03-4a83-8816-eeba5b247dcd',
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '你好' }] },
        uuid: '59b653b8-2e46-4a40-89c9-d89f95bd87b2',
        timestamp: '2026-08-13T13:28:13.974Z',
        permissionMode: 'default',
        promptSource: 'sdk',
        userType: 'external',
        entrypoint: 'sdk-ts',
        cwd: 'C:\\Users\\Lorcan\\.aidevspace\\requirements\\req-003\\board\\tasks\\X\\chat',
        sessionId: '0f6ad1fc-8438-40a9-9efb-75a987088c50',
        version: '2.1.206',
        gitBranch: 'HEAD',
      }),
      JSON.stringify({
        parentUuid: '59b653b8-2e46-4a40-89c9-d89f95bd87b2',
        isSidechain: false,
        message: {
          id: '06ccf96e09bdfef68ba96949a18e2de4',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '你好！👋' }],
          model: 'MiniMax-M3',
          stop_reason: 'end_turn',
          usage: { input_tokens: 35215, output_tokens: 313 },
        },
        type: 'assistant',
        uuid: '0808e740-4323-480f-8121-ee99eda8240c',
        timestamp: '2026-08-13T13:28:23.673Z',
        userType: 'external',
        entrypoint: 'sdk-ts',
        cwd: 'C:\\Users\\Lorcan\\.aidevspace\\requirements\\req-003\\board\\tasks\\X\\chat',
        sessionId: '0f6ad1fc-8438-40a9-9efb-75a987088c50',
        version: '2.1.206',
        gitBranch: 'HEAD',
      }),
      // SDK 2.1.206 末行常带 type:'last-prompt',本期不解析,silent skip
      JSON.stringify({
        type: 'last-prompt',
        lastPrompt: '你好',
        leafUuid: '0808e740-4323-480f-8121-ee99eda8240c',
        sessionId: '0f6ad1fc-8438-40a9-9efb-75a987088c50',
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    // 2 events:user + assistant(last-prompt skip)
    expect(events).toHaveLength(2)
    expect(events[0]?.kind).toBe('chat_message_user')
    if (events[0]?.kind === 'chat_message_user') {
      // SDK 2.1.206 user 消息带 timestamp → ts = Date.parse(timestamp)
      expect(events[0].ts).toBe(Date.parse('2026-08-13T13:28:13.974Z'))
    }
    expect(events[1]?.kind).toBe('chat_message_assistant')
    if (events[1]?.kind === 'chat_message_assistant') {
      // SDK 2.1.206 assistant 消息也带 timestamp(与 0.3.206 假设不同)
      expect(events[1].ts).toBe(Date.parse('2026-08-13T13:28:23.673Z'))
    }
  })

  it('assistant 消息含 tool_use block → chat_tool_call event', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_abc',
              name: 'Read',
              input: { file_path: '/etc/hosts' },
            },
          ],
        },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('chat_tool_call')
    if (events[0]?.kind === 'chat_tool_call') {
      expect(events[0].id).toBe('toolu_abc')
      expect(events[0].name).toBe('Read')
      expect(events[0].args).toEqual({ file_path: '/etc/hosts' })
      expect(events[0].partial).toBe(false)
    }
  })

  it('user 消息含 tool_result block → chat_tool_result event', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_abc',
              content: '127.0.0.1 localhost',
              is_error: false,
            },
          ],
        },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('chat_tool_result')
    if (events[0]?.kind === 'chat_tool_result') {
      expect(events[0].id).toBe('toolu_abc')
      expect(events[0].content).toBe('127.0.0.1 localhost')
    }
  })

  it('assistant 单条消息含 text + thinking + tool_use 混合 block → 1 条 chat_message_assistant(content 3 block)', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '我先想一下' },
            { type: 'text', text: '让我看下文件' },
            { type: 'tool_use', id: 'toolu_xyz', name: 'Read', input: { path: '/x' } },
          ],
        },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('chat_message_assistant')
    if (events[0]?.kind === 'chat_message_assistant') {
      expect(events[0].content).toHaveLength(3)
      expect(events[0].content[0]?.kind).toBe('thinking')
      expect(events[0].content[1]?.kind).toBe('text')
      expect(events[0].content[2]?.kind).toBe('tool_use')
    }
  })

  it('chat_permission_request 无对应 chat_permission_resolved → 注入 synthetic resolved=deny(session-interrupted)', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      // 我们 MCP handler 推的 permission_request 事件(在 SSE 流上;此处写 jsonl 模拟
      // 持久化形态 —— 真实实现由 SSE handler 落 chat/audit/ 而非 jsonl,但解析路径相同)
      JSON.stringify({
        kind: 'chat_permission_request',
        requestId: 'req-orphan-1',
        toolName: 'Bash',
        input: { cmd: 'rm -rf /' },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    // 2 条:原 request + 注入的 synthetic resolved
    expect(events).toHaveLength(2)
    expect(events[0]?.kind).toBe('chat_permission_request')
    expect(events[1]?.kind).toBe('chat_permission_resolved')
    if (
      events[1]?.kind === 'chat_permission_resolved' &&
      events[0]?.kind === 'chat_permission_request'
    ) {
      expect(events[1].requestId).toBe(events[0].requestId)
      // 双层 decision:{ decision: 'deny', reason: 'session-interrupted' }
      expect(events[1].decision).toEqual({
        decision: 'deny',
        reason: 'session-interrupted',
      })
    }
  })

  it('chat_permission_request 有对应 chat_permission_resolved → 2 条原样返,无注入', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        kind: 'chat_permission_request',
        requestId: 'req-paired-1',
        toolName: 'Read',
        input: { path: '/x' },
      }),
      JSON.stringify({
        kind: 'chat_permission_resolved',
        requestId: 'req-paired-1',
        decision: { decision: 'allow', reason: 'user-allowed' },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const events = parseSdkSessionLog(tmpFile)
    expect(events).toHaveLength(2)
    expect(events[0]?.kind).toBe('chat_permission_request')
    expect(events[1]?.kind).toBe('chat_permission_resolved')
  })

  it('user 消息带 timestamp 字段 → ts === Date.parse(timestamp)', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      // 真实 SDK jsonl 总是 init 在前
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-08-06T09:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const before = Date.now()
    const events = parseSdkSessionLog(tmpFile)
    const after = Date.now()
    expect(events).toHaveLength(1)
    if (events[0]?.kind === 'chat_message_user') {
      // ISO 2026-08-06T09:00:00Z → Date.parse → 固定值
      expect(events[0].ts).toBe(Date.parse('2026-08-06T09:00:00.000Z'))
      // 验证不落在 [before, after] 区间(否则就是 fallback 到 now 了)
      expect(events[0].ts).toBeLessThan(before)
    }
  })

  it('user 消息无 timestamp 字段 → ts 走 Date.now() fallback', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'no ts' }] },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const before = Date.now()
    const events = parseSdkSessionLog(tmpFile)
    const after = Date.now()
    expect(events).toHaveLength(1)
    if (events[0]?.kind === 'chat_message_user') {
      expect(events[0].ts).toBeGreaterThanOrEqual(before)
      expect(events[0].ts).toBeLessThanOrEqual(after)
    }
  })

  it('损坏行(JSON.parse 失败)→ silent skip + onCorruptJsonlLine 收集器收到', () => {
    const tmpFile = join(tmpRoot, 'sdk.jsonl')
    const lines = [
      // init 必须在前(Q2 决议:解析 init 之后的 SDK 事件)
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc',
        cwd: '/workspace',
        model: 'claude-sonnet-5',
      }),
      '{not valid json', // 损坏
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'valid' }] },
      }),
    ]
    writeFileSync(tmpFile, lines.join('\n') + '\n', 'utf8')

    const corruptEvents: Array<{ path: string; line: string; err: unknown }> = []
    const events = parseSdkSessionLog(tmpFile, (path, line, err) =>
      corruptEvents.push({ path, line, err }),
    )
    // 1 条 valid user(损坏行 skip)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('chat_message_user')
    // 收集器收到 1 次
    expect(corruptEvents).toHaveLength(1)
    expect(corruptEvents[0]?.path).toBe(tmpFile)
    expect(corruptEvents[0]?.line).toBe('{not valid json')
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

  it('session 存在 + SDK jsonl 缺失 → { meta, events: [], sdkJsonlMissing: true }', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)
    const snap = service.loadSnapshot(REQ, CARD_A)
    expect(snap.meta).not.toBeNull()
    expect(snap.meta?.sessionId).toBe('sdk-sess-abc-123')
    expect(snap.events).toEqual([])
    expect(snap.sdkJsonlMissing).toBe(true)
  })

  it('session 存在 + SDK jsonl 在 + 含 init + 2 user → events.length === 2', async () => {
    seedRequirement()
    await service.getOrCreateSession(REQ, CARD_A, DEFAULT_SEED)

    const sdkPath = sdkSessionLogPathFor(DEFAULT_SEED.cwd, 'sdk-sess-abc-123')
    mkdirSync(join(sdkPath, '..'), { recursive: true })
    const jsonlLines = [
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sdk-sess-abc-123',
        cwd: DEFAULT_SEED.cwd,
        model: 'claude-sonnet-5',
      }),
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'hello back' }],
        },
      }),
    ]
    writeFileSync(sdkPath, jsonlLines.join('\n') + '\n', 'utf8')

    const snap = service.loadSnapshot(REQ, CARD_A)
    // 解析 init 之后 2 条;init 自身不计
    expect(snap.events).toHaveLength(2)
    expect(snap.sdkJsonlMissing).toBe(false)

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