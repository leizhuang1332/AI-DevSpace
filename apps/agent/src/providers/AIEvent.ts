/**
 * AIEvent 联合类型 —— ADR-0010 Q2
 *
 * 「SDK 事件 → 业务事件」二段映射的产物。Web 端 / 上层业务不直接消费 SDK message,
 * 避免 SDK 升级时连带改动。
 *
 * 扩展规则:UNION 新增 variant,不允许修改既有字段。
 */

/** done 事件原因 */
export type DoneReason = 'end_turn' | 'cancelled' | 'error' | 'max_tokens'

/** AIEvent —— 与 ADR-0010 Q2 表格对齐 */
export type AIEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string; delta?: boolean }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'file_written'; path: string; lines: number }
  | { type: 'permission_request'; tool: string; input: unknown }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'done'; reason: DoneReason; sessionId?: string }