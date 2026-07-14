/**
 * SSE event types shared between Agent and Web.
 * Extend by UNION adding new variants — never break existing members.
 */

/**
 * AI 业务事件的可序列化 payload(Web 端 EventSource 收到的形态)。
 *
 * 与 apps/agent/src/providers/AIEvent.ts 的 `AIEvent` 形态基本一致,
 * 但 `error.category` 退化为字符串字面量,避免 shared 包依赖 ErrorCategory
 * 类型内部实现(shared 不应反向 import agent)。
 */
export type AiSsePayload =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'file_written'; path: string; lines: number }
  | { type: 'permission_request'; tool: string; input: unknown }
  | {
      type: 'error'
      code: string
      message: string
      recoverable: boolean
      category?: 'A' | 'B' | 'C' | 'D' | 'E'
    }
  | {
      type: 'done'
      reason: 'end_turn' | 'cancelled' | 'error' | 'max_tokens'
      sessionId?: string
    }

export type SseEvent =
  | { type: 'hello'; sid: string; reqId: string; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }
  /**
   * 分析过程 chunk 推送(issue 19b · ADR-0013 D2 ②)
   *
   * Agent 在 ANALYZING 解析过程中(包括 admission-check Skill 运行 / 用户插话后)
   * 通过 SseHub.publish(reqId, ...) 把新增 chunk 推到该 reqId 的所有订阅者;
   * web 客户端 EventSource 收到后追加到打字机思考流末尾。
   *
   * - `reqId`: requirement id(冗余,便于 web 端直接 discard 跨事件)
   * - `sessionId`: 当前会话 id;web 端可据此判断是否要追加(多会话场景,VS3)
   * - `chunk`: 与 `AnalyzingChunk` 形态一致 — 这里只重复最小字段,
   *   web 端读到后补全 stats / timestamp / id 即可
   */
  | {
      type: 'analysis_chunk'
      reqId: string
      sessionId: string
      ts: number
      chunk: {
        id: string
        ts: string
        label: string
        kind: 'narration' | 'subproblem' | 'risk' | 'option'
        tone: 'info' | 'success' | 'warn' | 'err'
        text: string
      }
    }
  /**
   * 权限请求(ADR-0010 Q6.3 + ADR-0009 第 3 层「亮」模态)。
   *
   * Agent 在 SDK PreToolUse hook 命中 5 类高危时,通过 SseHub.publish(reqId, ...)
   * 把请求推到该 reqId 的所有订阅者;Web 端收到后弹模态,等用户 approve / deny。
   *
   * - `requestId`: Agent 端生成的唯一 id,Web 端回复时回带;用于多请求并发场景
   * - `toolName` + `toolInput`: 待执行工具的名字 + 输入;Web 端可展示预览
   * - `hits`: 高危检测结果(分类 + 理由 + 命中片段)
   * - `decision`: 留空 —— 等 Web 端回复后由后续 turn 决定(本期 P2 hook 直接返回
   *   'deny';真正的「approve 后继续」由 S6 接入双向通道后落地)
   */
  | {
      type: 'permission_request'
      reqId: string
      sessionId: string
      ts: number
      requestId: string
      toolName: string
      toolInput: unknown
      hits: ReadonlyArray<{
        category:
          | 'delete-business-file'
          | 'force-push'
          | 'push-to-main'
          | 'secret-leak'
          | 'skip-verify'
        reason: string
        snippet: string
      }>
    }
  /**
   * AI 业务事件(issue P4 · Task 5) — 透传 AIEvent 给 Web 端。
   *
   * Agent 把 AIEvent 序列化为 AiSsePayload 后包成此 variant 推出去。
   * Web 端按 `event.type` dispatch 到 UI 流(thinking/text/tool_use/...)。
   *
   * `streamKind` 由 Agent 计算后附带(ADR-0010 Q10.3 + 决策 43b/49):
   *  - `'chat'` → 直接显示在 chat 主气泡(text/thinking)
   *  - `'activity'` → 折叠在 assistant 气泡下,12px 灰字 1 行 + hover 展开 3 行
   *  - `'lifecycle'` → 驱动 StatusBar 状态色码 + 计数器(error/done/retrying)
   */
  | {
      type: 'ai_event'
      reqId: string
      sessionId: string
      runId: string
      ts: number
      streamKind: 'chat' | 'activity' | 'lifecycle'
      event: AiSsePayload
    }
  /**
   * Query 重试提示(issue P4 · Task 5) — A/C/D 类可重试错误触发 retry 时广播。
   *
   * 与 ai_event.retrying 的区别:本 variant 是查询生命周期的「进度信号」,
   * 由 Agent 的 RetryStrategy 主动 emit;Web 端用于展示「正在重试 N/M」提示。
   */
  | {
      type: 'retrying'
      reqId: string
      sessionId: string
      runId: string
      ts: number
      category: 'A' | 'C' | 'D'
      // C4:SDK 未提供 attempt/max_retries/retry_delay_ms 时为 null
      retry: number | null
      maxRetries: number | null
      delayMs: number | null
      message: string
    }
  /**
   * Query 终态失败(issue P4 · Task 5) — 重试耗尽或非重试错误终止 query。
   *
   * 携带 A-E 分类与可重试性,Web 端据此选择重试入口或直接展示错误。
   */
  | {
      type: 'query_failed'
      reqId: string
      sessionId: string
      runId: string
      ts: number
      category: 'A' | 'B' | 'C' | 'D' | 'E'
      code: string
      message: string
      retryable: boolean
    }
  /**
   * Query 被用户/系统取消(issue P4 · Task 5)。
   *
   * `query_cancelled` 与 `done{reason:'cancelled'}` 语义等价,
   * 但作为独立 SSE variant 便于 Web 端用 narrow switch 单独处理。
   */
  | {
      type: 'query_cancelled'
      reqId: string
      sessionId: string
      runId: string
      ts: number
    }
  /**
   * Query 成功终态(issue P4 · Task 5)— query 正常结束时广播。
   *
   * Web 端 reducer 据此把 status 从 running/retrying 重置为 idle。
   */
  | {
      type: 'query_succeeded'
      reqId: string
      sessionId: string
      runId: string
      ts: number
      durationMs: number
      attempts: number
    }
  /**
   * Session 状态变化(ADR-0010 Q10.4 + 决策 49 StatusBar 色码)。
   *
   * Agent 在 AISession 每次 state 转换(idle↔busy→idle/closed/errored)时
   * 推此 variant 到 per-session 通道。Web 端 reducer 据此更新 StatusBar
   * 主指示器的色码;推送是「静默」的 —— 决策 49 不弹 Toast,不弹窗,
   * 仅 StatusBar 单点指示器变更。
   */
  | {
      type: 'session_state'
      reqId: string
      sessionId: string
      ts: number
      state: 'idle' | 'busy' | 'closed' | 'errored'
    }
  /**
   * 工具写文件计数(决策 49 「最近写入 N」指示器)。
   *
   * Agent 观测到 AISession.events() 流里的 tool_use / file_written 类型
   * 时,递增该 session 的窗口计数并广播此 variant。Web 端 StatusBar 显示
   * 「最近写入 N」数字(默认 60s 衰减窗口,定义见 SessionStateRegistry)。
   */
  | {
      type: 'session_writes'
      reqId: string
      sessionId: string
      ts: number
      recentWrites: number
    }

export const SSE_HEARTBEAT_MS = 30_000
