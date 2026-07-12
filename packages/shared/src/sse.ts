/**
 * SSE event types shared between Agent and Web.
 * Extend by UNION adding new variants — never break existing members.
 */
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

export const SSE_HEARTBEAT_MS = 30_000
