/**
 * FakeChatProvider —— 脚本化 board chat Provider(issue 09 / ADR-0029 e2e 守门)
 *
 * 用途:board chat Playwright E2E 在 CI 上 deterministic 触发
 * PermissionPrompt / PlanModePrompt / CostCapModal / 多 tab lock,
 * 不依赖真模型(真模型行为不可靠触发写工具 / ## Plan / $5 费用上限)。
 *
 * 触发:`server.ts` 的 `isMain` 块读
 * `AIDEVSPACE_FAKE_CHAT_PROVIDER=1` env → 构造本 Provider 注入
 * `buildServer({ provider })`(BuildServerOptions 已支持,见 server.ts:67-78)。
 *
 * 设计要点:
 * - 生产模块(非 __tests__)—— env 解析在 server.ts:isMain 运行时,e2e 需要真 agent 进程
 * - 仅实现 ChatQueryCapableProvider.runChatQuery;AIProvider 基础方法 (createSession/shutdown)
 *   用 stub:createSession 抛错(analysis/spike 路径 e2e 不触达),
 *   shutdown no-op
 * - 复用 board-chat-route.test.ts:64-95 的 FakeChatProvider 形态:按 prompt 关键词
 *   emit 预设 SSE 事件序列,awaitPermission 阻塞等 POST /permission 决议
 * - 写 SDK jsonl(`~/.claude/projects/<sha256(cwd).slice(0,16)>/<sessionId>.jsonl`)
 *   让 ChatSessionService.loadSnapshot 解析回历史(路径公式与 ChatSessionService.ts:109-119
 *   的 sdkSessionLogPathFor 严格对齐)
 *
 * 守门契约(ADR-0023 zero-touch):
 * - 不触碰 ClaudeCodeProvider / runAnalysisQuery / createSdkMcpServer / mcpCallCounter
 * - chat 路径走独立命名空间(FakeChatProvider.runChatQuery),与 Analysis Run 物理隔离
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  AIProvider,
  AISession,
  ChatQueryCapableProvider,
  ChatQueryInput,
  ChatQueryResult,
  ChatStreamEvent,
  CreateSessionOptions,
} from './AIProvider.js'
import { sdkSessionLogPathFor } from '../services/board/ChatSessionService.js'

// ---------------------------------------------------------------------------
// Scripted event shape
// ---------------------------------------------------------------------------

/**
 * 单条脚本事件 —— 与 board-chat-route.test.ts FakeChatProvider 同款。
 * `awaitPermission` 触发 input.userConfirmHandler,await 等 POST /permission 决议,
 * 决议 allow → 自动 emit tool_result。
 */
interface ScriptedEvent {
  /** 推给 input.onEvent 的事件 */
  event: ChatStreamEvent
  /** 在此事件 emit 后是否调 userConfirmHandler(permission 流) */
  awaitPermission?: { toolName: string; requestId: string }
  /** 此事件 emit 前延迟毫秒(用于多 tab lock 测试保 stream open) */
  delayMsBefore?: number
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(), ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      resolve()
    })
  })
}

function extractToolInput(event: ChatStreamEvent): Record<string, unknown> {
  return event.kind === 'tool_call' ? event.args : {}
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class FakeChatProvider implements AIProvider, ChatQueryCapableProvider {
  readonly name = 'fake-chat'
  private readonly nextSessionId: string
  /** 按 cwd 缓存脚本(同 cwd 复用同一脚本,避免每次重 build) */
  private readonly scripts = new Map<string, ScriptedEvent[]>()

  constructor(opts: { nextSessionId?: string } = {}) {
    this.nextSessionId = opts.nextSessionId ?? 'sdk-fake-001'
  }

  // -------------------------------------------------------------------------
  // AIProvider stubs —— board chat e2e 不触达 analysis/spike 路径
  // -------------------------------------------------------------------------

  async createSession(
    _reqId: string,
    _opts: CreateSessionOptions,
  ): Promise<AISession> {
    throw new Error(
      'FakeChatProvider does not implement createSession ' +
        '(analysis/spike 路径不受 fake 模式支持)',
    )
  }

  async shutdown(): Promise<void> {
    // no-op —— fake provider 没有真实 SDK 进程需要清理
  }

  // -------------------------------------------------------------------------
  // ChatQueryCapableProvider.runChatQuery —— 核心实现
  // -------------------------------------------------------------------------

  async runChatQuery(input: ChatQueryInput): Promise<ChatQueryResult> {
    // 每次都按 prompt 重新 build(不同 prompt 可能匹配不同脚本分支);
    // 同 cwd 不同 prompt 是合法路径(用户可能发"hello"再发"write ...")
    // board-chat-route.test.ts 的 FakeChatProvider 走 cwd 缓存是因为它的脚本
    // 按 cwd 预注入;FakeChatProvider 是 prompt-driven,无需缓存。
    const script = this.buildScriptFor(input)
    void this.scripts // 保留字段供未来扩展,本实现不用

    for (const step of script) {
      if (step.delayMsBefore) {
        await sleep(step.delayMsBefore, input.signal)
      }
      input.onEvent(step.event)
      if (step.awaitPermission) {
        const args = {
          toolName: step.awaitPermission.toolName,
          requestId: step.awaitPermission.requestId,
          input: extractToolInput(step.event),
        }
        // 必须 await —— 路由 userConfirmHandler 闭包先推 SSE permission_request,
        // 再 await POST /permission 决议(详见 board-chat.ts:548-589)。
        // 不 await 则事件在 modal 渲染前已全部发出,spec 观察不到 modal。
        const decision = await input.userConfirmHandler(args)
        if (
          decision.behavior === 'allow' &&
          step.event.kind === 'tool_call'
        ) {
          input.onEvent({
            kind: 'tool_result',
            ts: Date.now(),
            id: step.event.id,
            name: step.event.name,
            output: { ok: true, summary: 'fake tool result' },
            isError: false,
          })
        }
      }
    }

    this.writeSdkJsonl(input, script)
    return { ok: true, sessionId: this.nextSessionId }
  }

  // -------------------------------------------------------------------------
  // buildScriptFor —— 按用户输入关键词选择脚本
  // -------------------------------------------------------------------------

  /**
   * 按 prompt 关键词分支:
   * - `plan` → assistant `## Plan\n1. Read\n2. Patch\n3. Verify`(触发 PlanModePrompt)
   * - `slow` → write 流程 + 1500ms 延迟(保 stream open 给多 tab lock 测试)
   * - `write` → tool_call(Write) + awaitPermission(触发 PermissionPrompt)
   * - 默认 → 流式 assistant 文本
   */
  private buildScriptFor(input: ChatQueryInput): ScriptedEvent[] {
    const sid = this.nextSessionId
    const prompt = input.prompt.toLowerCase()
    const baseInit: ChatStreamEvent = {
      kind: 'session_init',
      sessionId: sid,
      cwd: input.cwd,
      model: input.model,
    }

    if (prompt.includes('plan')) {
      return [
        { event: baseInit },
        {
          event: {
            kind: 'message_assistant',
            ts: 1,
            text:
              '## Plan\n1. Read file\n2. Apply patch\n3. Verify tests pass',
            partial: false,
          },
        },
        {
          event: {
            kind: 'complete',
            ts: 2,
            sessionId: sid,
            totalTokens: 50,
            cost: 0.001,
            reason: 'end_turn',
          },
        },
      ]
    }

    if (prompt.includes('slow')) {
      // 与 `write` 同款但 complete 前延迟 1500ms,保 stream open
      return [
        { event: baseInit },
        {
          event: {
            kind: 'message_assistant',
            ts: 1,
            text: 'I will write the file',
            partial: false,
          },
        },
        {
          event: {
            kind: 'tool_call',
            ts: 2,
            id: 'tool-1',
            name: 'Write',
            args: { file_path: `${input.cwd}/notes.md`, content: 'hi' },
            partial: false,
          },
          awaitPermission: { toolName: 'Write', requestId: 'req-perm-1' },
        },
        {
          event: {
            kind: 'message_assistant',
            ts: 3,
            text: 'Done',
            partial: false,
          },
        },
        {
          event: {
            kind: 'complete',
            ts: 4,
            sessionId: sid,
            totalTokens: 80,
            cost: 0.002,
            reason: 'end_turn',
          },
          delayMsBefore: 1500,
        },
      ]
    }

    if (prompt.includes('write')) {
      return [
        { event: baseInit },
        {
          event: {
            kind: 'message_assistant',
            ts: 1,
            text: 'I will write the file',
            partial: false,
          },
        },
        {
          event: {
            kind: 'tool_call',
            ts: 2,
            id: 'tool-1',
            name: 'Write',
            args: { file_path: `${input.cwd}/notes.md`, content: 'hi' },
            partial: false,
          },
          awaitPermission: { toolName: 'Write', requestId: 'req-perm-1' },
        },
        {
          event: {
            kind: 'message_assistant',
            ts: 3,
            text: 'Done',
            partial: false,
          },
        },
        {
          event: {
            kind: 'complete',
            ts: 4,
            sessionId: sid,
            totalTokens: 80,
            cost: 0.002,
            reason: 'end_turn',
          },
        },
      ]
    }

    // 默认:流式 hello
    return [
      { event: baseInit },
      {
        event: {
          kind: 'message_assistant',
          ts: 1,
          text: 'Hello! How can I help?',
          partial: false,
        },
      },
      {
        event: {
          kind: 'complete',
          ts: 2,
          sessionId: sid,
          totalTokens: 20,
          cost: 0.0005,
          reason: 'end_turn',
        },
      },
    ]
  }

  // -------------------------------------------------------------------------
  // writeSdkJsonl —— 写 SDK 格式 jsonl 让 loadSnapshot 能解析回历史
  // -------------------------------------------------------------------------

  /**
   * 路径公式走 ChatSessionService.sdkSessionLogPathFor(2026-08-13 探底:SDK 用
   * sanitized cwd 作 dir,不是 sha256);FakeChatProvider 必须用同一 helper,
   * 否则 issue 13 测试 fixture 与 loadSnapshot 路径会错位。
   *
   * SDK jsonl 行形态(参 ChatSessionService.ts:683-770 parseSdkSessionLog):
   * - `{type:'user', message:{role:'user', content:[{type:'text', text}]}}`
   * - `{type:'assistant', message:{role:'assistant', content:[{type:'text', text}]}}`
   * - `{type:'system', subtype:'init', session_id, cwd, model}` —— 标记 init 边界
   * - `{type:'result', subtype:'success', total_cost_usd, usage}` —— 结果
   *
   * 注:parseSdkSessionLog 只解析 system/init 之前的 user/assistant(简化版),所以
   * 把 system/init 放最后。
   */
  private writeSdkJsonl(input: ChatQueryInput, script: ScriptedEvent[]): void {
    // 与 ChatSessionService.sdkSessionLogPathFor 走同一 helper(sanitize cwd,
    // 不是 sha256)——issue 13 测试 fixture 必须能 loadSnapshot 读回
    //
    // sessionId 用 `this.nextSessionId`(fake 内部默认 'sdk-fake-001'),
    // 跟 runChatQuery 返回值 + jsonl 内容里的 session_id 保持一致
    const filePath = sdkSessionLogPathFor(input.cwd, this.nextSessionId)
    const dir = dirname(filePath)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const lines: string[] = []
    lines.push(
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text: input.prompt }],
        },
      }),
    )
    for (const step of script) {
      if (step.event.kind === 'message_assistant' && step.event.text) {
        lines.push(
          JSON.stringify({
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: step.event.text }],
            },
          }),
        )
      }
    }
    lines.push(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: this.nextSessionId,
        cwd: input.cwd,
        model: input.model,
      }),
    )
    lines.push(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    )
    // 确保父目录(mode 0o700 mkdirSync 在循环内已调用);此处直接写
    writeFileSync(filePath, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
    // dirname 已在 mkdirSync 时 mode 0o700,这里冗余一次保险
    void dirname(filePath)
  }
}