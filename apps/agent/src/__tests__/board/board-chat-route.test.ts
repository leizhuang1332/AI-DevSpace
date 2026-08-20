/**
 * board-chat route 测试 —— issue 05 / ADR-0029 D9 + D10
 *
 * 覆盖(issue 05 ticket 验收):
 * - POST /chat/sessions/start → 首次启动落 session.json,SDK sessionId 透传
 * - POST /chat/sessions/:sessionId/query → SSE 流(chat_session_init / message_* / tool_* / permission_* / complete)
 * - GET  /chat/sessions/snapshot → meta + events 数组(Snapshot 协议)
 * - PUT  /chat/sessions/:sessionId/model → 切 model 写 session.json
 * - PUT  /chat/sessions/:sessionId/plan-mode → 切 plan mode 写 session.json
 * - POST /chat/sessions/:sessionId/permission → 决议 permission request
 * - POST /chat/sessions/:sessionId/cost-cap → 决议 cost cap(4 选项)
 * - 错误响应:requirement-not-found / card-not-found / session-not-found /
 *   session-locked / invalid-body / internal,401 without token
 *
 * 设计(seam):
 * - Fastify + authPlugin + inject(非 SSE 端点)+ listen + http.request(SSE 端点),
 *   沿用 requirementEventsRoute.test.ts 的 SSE 验证模式
 * - 注入真 ChatSessionService(沿用 issue 03) + 真 TaskCardStore + 假 Provider
 *   (注入 runChatQuery,事件按预设脚本通过 onEvent 推到 route 层)
 * - 假 Provider 模拟 SDK 流(emit events by `input.onEvent(...)`),
 *   并把 userConfirmHandler 透传出来供测试控制决议
 *
 * 不测:真 SDK 子进程调用 / Provider 内部 SDK args 包装 / mcpCallCounter(均由
 * issue 02 RED e2e 守门 + Provider 单测覆盖)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import http from 'node:http'
import Fastify, { type FastifyInstance } from 'fastify'
import { authPlugin } from '../../auth/authPlugin.js'
import { TokenManager } from '../../auth/TokenManager.js'
import { TaskCardStore } from '../../services/board/TaskCardStore.js'
import {
  ChatSessionService,
  DEFAULT_PERMISSION_MODE,
} from '../../services/board/ChatSessionService.js'
import { boardChatRoutes } from '../../routes/board-chat.js'
import type {
  ChatQueryCapableProvider,
  ChatQueryInput,
  ChatQueryResult,
  ChatStreamEvent,
} from '../../providers/AIProvider.js'
import { ChatPermissionMode } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// Fake provider —— 模拟 SDK 流式事件 + 透传 userConfirmHandler
// ---------------------------------------------------------------------------

/** 预脚本化事件序列 —— 每条元素在 runChatQuery 内被 emit 一遍 */
interface ScriptedEvent {
  /** 传给 `input.onEvent` 的事件 */
  event: ChatStreamEvent
  /** 在此事件 emit 后是否调用 userConfirmHandler(用于测试 permission 流) */
  awaitPermission?: {
    toolName: string
    requestId: string
  }
}

class FakeChatProvider implements ChatQueryCapableProvider {
  readonly name = 'fake-chat'
  /** 测试可注入:每个 query 调用的预设事件脚本(按入参 cwd 区分) */
  scripts = new Map<string, ScriptedEvent[]>()
  /** 默认脚本 —— 当 cwd 没匹配到时走这个 */
  defaultScript: ScriptedEvent[] = []
  /** 用于模拟 SDK sessionId 返回值 */
  nextSessionId = 'sdk-sess-fake-001'

  runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
    const script =
      this.scripts.get(input.cwd) ??
      this.scripts.get(`__cwd:${input.cwd}`) ??
      this.defaultScript
    for (const { event, awaitPermission } of script) {
      input.onEvent(event)
      if (awaitPermission) {
        // fire-and-forget:不阻塞后续事件(测试 POST /permission 与 SSE 同窗口 race
        // 是另一回事);handler 决议由路由层 user_confirm 闭包独立 resolve。
        void input
          .userConfirmHandler({
            toolName: awaitPermission.toolName,
            requestId: awaitPermission.requestId,
            input: {},
          })
          .then(() => undefined)
          .catch(() => undefined)
      }
    }
    return { ok: true, sessionId: this.nextSessionId }
  })
}

// ---------------------------------------------------------------------------
// SSE 工具 —— 沿用 requirementEventsRoute.test.ts 的 openSse 模式
// ---------------------------------------------------------------------------

interface CapturedResponse {
  statusCode: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** 打开 SSE,读完指定毫秒后断开 socket;返回 status / headers / body */
function openSse(
  port: number,
  urlPath: string,
  headers: Record<string, string>,
  readMs = 400,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

/** POST SSE —— 触发流式响应,SDK 脚本事件透到 wire */
function postSse(
  port: number,
  urlPath: string,
  body: unknown,
  headers: Record<string, string>,
  readMs = 400,
): Promise<CapturedResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = http.request(
      {
        method: 'POST',
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        headers: {
          ...headers,
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload)),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        const timer = setTimeout(() => {
          req.destroy()
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        }, readMs)
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
        res.on('error', () => {
          clearTimeout(timer)
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** 解析 SSE body 为事件数组(每条 event 名 + data JSON 对象) */
function parseSseEvents(body: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = []
  const frames = body.split('\n\n').filter((f) => f.trim().length > 0)
  for (const frame of frames) {
    let eventName = ''
    let dataRaw = ''
    for (const line of frame.split('\n')) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataRaw += line.slice(6)
    }
    if (eventName) {
      try {
        out.push({ event: eventName, data: JSON.parse(dataRaw) })
      } catch {
        out.push({ event: eventName, data: dataRaw })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// 测试基础设施
// ---------------------------------------------------------------------------

let tmpRoot: string
let app: FastifyInstance
let token: string
let port: number
let taskCardStore: TaskCardStore
let chatSessionService: ChatSessionService
let provider: FakeChatProvider

const REQ_ID = 'req-001-refund'
const CARD_ID = '01J7X3K2P5EVR0Z3YQJD8HFKAA'

beforeEach(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aidev-boardchat-'))
  mkdirSync(join(tmpRoot, 'requirements', REQ_ID), { recursive: true })
  writeFileSync(join(tmpRoot, 'requirements', REQ_ID, 'meta.yaml'), 'id: x\n')

  const tm = new TokenManager(tmpRoot)
  token = await tm.ensure()

  taskCardStore = new TaskCardStore({
    root: tmpRoot,
    ulidFactory: () => CARD_ID,
    nowIso: () => '2026-08-06T10:00:00.000Z',
  })
  // seed 卡
  taskCardStore.create(REQ_ID, { title: '测试卡', id: CARD_ID })

  chatSessionService = new ChatSessionService({
    workspaceRoot: tmpRoot,
    nowIso: () => '2026-08-06T10:00:00.000Z',
  })

  provider = new FakeChatProvider()

  app = Fastify({ logger: false })
  await app.register(authPlugin, {
    tokenManager: tm,
    allowedOrigins: ['http://localhost:3333'],
  })
  await app.register(boardChatRoutes, {
    taskCardStore,
    chatSessionService,
    provider,
    workspaceRoot: tmpRoot,
  })
  await app.ready()
  const url = await app.listen({ port: 0, host: '127.0.0.1' })
  port = new URL(url).port
})

afterEach(async () => {
  await app.close()
  rmSync(tmpRoot, { recursive: true, force: true })
})

function authHeaders(): Record<string, string> {
  return { 'x-aidevspace-token': token, 'content-type': 'application/json' }
}

// ---------------------------------------------------------------------------
// POST /api/requirement/:id/board/cards/:cardId/chat/sessions/start
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/start', () => {
  it('200 + meta when no prior session — persists session.json without touching SDK', async () => {
    // issue 17:`/start` 是**纯本地操作** —— 生成 UUID + 落 session.json,
    // 不再跑 SDK bootstrap query。
    //
    // 历史:issue 16 时代 /start 会 fire-and-forget 调一次 prompt='' 的
    // runChatQuery,目的是"触发 SDK 建 session"。但 SDK 会自己生成一个
    // **不同的** session id 落 jsonl,与我们的 UUID 对不上 → 后续 /query
    // resume 必然失败。issue 17 改用 SDK `options.sessionId` 在首轮 /query
    // 里用我们的 UUID 建会话,这次 bootstrap 就纯属浪费了。
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-first-001',
          cwd: '/workspace/requirements/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      { event: { kind: 'complete', ts: 1, sessionId: 'sdk-sess-first-001', totalTokens: 100, cost: 0.005, reason: 'end_turn' } },
    ]

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '你好' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string; model: string; cardId: string } }
    // sessionId 是 server UUID —— 且它同时就是将来 SDK 的 session id(issue 17)
    expect(body.meta.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(body.meta.sessionId).not.toBe('sdk-sess-first-001')
    expect(body.meta.cardId).toBe(CARD_ID)
    expect(body.meta.model).toBe('claude-sonnet-5')
    // issue 17:零 SDK 调用(issue 10 的"不消耗 user content"不变量自然满足 ——
    // 根本没有 prompt 被送出去)
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('200 + existing meta when session.json already on disk (no second SDK init)', async () => {
    // seed 一个已落盘的 session.json(模拟上次 query 留下的 meta)
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-existing-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: ['/workspace/req-001-refund'],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [{ name: 'boardchat', config: { type: 'sdk' } }],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '继续' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    // 命中已落盘的 session,Provider 不被调(无新 query 启动)
    expect(body.meta.sessionId).toBe('sdk-sess-existing-001')
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('200 + meta when body is empty (issue 12 schema decoupling)', async () => {
    // issue 17:`/start` 不调 SDK → 不再需要准备 defaultScript。
    // 测试核心:即使 body 是 {},server 仍生成 UUID 落盘 + 返 meta。
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    // issue 16/17:sessionId 是 server UUID
    expect(body.meta.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    // issue 17:零 SDK 调用
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('200 + meta when body has legacy content field (back-compat stripped)', async () => {
    // issue 12 back-compat:老客户端可能仍带 content;zod 默认 strip,
    // 服务端静默忽略。
    //
    // issue 17 之前这个测试还要断言"prompt 仍 === ''"—— 防止 issue 10 复发
    // (把 user content 当 SDK prompt 跑一次)。但 issue 17 后 /start 完全
    // 不调 SDK,user content 不可能被消耗。改成断言:server UUID 落盘 +
    // 零 SDK 调用 —— 后者隐含"user content 不会被 SDK 拿到"。
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: '老客户端发的' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    expect(body.meta.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    // 关键断言:零 SDK 调用 → user content 不可能被消耗(issue 10 不变量)
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('400 invalid-body when body has wrong-typed model', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { model: 123 }, // 应是 string,不是 number
    })
    expect(res.statusCode).toBe(400)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('invalid-body')
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('requirement-not-found')
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('card-not-found')
  })

  it('401 without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: { 'content-type': 'application/json' },
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(401)
  })

  // issue 11 / 16 / 17 —— /start 接入单 tab lock + 并发安全
  //
  // issue 17 之后,/start 是**纯本地**操作:server 生成 UUID + 落 session.json。
  // 路径短到 `try` 块 < 1ms 完成。`getOrCreateSession` 内部 `this.locks`
  // (Map<sessionKey, Promise>) 串行化 session.json 落盘 —— 第二个 /start 要么
  // (a) 在锁释放前进,await 前一 Promise 拿到同一 sessionId,要么
  // (b) 在锁释放后进,直接命中已落盘的 session.json 走 get() 路径。
  // 两个分支都返 200 + 同一 UUID,**没有撕裂写**。SDK 完全不被调,不可能
  // 产生两个不同的 SDK session id 导致后续 /query resume 错位。
  it('concurrent /start on same (reqId, cardId) → both 200 with SAME sessionId (no torn write)', async () => {
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'A' }] },
      }),
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'B' }] },
      }),
    ])
    expect(resA.statusCode).toBe(200)
    expect(resB.statusCode).toBe(200)
    const bodyA = resA.json() as { meta: { sessionId: string } }
    const bodyB = resB.json() as { meta: { sessionId: string } }
    // 关键断言:两个 /start 拿到同一个 server UUID(无撕裂写)
    expect(bodyA.meta.sessionId).toBe(bodyB.meta.sessionId)
    // issue 17:/start 不调 SDK,所以不可能有"两次 SDK 调用"的计数问题
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('two /start with different (reqId, cardId) are NOT locked against each other', async () => {
    // seed 第二张 card(card1.id 由 ulidFactory 决定,此处用另一个 ulid)
    taskCardStore.create(REQ_ID, { title: 'card2', id: '01J7X3K2P5EVR0Z3YQJD8HFKBB' })

    // 同时发起两个 /start —— 不同 lockKey,互不干扰
    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'A' }] },
      }),
      app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKBB/chat/sessions/start`,
        headers: authHeaders(),
        payload: { content: [{ kind: 'text', text: 'B' }] },
      }),
    ])
    expect(resA.statusCode).toBe(200)
    expect(resB.statusCode).toBe(200)
    // 两个 /start 各自拿到不同的 server UUID(独立 session.json)
    const bodyA = resA.json() as { meta: { sessionId: string } }
    const bodyB = resB.json() as { meta: { sessionId: string } }
    expect(bodyA.meta.sessionId).not.toBe(bodyB.meta.sessionId)
    // issue 17:/start 不调 SDK
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  // issue 17 —— /start 完全不调 SDK,所以 SDK 抛错这件事根本不会发生。
  // 这个测试现在演变为:**就算有人替换 fake provider 让它在 /start 期间
  // 被任何方式触发,也只可能产生 200**(因为根本没注册 hook)。实际意义是
  // 验证 /start 不依赖 provider —— 把 provider 替换成会 throw 的版本,
  // /start 仍正常返 200,落 session.json,第二次 /start 命中落盘返同一 UUID。
  it('/start 不依赖 Provider —— Provider throw/未注入都不阻断 (issue 17)', async () => {
    // 替换 provider,使其即便被调也会 throw —— 验证根本不会被调
    provider.runChatQuery = vi.fn(async () => {
      throw new Error('SDK boom — should never be called by /start')
    })

    const res1 = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'first' }] },
    })
    // 关键断言:即使 provider 替换成会 throw 的,仍 200(sessionId 是 server UUID)
    expect(res1.statusCode).toBe(200)
    const body1 = res1.json() as { meta: { sessionId: string } }
    expect(body1.meta.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    // session.json 落盘
    expect(existsSync(chatSessionService.sessionJsonPath(REQ_ID, CARD_ID))).toBe(true)
    // provider 根本未被 /start 触发(issue 17 核心断言)
    expect(provider.runChatQuery).not.toHaveBeenCalled()

    // 第二次 /start —— 命中已落盘,返同一 sessionId,provider 仍未触发
    const res2 = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'retry' }] },
    })
    expect(res2.statusCode).toBe(200)
    const body2 = res2.json() as { meta: { sessionId: string } }
    expect(body2.meta.sessionId).toBe(body1.meta.sessionId)
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  // ===========================================================================
  // issue 16 + 17 —— /start 不再依赖 SDK emit system/init,issue 17 进一步
  // 完全不调 SDK(纯 server 本地操作)
  // ===========================================================================

  /**
   * issue 16 根因:SDK 0.3.206 不会在 user-facing stream emit `system/init`
   * 事件,所以旧实现 `await observedSessionId` 永远拿不到 → 500。
   *
   * issue 16 修法:server 端同步生成 UUID + 不 await session_init + fire-and-forget
   * 触发 SDK 内部 session。
   *
   * issue 17 进一步修法:`/start` **完全不调 SDK**,sessionId 100% 由 server 生成
   * + 立即落 session.json。后续 `/query` 首轮用 SDK `options.sessionId` 字段
   * (sdk.d.ts:1769)让 SDK 用我们 UUID 建会话,后续 resume 也用这个 UUID —
   * — 两个 ID 从一开始就是同一个,不再有"server UUID vs SDK 内部 id 不匹配"问题。
   */
  it('issue 17: /start 100% server 本地 —— 不调 SDK,sessionId 是 server UUID', async () => {
    // 故意把 provider 替换成会 throw 的,验证根本不会被调
    provider.runChatQuery = vi.fn(async (): Promise<ChatQueryResult> => {
      throw new Error('must not be called by /start')
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    // 关键断言:不再 500 internal;应 200 + meta
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string; model: string; cardId: string } }
    // sessionId 是 server 端 UUID
    expect(body.meta.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(body.meta.cardId).toBe(CARD_ID)
    expect(body.meta.model).toBe('claude-sonnet-5')
    // issue 17:零 SDK 调用
    expect(provider.runChatQuery).not.toHaveBeenCalled()
  })

  it('issue 17: session.json on disk uses server UUID, sdkSessionEstablished=false', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    // session.json 应已落盘
    const sessionJsonPath = chatSessionService.sessionJsonPath(REQ_ID, CARD_ID)
    expect(existsSync(sessionJsonPath)).toBe(true)
    // 落盘的 sessionId === 响应里的 sessionId(server UUID)
    const onDisk = chatSessionService.get(REQ_ID, CARD_ID)
    expect(onDisk).not.toBeNull()
    expect(onDisk!.sessionId).toBe(body.meta.sessionId)
    // issue 17 新字段:首次落盘默认 false(下次 /query 走 newSessionId 路径)
    expect(onDisk!.sdkSessionEstablished).toBe(false)
  })

  it('Step 2: /start 落盘的 session.json.cwd 指向任务目录(无 /chat 后缀)', async () => {
    // PRD task-catalog-transformation Step 2 — cwd 派生从 <tasks>/<cardId>/chat
    // 改为 <tasks>/<cardId>。SDK 在 cwd 同级能直接读到 <cardId>.json 主数据。
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)

    const onDisk = chatSessionService.get(REQ_ID, CARD_ID)
    expect(onDisk).not.toBeNull()
    // 期望 cwd = TaskCardStore.cardDirFor(<root>/requirements/<reqId>/board/tasks/<cardId>)
    // 不再带 /chat 后缀
    expect(onDisk!.cwd).toBe(taskCardStore.cardDirFor(REQ_ID, CARD_ID))
    // 守护:确认不是 chat 子目录
    expect(onDisk!.cwd.endsWith('/chat')).toBe(false)
    expect(onDisk!.cwd.endsWith(`${CARD_ID}/chat`)).toBe(false)
    // session.json 物理位置仍在 chat 子目录内(Step 3 不改 ChatSessionService)
    const sessionJsonPath = chatSessionService.sessionJsonPath(REQ_ID, CARD_ID)
    expect(sessionJsonPath.startsWith(onDisk!.cwd)).toBe(true) // cwd 是 session.json 父目录的祖先
  })

  it('issue 17: SDK provider throw 不可能发生 —— /start 完全不调 SDK', async () => {
    // 验证意图:/start 路径上根本不该有 provider.runChatQuery 调用。
    // 即便外部把 provider 替换成会 throw 的,/start 仍正常。
    provider.runChatQuery = vi.fn(async () => {
      throw new Error('SDK subprocess crashed during bootstrap')
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { sessionId: string } }
    expect(body.meta.sessionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(provider.runChatQuery).not.toHaveBeenCalled()
    expect(existsSync(chatSessionService.sessionJsonPath(REQ_ID, CARD_ID))).toBe(true)
  })

  it('issue 17: 第二次 /start 命中已落盘 session,完全不调 SDK', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(first.statusCode).toBe(200)
    const firstBody = first.json() as { meta: { sessionId: string } }

    // 第二次 /start:命中已落盘,直接返,Provider 不被调
    const second = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(second.statusCode).toBe(200)
    const secondBody = second.json() as { meta: { sessionId: string } }
    expect(secondBody.meta.sessionId).toBe(firstBody.meta.sessionId)  // 同一个 UUID
    expect(provider.runChatQuery).not.toHaveBeenCalled()  // 整个生命周期 0 SDK 调用
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/query —— SSE 流
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/:sessionId/query (SSE)', () => {
  it('SSE stream emits chat_session_init + chat_message_user + chat_message_assistant + chat_complete', async () => {
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-q-001',
          cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      {
        event: {
          kind: 'message_assistant',
          ts: 2,
          text: '你好,我可以帮你',
          partial: false,
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 3,
          sessionId: 'sdk-sess-q-001',
          totalTokens: 120,
          cost: 0.006,
          reason: 'end_turn',
        },
      },
    ]

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-001/query`,
      { content: [{ kind: 'text', text: '你好' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)

    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)
    expect(kinds).toContain('chat_session_init')
    expect(kinds).toContain('chat_message_user')
    expect(kinds).toContain('chat_message_assistant')
    expect(kinds).toContain('chat_complete')

    // chat_message_user data 应含 content(text)
    const userEv = events.find((e) => e.event === 'chat_message_user')
    expect(userEv).toBeDefined()
    const userData = userEv!.data as { content: Array<{ kind: string; text: string }> }
    expect(userData.content[0]?.text).toBe('你好')
  })

  it('SSE forwards chat_permission_request then chat_permission_resolved after POST /permission', async () => {
    let resolveHandler: (() => void) | null = null
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-q-002',
          cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
          model: 'claude-sonnet-5',
        },
      },
      // 触发 user_confirm:route 层推 permission_request,然后调 userConfirmHandler
      {
        event: {
          kind: 'permission_request',
          ts: 1,
          requestId: 'req-perm-test-001',
          toolName: 'Write',
          input: { file_path: '/tmp/x', content: 'hi' },
          forced: false,
        },
        awaitPermission: {
          toolName: 'Write',
          requestId: 'req-perm-test-001',
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 99,
          sessionId: 'sdk-sess-q-002',
          totalTokens: 50,
          cost: 0.001,
          reason: 'end_turn',
        },
      },
    ]
    // 透传 userConfirmHandler 后等外部 POST /permission
    // 但 fake provider 默认 await 后直接 resolve;route 层应串起来
    // (SSE 请求期间 POST /permission 决议不会实时插入 SSE;
    //  此测试只断言 SSE 含 permission_request 事件 + permission_resolved 后续事件)

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-002/query`,
      { content: [{ kind: 'text', text: '写文件' }] },
      { 'x-aidevspace-token': token },
      500,
    )
    expect(res.statusCode).toBe(200)

    const events = parseSseEvents(res.body)
    const reqEv = events.find((e) => e.event === 'chat_permission_request')
    expect(reqEv).toBeDefined()
    const reqData = reqEv!.data as { requestId: string; toolName: string }
    expect(reqData.toolName).toBe('Write')
    expect(reqData.requestId).toBe('req-perm-test-001')
    // 完成事件应到达(fake provider 直接 await 决议 → 让 provider 跑完)
    expect(events.map((e) => e.event)).toContain('chat_complete')
  })

  it('409 session-locked when second query fires while first in-flight', async () => {
    // 把 fake provider 慢一点,让第一次 SSE 还在 in-flight
    provider.defaultScript = [
      { event: { kind: 'session_init', sessionId: 'sdk-sess-q-003', cwd: '/x', model: 'claude-sonnet-5' } },
    ]
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      // 慢速:先把 session_init 推出来,然后保持挂起 100ms
      input.onEvent({ kind: 'session_init', sessionId: 'sdk-sess-q-003', cwd: '/x', model: 'claude-sonnet-5' })
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, sessionId: 'sdk-sess-q-003' }
    })

    // 第一次 SSE —— 发起,不要等完成
    const ssePromise = postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-003/query`,
      { content: [{ kind: 'text', text: 'first' }] },
      { 'x-aidevspace-token': token },
      500,
    )

    // 等 30ms 让第一次 SSE 进入 in-flight lock
    await new Promise((r) => setTimeout(r, 30))

    // 第二次 SSE —— 应被 409 session-locked 拒绝(不走 SSE 流,直接 JSON)
    const res2 = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-003/query`,
      { content: [{ kind: 'text', text: 'second' }] },
      { 'x-aidevspace-token': token },
      200,
    )
    // 锁冲突时,后到的请求不应走 SSE 流(应直接返 409 JSON)
    expect(res2.statusCode).toBe(409)
    const body = res2.body
    // 锁定响应:即便 postSse 工具也读 SSE,锁冲突应直接断开/返 JSON
    // body 可能为空(连接被 server 端 close),但 statusCode 应是 409
    expect(body).toMatch(/session-locked|E_SESSION_LOCKED|session-locked|tab-locked|E_TAB_LOCKED/i)

    // 等第一次 SSE 完成清理
    await ssePromise
  })

  it('Step 2: 无 session.json 时 /query 派生 effectiveCwd 为任务目录(无 /chat 后缀)', async () => {
    // PRD task-catalog-transformation Step 2 —— cwd 派生从 chat 子目录改为
    // 任务目录。本测试:完全不 seed session.json,让 fallback `cardTaskDir(reqId, cardId)`
    // 命中。Provider.runChatQuery 收到的 `input.cwd` 应为 `<root>/.../tasks/<cardId>`。
    provider.defaultScript = [
      {
        event: {
          kind: 'session_init',
          sessionId: 'sdk-sess-q-cwd-001',
          cwd: '<echo>',
          model: 'claude-sonnet-5',
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 1,
          sessionId: 'sdk-sess-q-cwd-001',
          totalTokens: 0,
          cost: 0,
          reason: 'end_turn',
        },
      },
    ]
    // 把 fake provider 实现替换:捕 input.cwd 即可,无需额外逻辑
    const capturedCwds: string[] = []
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
      capturedCwds.push(input.cwd)
      input.onEvent({
        kind: 'session_init',
        sessionId: 'sdk-sess-q-cwd-001',
        cwd: input.cwd,
        model: 'claude-sonnet-5',
      })
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: 'sdk-sess-q-cwd-001',
        totalTokens: 0,
        cost: 0,
        reason: 'end_turn',
      })
      return { ok: true, sessionId: 'sdk-sess-q-cwd-001' }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-q-cwd-001/query`,
      { content: [{ kind: 'text', text: 'hi' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)

    expect(capturedCwds).toHaveLength(1)
    const cwd = capturedCwds[0]!
    // 期望 cwd = TaskCardStore.cardDirFor(...) = 任务目录(无 /chat 后缀)
    expect(cwd).toBe(taskCardStore.cardDirFor(REQ_ID, CARD_ID))
    // 守护:cwd 不应是 chat 子目录
    expect(cwd.endsWith('/chat')).toBe(false)
    expect(cwd.endsWith(`${CARD_ID}/chat`)).toBe(false)
    // 任务目录的物理位置存在(TaskCardStore.create 时已建好)
    expect(existsSync(cwd)).toBe(true)
    // 同时:frozenCwd 应与 cwd 一致(Provider 层透传)
    const lastCall = provider.runChatQuery.mock.calls[0]?.[0] as ChatQueryInput
    expect(lastCall.frozenCwd).toBe(cwd)
  })
})

// ---------------------------------------------------------------------------
// GET /chat/sessions/snapshot
// ---------------------------------------------------------------------------

describe('GET /chat/sessions/snapshot', () => {
  it('200 + {meta: null, events: []} when no session yet', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: unknown; events: unknown[] }
    expect(body.meta).toBeNull()
    expect(body.events).toEqual([])
  })

  it('200 + meta with 17 fields when session exists', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-snap-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: ['/workspace/req-001-refund'],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [{ name: 'boardchat', config: { type: 'sdk' } }],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      meta: { sessionId: string; model: string; cardId: string }
      events: unknown[]
    }
    expect(body.meta.sessionId).toBe('sdk-sess-snap-001')
    expect(body.meta.model).toBe('claude-sonnet-5')
    expect(body.meta.cardId).toBe(CARD_ID)
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/snapshot`,
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/model
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/model', () => {
  it('200 + updated meta with new model', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-model-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-model-001/model`,
      headers: authHeaders(),
      payload: { model: 'claude-opus-4-8', expectedCostMultiplier: 5 },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { model: string; sessionId: string } }
    expect(body.meta.model).toBe('claude-opus-4-8')
    expect(body.meta.sessionId).toBe('sdk-sess-model-001')
    // session.json 落盘生效
    const reloaded = chatSessionService.get(REQ_ID, CARD_ID)
    expect(reloaded?.model).toBe('claude-opus-4-8')
  })

  it('400 invalid-body when model empty', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-model-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-model-002/model`,
      headers: authHeaders(),
      payload: { model: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('404 session-not-found when no session.json exists', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-not-found/model`,
      headers: authHeaders(),
      payload: { model: 'claude-sonnet-5' },
    })
    expect(res.statusCode).toBe(404)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('session-not-found')
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/plan-mode
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/plan-mode', () => {
  it('200 + permissionMode=plan when enabled', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-001',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-001/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.PLAN)
  })

  it('200 + permissionMode=default when disabled (and was plan)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.PLAN,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-002/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.DEFAULT)
  })

  it('403 permission-denied when session is bypassPermissions', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-003',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.BYPASS_PERMISSIONS,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-003/plan-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('permission-denied')
  })

  it('400 invalid-body when enabled is missing', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-plan-004',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-plan-004/plan-mode`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// PUT /chat/sessions/:sessionId/permission-mode (auto-allow toggle · issue 08)
// ---------------------------------------------------------------------------

describe('PUT /chat/sessions/:sessionId/permission-mode', () => {
  it('200 + permissionMode=bypassPermissions when enabled', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-001',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-001/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.BYPASS_PERMISSIONS)
  })

  it('200 + permissionMode=default when disabled (and was bypassPermissions)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-002',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.BYPASS_PERMISSIONS,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-002/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { meta: { permissionMode: string } }
    expect(body.meta.permissionMode).toBe(ChatPermissionMode.DEFAULT)
  })

  it('403 permission-denied when session is plan (mutual exclusion)', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-003',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: ChatPermissionMode.PLAN,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-003/permission-mode`,
      headers: authHeaders(),
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
    const body = res.json() as { reason: string }
    expect(body.reason).toBe('permission-denied')
  })

  it('400 invalid-body when enabled is missing', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-sess-perm-004',
      cwd: '/workspace/x',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    const res = await app.inject({
      method: 'PUT',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-004/permission-mode`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('POST /chat/sessions/:sessionId/permission', () => {
  it('200 + acknowledge when decision is allow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-001/permission`,
      headers: authHeaders(),
      payload: {
        requestId: 'req-perm-001',
        decision: { decision: 'allow' },
        updatedPermissions: { behavior: 'allow' },
      },
    })
    // 单测不依赖 SDK 实时连接 —— 决议已排队但 user_confirm 不在;返 200 ack
    expect(res.statusCode).toBe(200)
    const body = res.json() as { acknowledged: boolean; requestId: string }
    expect(body.acknowledged).toBe(true)
    expect(body.requestId).toBe('req-perm-001')
  })

  it('400 invalid-body when decision missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-perm-002/permission`,
      headers: authHeaders(),
      payload: { requestId: 'x' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/cost-cap
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/:sessionId/cost-cap', () => {
  it('200 + acknowledge when resolve=continue_once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-001/cost-cap`,
      headers: authHeaders(),
      payload: { resolve: 'continue_once' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { acknowledged: boolean; resolve: string }
    expect(body.acknowledged).toBe(true)
    expect(body.resolve).toBe('continue_once')
  })

  it.each(['continue_once', 'continue_session', 'pause', 'new_session'] as const)(
    '200 + acknowledge for resolve=%s',
    async (resolve) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-${resolve}/cost-cap`,
        headers: authHeaders(),
        payload: { resolve },
      })
      expect(res.statusCode).toBe(200)
    },
  )

  it('400 invalid-body when resolve is unknown', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-cap-bad/cost-cap`,
      headers: authHeaders(),
      payload: { resolve: 'fly-to-the-moon' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/reset(issue 13 端到端自愈)
// ---------------------------------------------------------------------------

describe('POST /chat/sessions/reset · issue 13 自愈端点', () => {
  /** 工具:在 chat dir 落 session.json + audit/foo.log 模拟"有 stale session" */
  async function seedStaleSession(opts: { sdkSessionId: string; cwd: string }): Promise<void> {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: opts.sdkSessionId,
      cwd: opts.cwd,
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    mkdirSync(join(tmpRoot, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'chat', 'audit'), {
      recursive: true,
    })
    writeFileSync(
      join(
        tmpRoot,
        'requirements',
        REQ_ID,
        'board',
        'tasks',
        CARD_ID,
        'chat',
        'audit',
        'fake-audit.jsonl',
      ),
      '{}\n',
    )
  }

  it('200 + acknowledged + 清掉 session.json + audit/ 子目录', async () => {
    await seedStaleSession({
      sdkSessionId: 'sdk-stale-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
    })
    // 确认 seed 落盘
    expect(chatSessionService.get(REQ_ID, CARD_ID)).not.toBeNull()
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'audit',
          'fake-audit.jsonl',
        ),
      ),
    ).toBe(true)

    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      acknowledged: boolean
      cleared: { sessionJson: string; auditDir: string; sdkJsonl: string }
    }
    expect(body.acknowledged).toBe(true)
    expect(body.cleared.sessionJson).toBe('renamed')
    expect(body.cleared.auditDir).toBe('removed')
    // 后续 get() 应返 null
    expect(chatSessionService.get(REQ_ID, CARD_ID)).toBeNull()
    // audit 物理清空
    expect(
      existsSync(
        join(tmpRoot, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'chat', 'audit'),
      ),
    ).toBe(false)
    // session.json.bak 应被保留(兜底)
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'session.json.bak',
        ),
      ),
    ).toBe(true)
  })

  it('200 + acknowledged (idempotent) when no session.json exists', async () => {
    // 没 seed —— 直接 reset,service.delete 应兜底 absent + 仍返 200
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as {
      acknowledged: boolean
      cleared: { sessionJson: string; auditDir: string; sdkJsonl: string }
    }
    expect(body.acknowledged).toBe(true)
    expect(body.cleared.sessionJson).toBe('absent')
    expect(body.cleared.auditDir).toBe('absent')
  })

  it('404 requirement-not-found when req missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/req-999-missing/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  it('404 card-not-found when card missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/01J7X3K2P5EVR0Z3YQJD8HFKXX/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(404)
  })

  it('409 session-locked when concurrent in-flight query holds the lock', async () => {
    // 让 fake provider 第一次 /query 慢 200ms(进入 in-flight lock)
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'session_init',
        sessionId: 'sdk-sess-locked',
        cwd: '/x',
        model: 'claude-sonnet-5',
      })
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, sessionId: 'sdk-sess-locked' }
    })
    const queryPromise = postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-sess-locked/query`,
      { content: [{ kind: 'text', text: 'first' }] },
      { 'x-aidevspace-token': token },
      500,
    )
    await new Promise((r) => setTimeout(r, 30))
    // reset 应被 409 session-locked 拒绝(in-flight /query 持锁)
    const resetRes = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/reset`,
      headers: authHeaders(),
      payload: {},
    })
    expect(resetRes.statusCode).toBe(409)
    expect(resetRes.json()).toMatchObject({ reason: 'session-locked' })
    // 让 in-flight /query 跑完清理
    await queryPromise
  })
})

// ---------------------------------------------------------------------------
// POST /chat/sessions/:sessionId/query · issue 13 自愈触发
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// issue 17 —— sessionId 契约统一:server UUID 就是 SDK session id
//
// 根因(2026-08-13 真实抓取):
//   session.json.sessionId = 0f6ad1fc-...(issue 16 的 server randomUUID)
//   SDK 实际落盘   = ~/.claude/projects/<hash>/88cf532c-....jsonl(SDK 自生成)
//   两个 ID 从来就不是一回事 → /query 拿 server UUID 去 resume 必然失败:
//     'No conversation found with session ID: 0f6ad1fc-...'
//   该错误串不匹配 issue 14 的白名单正则(`is not a UUID` / `--resume requires`
//   / `does not match any session`)—— 因为 issue 16 之后 id 是合法 UUID,CLI
//   过了格式校验改口了 → isSessionExpired=false → 自愈路径完全跳过 →
//   SSE 只有 chat_error E_QUERY_FAILED recoverable:false,用户零反馈。
//
// 修复(SDK 0.3.206 `options.sessionId`,sdk.d.ts:1769 —— "Use a specific
// session ID for the conversation instead of an auto-generated one"):
//   /start  → 纯本地生成 UUID 落盘,不再跑 bootstrap query
//   /query  → 首轮传 newSessionId(SDK 用它建会话,jsonl 名就是它)
//             后续传 resumeSessionId(必然命中,因为 ID 本来就是同一个)
//   回退    → resume 起会话但零输出即失败 → 用同一 UUID 新建重试一次
//             (不依赖任何错误措辞,措辞再变也不会失效)
// ---------------------------------------------------------------------------
describe('POST /query · issue 17 sessionId 契约统一', () => {
  const SESSION_UUID = '0f6ad1fc-8438-40a9-9efb-75a987088c50'

  /** seed 一个 session.json,sessionId 为合法 UUID */
  async function seedSession(established: boolean): Promise<void> {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: SESSION_UUID,
      cwd: join(tmpRoot, 'requirements', REQ_ID, 'board', 'tasks', CARD_ID, 'chat'),
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    if (established) {
      chatSessionService.patch(REQ_ID, CARD_ID, { sdkSessionEstablished: true })
    }
  }

  it('resume 合法 UUID 但 SDK 侧无该会话 → 自动用同一 UUID 新建重试 → AI 正常回复', async () => {
    await seedSession(true)

    const calls: Array<{ resumeSessionId?: string; newSessionId?: string }> = []
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
      calls.push({
        resumeSessionId: input.resumeSessionId,
        newSessionId: input.newSessionId,
      })
      if (input.resumeSessionId) {
        // 第一次:resume 失败且零输出。注意 isSessionExpired=false ——
        // 错误串不在 issue 14 白名单里,这正是本 bug 的关键
        return {
          ok: false,
          error:
            'Claude Code returned an error result: No conversation found with ' +
            `session ID: ${SESSION_UUID}`,
          isSessionExpired: false,
        }
      }
      // 第二次:用 newSessionId 建新会话 → 正常回复
      input.onEvent({ kind: 'message_assistant', ts: 2, text: '你好,我可以帮你', partial: false })
      input.onEvent({
        kind: 'complete',
        ts: 3,
        sessionId: input.newSessionId ?? '',
        totalTokens: 120,
        cost: 0.006,
        reason: 'end_turn',
      })
      return { ok: true, sessionId: input.newSessionId ?? '' }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/${SESSION_UUID}/query`,
      { content: [{ kind: 'text', text: '你好' }] },
      { 'x-aidevspace-token': token },
      500,
    )
    expect(res.statusCode).toBe(200)

    // 1. 两次调用:先 resume,失败后用同一 UUID 新建(前端标识不漂移)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.resumeSessionId).toBe(SESSION_UUID)
    expect(calls[0]?.newSessionId).toBeUndefined()
    expect(calls[1]?.newSessionId).toBe(SESSION_UUID)
    // SDK 契约:sessionId 与 resume 互斥(sdk.d.ts:1766-1767)
    expect(calls[1]?.resumeSessionId).toBeUndefined()

    // 2. 用户看到 AI 回复,而不是静默失败
    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)
    expect(kinds).toContain('chat_message_assistant')
    expect(kinds).toContain('chat_complete')

    // 3. 自愈成功 → 不推任何 chat_error(用户无感)
    expect(events.filter((e) => e.event === 'chat_error')).toHaveLength(0)

    // 4. session.json 保留且 sessionId 不变 —— 不再走 "删档 + 重 /start" 死循环
    const meta = chatSessionService.get(REQ_ID, CARD_ID)
    expect(meta?.sessionId).toBe(SESSION_UUID)
  })

  it('首轮(sdkSessionEstablished=false)→ 传 newSessionId 建会话,不传 resume;成功后标记 established', async () => {
    await seedSession(false)
    expect(chatSessionService.get(REQ_ID, CARD_ID)?.sdkSessionEstablished).toBe(false)

    provider.runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: input.newSessionId ?? '',
        totalTokens: 10,
        cost: 0.001,
        reason: 'end_turn',
      })
      return { ok: true, sessionId: input.newSessionId ?? '' }
    })

    await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/${SESSION_UUID}/query`,
      { content: [{ kind: 'text', text: '首轮' }] },
      { 'x-aidevspace-token': token },
      400,
    )

    // 首轮只调 1 次,且走新建路径
    expect(provider.runChatQuery).toHaveBeenCalledTimes(1)
    const call = provider.runChatQuery.mock.calls[0]?.[0] as ChatQueryInput
    expect(call.newSessionId).toBe(SESSION_UUID)
    expect(call.resumeSessionId).toBeUndefined()

    // 建会话成功 → 落盘标记,下次走 resume
    expect(chatSessionService.get(REQ_ID, CARD_ID)?.sdkSessionEstablished).toBe(true)
  })

  it('已产出 assistant 输出后才失败(rate limit 等)→ 不重试新建,推 E_QUERY_FAILED', async () => {
    await seedSession(true)

    provider.runChatQuery = vi.fn(async (input: ChatQueryInput): Promise<ChatQueryResult> => {
      // 有实际输出 = SDK 跑起来了,失败不是 session 问题 → 不该重试
      input.onEvent({ kind: 'message_assistant', ts: 1, text: '部分回复', partial: false })
      return { ok: false, error: 'rate limit exceeded', isSessionExpired: false }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/${SESSION_UUID}/query`,
      { content: [{ kind: 'text', text: 'hi' }] },
      { 'x-aidevspace-token': token },
      400,
    )

    expect(provider.runChatQuery).toHaveBeenCalledTimes(1)
    const events = parseSseEvents(res.body)
    const errors = events.filter((e) => e.event === 'chat_error')
    expect(errors).toHaveLength(1)
    expect((errors[0]!.data as { code: string }).code).toBe('E_QUERY_FAILED')
  })

  it('/start 不再跑 SDK bootstrap query —— 纯本地生成 UUID 落盘', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: authHeaders(),
      payload: {},
    })
    expect(res.statusCode).toBe(200)

    // bootstrap 存在的唯一理由是"触发 SDK 建 session";现在 /query 首轮自己建,
    // 这次调用纯属浪费(多一次进程 spawn + 一次 API 调用 + 落盘竞态)
    expect(provider.runChatQuery).not.toHaveBeenCalled()

    const meta = chatSessionService.get(REQ_ID, CARD_ID)
    expect(meta?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    expect(meta?.sdkSessionEstablished).toBe(false)
  })
})

describe('POST /query · issue 13 session 失效 SSE 自愈', () => {
  it('SDK 返 ok=true + isSessionExpired=true → SSE 末条 chat_error E_SESSION_EXPIRED + session.json 被改名 .bak', async () => {
    // seed 一个 stale session.json(模拟:之前 /start 用 fake id 'sdk-stale-resume')
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-stale-resume',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })
    expect(chatSessionService.get(REQ_ID, CARD_ID)?.sessionId).toBe('sdk-stale-resume')

    // 替换 fake provider:不 emit session_init,只 emit error 形式 complete
    // 让 runChatQuery 返 { ok: true, sessionId: '', isSessionExpired: true }
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: '', // 真 SDK 找不到 resume 时 observedSessionId 保持 ''
        totalTokens: 0,
        cost: 0,
        reason: 'error',
      })
      return { ok: true, sessionId: '', isSessionExpired: true }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-stale-resume/query`,
      { content: [{ kind: 'text', text: 'continuing' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)

    // 末条应是 chat_error E_SESSION_EXPIRED
    const lastError = [...events].reverse().find((e) => e.event === 'chat_error')
    expect(lastError).toBeDefined()
    const errorData = lastError!.data as { code: string; recoverable: boolean }
    expect(errorData.code).toBe('E_SESSION_EXPIRED')
    expect(errorData.recoverable).toBe(true)

    // 整个 SSE 流末条事件应是 chat_error(isSessionExpired 触发)
    expect(kinds[kinds.length - 1]).toBe('chat_error')

    // session.json 应被改名 .bak(issue 13 端到端自愈关键证据)
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'session.json.bak',
        ),
      ),
    ).toBe(true)
    // service.get 后续返 null
    expect(chatSessionService.get(REQ_ID, CARD_ID)).toBeNull()
  })

  it('issue 14: SDK CLI throw 路径(ok=false + isSessionExpired=true) → SSE 末条 chat_error E_SESSION_EXPIRED + session.json 被改名 .bak', async () => {
    // 真实调用栈(2026-08-11 抓):
    // SDK 调 `claude -p --resume sdk-fake-001 ...`,CLI 找不到 session,先 emit
    //   result { subtype: 'error_during_execution', session_id: '<new uuid>' }
    // 然后 throw `Claude Code returned an error result: Error: --resume requires a
    //   valid session ID... Provided value "sdk-fake-001" is not a UUID`
    // Provider catch → { ok: false, error: '...', isSessionExpired: true }
    // 路由层原本只判 `result.ok && result.isSessionExpired`,ok=false 时跳过
    // 自愈 —— 必须扩展为 `result.isSessionExpired`(不依赖 ok)
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-fake-001', // FakeChatProvider 留下的假 id
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    // 模拟 Provider catch 走 resume-session-not-found 模式
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      // SDK 在 throw 前先 emit 一个 complete event(reason='error',
      // sessionId='')—— 路由层会推 chat_complete(reason=error) 到 SSE
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: '',
        totalTokens: 0,
        cost: 0,
        reason: 'error',
      })
      // 然后 throw → Provider catch → 返 ok=false + isSessionExpired=true
      return {
        ok: false,
        error:
          'Claude Code returned an error result: Error: --resume requires a valid ' +
          'session ID or session title when used with --print. Usage: claude -p ' +
          '--resume <session-id|title>. Provided value "sdk-fake-001" is not a ' +
          'UUID and does not match any session title.',
        isSessionExpired: true,
      }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-fake-001/query`,
      { content: [{ kind: 'text', text: 'hi' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.body)
    const kinds = events.map((e) => e.event)

    // 末条应是 chat_error E_SESSION_EXPIRED(issue 14 关键断言)
    const lastError = [...events].reverse().find((e) => e.event === 'chat_error')
    expect(lastError).toBeDefined()
    const errorData = lastError!.data as { code: string; recoverable: boolean }
    expect(errorData.code).toBe('E_SESSION_EXPIRED')
    expect(errorData.recoverable).toBe(true)

    expect(kinds[kinds.length - 1]).toBe('chat_error')

    // session.json 应被改名 .bak(跟 ok=true 路径一致的自愈证据)
    expect(
      existsSync(
        join(
          tmpRoot,
          'requirements',
          REQ_ID,
          'board',
          'tasks',
          CARD_ID,
          'chat',
          'session.json.bak',
        ),
      ),
    ).toBe(true)
    expect(chatSessionService.get(REQ_ID, CARD_ID)).toBeNull()
  })

  it('issue 14: SDK throw 非 session-expired 错误(ok=false + isSessionExpired=false) → SSE 末条 chat_error E_QUERY_FAILED,session.json 保留', async () => {
    await chatSessionService.getOrCreateSession(REQ_ID, CARD_ID, {
      sdkSessionId: 'sdk-fake-001',
      cwd: '/workspace/req-001-refund/board/tasks/01J.../chat',
      additionalDirectories: [],
      model: 'claude-sonnet-5',
      permissionMode: DEFAULT_PERMISSION_MODE,
      mcpServers: [],
      ownerUserId: 'user-1',
    })

    // 模拟一个非 session-expired 的 throw(error message 不含 --resume / UUID 特征)
    provider.runChatQuery = vi.fn(async (input: ChatQueryInput) => {
      input.onEvent({
        kind: 'complete',
        ts: 1,
        sessionId: '',
        totalTokens: 0,
        cost: 0,
        reason: 'error',
      })
      return {
        ok: false,
        error: 'rate limit exceeded',
        isSessionExpired: false, // 不是 session 失效
      }
    })

    const res = await postSse(
      port,
      `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/sdk-fake-001/query`,
      { content: [{ kind: 'text', text: 'hi' }] },
      { 'x-aidevspace-token': token },
      400,
    )
    expect(res.statusCode).toBe(200)
    const events = parseSseEvents(res.body)

    // 末条应是 chat_error E_QUERY_FAILED(不是 E_SESSION_EXPIRED)
    const lastError = [...events].reverse().find((e) => e.event === 'chat_error')
    expect(lastError).toBeDefined()
    const errorData = lastError!.data as { code: string; recoverable: boolean }
    expect(errorData.code).toBe('E_QUERY_FAILED')
    expect(errorData.recoverable).toBe(false)

    // session.json 不应被清(因为不是 session-expired)
    expect(chatSessionService.get(REQ_ID, CARD_ID)).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 401 鉴权失败(全局)
// ---------------------------------------------------------------------------

describe('auth', () => {
  it('401 on POST start without token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/start`,
      headers: { 'content-type': 'application/json' },
      payload: { content: [{ kind: 'text', text: 'hi' }] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('401 on GET snapshot without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/requirement/${REQ_ID}/board/cards/${CARD_ID}/chat/sessions/snapshot`,
    })
    expect(res.statusCode).toBe(401)
  })
})