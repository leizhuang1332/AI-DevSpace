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
  | {
      type: 'hello'
      sid: string
      ts: number
      /**
       * per-req 通道标识(决策 4 / ticket 07a 之前的所有 SSE 路由都用 reqId)。
       * 与 `channel` 互斥:per-req 路由填 `reqId`,全局 channel 路由填 `channel`。
       */
      reqId?: string
      /**
       * 全局 channel key(ticket 07a 新增)。固定字符串如 `'requirements'` /
       * `'sessions'` / `'repos'`,用于 dashboard / list 类页面订阅"任何 req
       * 的 created/updated"事件。EventSource 收到后用 channel 标识本连接
       * 绑定的业务范围。
       */
      channel?: string
    }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }
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
  /**
   * 需求创建结果(issue 04 — `POST /api/requirements`)。
   *
   * Agent 端在创建成功 / 失败时通过 `SseHub.publish(id, ...)` 推此 variant
   * 到**新建 id**的通道(Web 端通常在弹窗 onSubmit → router.push 之前已经
   * 在新 id 的 `/api/requirement/:id/events` 上预订阅)。
   *
   * - `reqId`: 新建的需求 id(= `req-NNN-<slug>`)
   * - `ok: true`  → 携带 `title` + `createdAt`,Web 端 DRAFTING 骨架屏切正常态
   * - `ok: false`  → 携带 `code` + `message`,Web 端 DRAFTING 切红色 banner
   *
   * 路由层 HTTP 201 + JSON 响应仍是主契约;SSE 是「推送」语义,
   * 用于解耦 Web 端 router.push 与文件落盘的竞态(详见 ticket 04 验收)。
   */
  | {
      type: 'requirement_created'
      reqId: string
      ok: boolean
      ts: number
      title?: string
      createdAt?: string
      code?: string
      message?: string
    }
  // -------------------------------------------------------------------------
  // Analysis Run 事件簇(issue 02 · ADR-0021)
  //
  // 所有 Run 事件都带 `reqId` + `runId`,Web 端按 Run 路由后再按类型 narrow。
  // 终态事件(succeeded / failed)互斥;Run 内事件顺序保证:
  //   analysis_run_created → (0..N analysis_issue_reported)
  //   → (0..N analysis_run_log) → analysis_run_succeeded | analysis_run_failed
  // -------------------------------------------------------------------------
  /**
   * 新 Run 创建(issue 02 acceptance 3 · 4)。Agent 启动 handler 同步落盘后
   * publish,Web 端可在 POST 201 返回前就收到事件,用于"按钮 loading 状态 →
   * 真实 Run 渲染"无缝衔接;同时把新 Run 加入历史列表。
   */
  | {
      type: 'analysis_run_created'
      reqId: string
      runId: string
      ts: number
      skillName: string
      createdAt: string
    }
  /**
   * Issue 提交成功(issue 02 · 决策 29 落点)。Agent 在业务工具
   * `report_analysis_issue` 接受后立即 publish;Web 端据此前置追加 Issue
   * 卡(不等 SSE 心跳延迟),Issue 已落盘。
   */
  | {
      type: 'analysis_issue_reported'
      reqId: string
      runId: string
      ts: number
      issue: import('./analysis-run.js').AnalysisIssue
    }
  /**
   * Issue 提交被拒(PR-1 / ticket 10)。Agent 在业务工具
   * `report_analysis_issue` 因 parser 校验或 runService.reportIssue 门禁
   * 失败时 publish 一次;携带 `reason`(parser reason 或 reportIssue code)
   * 与 `inputKeys`(原始入参键名,便于定位模型传错字段)。
   *
   * 当前 Web 端不消费此事件(agent.log / Run Log 已能定位);
   * 保留 SSE 通道便于后续 UI 提示"本次 Run 调用失败"或自动 retry。
   */
  | {
      type: 'analysis_issue_rejected'
      reqId: string
      runId: string
      ts: number
      toolUseId: string
      reason: string
      inputKeys: string
    }
  /**
   * Run Log 增量(决策 37 · 38)。Agent 在 SDK 推到文本/工具事件时落
   * `log.jsonl` 后 publish;Web 端据此展开 Run Log 面板实时滚动。
   * 排除 system prompt 与模型原始思维链(决策 71 / 72)。
   */
  | {
      type: 'analysis_run_log'
      reqId: string
      runId: string
      ts: number
      entry: import('./analysis-run.js').AnalysisLogEntry
    }
  /** Run 成功终态(issue 02 acceptance 9 / 17)。Agent 在所有条件满足
   * (完成工具接受 / SDK 成功 / 无未决 / 持久化完成)时 publish 一次;
   * 与 `analysis_run_failed` 互斥。issue_count 为最终数量(成功且零 Issue
   * 也合法,UI 显示"本次 Skill 未识别出问题")。 */
  | {
      type: 'analysis_run_succeeded'
      reqId: string
      runId: string
      ts: number
      finishedAt: string
      issueCount: number
    }
  /** Run 失败终态。Agent 在 SDK 错误 / 超时 / 完成工具缺失等终态失败时
   * publish 一次;保留错误原因 + 已提交的部分 Issue 与 Run Log。 */
  | {
      type: 'analysis_run_failed'
      reqId: string
      runId: string
      ts: number
      finishedAt: string
      error: string
      issueCount: number
    }
  /**
   * Run 永久删除(issue 05 · 决策 42)。Agent 在 DELETE 端点确认
   * 物理级联删除成功后 publish 一次;Web 端据此刷新历史列表 / 焦点回收
   * (详见 `apps/web/src/components/analyzing-zone.tsx` 的 onRunDeleted 处理)。
   *
   * 携带 `skillName` / `issueCount` / `deletedAt` 是为了支持 Web 端 toast
   * 与跨标签 UI 反馈(无 toast 时,Web 端需要再发一次 GET /runs 才能拿到
   * 被删 Skill 名 —— 浪费一次 round-trip)。该事件**只在成功删除后**推送,
   * 失败的删除请求由 HTTP 响应表达,不污染 SSE。
   */
  | {
      type: 'analysis_run_deleted'
      reqId: string
      runId: string
      ts: number
      deletedAt: string
      /** 被删除 Run 当时所选 Analysis Skill 名称(用于历史 UI 残留 toast) */
      skillName: string
      /** 被删除 Run 当时的 Issue 数(用于 toast / 跨标签反馈) */
      issueCount: number
    }
  /**
   * Run 重试进度(issue 07 验收 1)。Agent 在 SDK 临时错误(网络/限流/
   * 5xx)后,延迟重试前 publish 一次;Web 端可显示"正在重试第 N 次"提示。
   *
   * 不写入 `log.jsonl`(决策 37:retrying 不入 Run Log,只对前端可见);
   * 携带 `category` 便于 UI 决定是否静默 / 提示。
   */
  | {
      type: 'analysis_run_retrying'
      reqId: string
      runId: string
      ts: number
      /** 第几次 attempt(1-based);本事件发出后即将进行第 attempt+1 次尝试 */
      attempt: number
      /** 错误分类;A=API transient,D=network,C=process;B/E/cancelled 不发本事件 */
      category: 'A' | 'C' | 'D'
      /** 分类层判定的可重试标志(冗余于 category,便于客户端快速判断) */
      retryable: boolean
      /** 本次重试前的退避时长(毫秒) */
      delayMs: number
      /** 错误原因原样(由 SDK 透传,前端可降级显示) */
      error: string
    }
  // -------------------------------------------------------------------------
  // PRD 拆解 Run 事件簇(issue 05 · ADR-0027 D4)
  //
  // 与 analysis_run 事件簇同构(reqId + runId + ts),但 runId 前缀 `prd-`,
  // 产物落 `analysis/proposals/<run-id>/`。Run 在父 analyzing transcript 内
  // 跑,产物落盘后 web 端 GET /runs/:runId 拉候选卡片。
  // -------------------------------------------------------------------------
  /**
   * 新 PRD 拆解 Run 创建(POST /split-from-prd 201 后立即 publish)。
   * Web 端据此把按钮切 loading → 轮询 GET /runs/:runId。
   */
  | {
      type: 'prd_split_created'
      reqId: string
      runId: string
      ts: number
      granularity: import('./prd-split.js').PrdSplitGranularityT
      expectedCount: number
      createdAt: string
    }
  /**
   * 单张候选卡片提交成功(propose_card 接受后 publish)。
   * Web 端可据此前置追加候选卡(不等终态)。
   */
  | {
      type: 'prd_split_proposal_reported'
      reqId: string
      runId: string
      ts: number
      proposal: import('./prd-split.js').PrdSplitProposal
    }
  /**
   * Run 终态成功(cards.yaml 落盘 + meta succeeded)。
   */
  | {
      type: 'prd_split_succeeded'
      reqId: string
      runId: string
      ts: number
      finishedAt: string
      actualCount: number
    }
  /**
   * Run 终态失败(SDK 抛 / 持久化失败等)。
   */
  | {
      type: 'prd_split_failed'
      reqId: string
      runId: string
      ts: number
      finishedAt: string
      error: string
      actualCount: number
    }
  /**
   * Run 被永久删除(DELETE /runs/:runId)。与 prd_split_failed 区分:
   * 删除是用户主动操作,不是 Run 失败;web 端据此从历史列表移除该项。
   */
  | {
      type: 'prd_split_deleted'
      reqId: string
      runId: string
      ts: number
      deletedAt: string
      granularity: import('./prd-split.js').PrdSplitGranularityT
      actualCount: number
    }

export const SSE_HEARTBEAT_MS = 30_000
