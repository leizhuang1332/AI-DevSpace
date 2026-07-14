/**
 * AIEvent → StreamKind 分类 —— ADR-0010 Q10.3 + CONTEXT 决策 43b
 *
 * 决策 43b/49 给的 UI 边界:
 *  - **chat**(对话流):直接显示在 chat 主气泡(text/thinking 等用户能读的内容)
 *  - **activity**(活动流):折叠在 assistant 气泡下方;12px 灰字 1 行 + 1px
 *    顶部分隔线 + hover 展开 3 行详情;不主动弹
 *  - **lifecycle**(生命周期):控制流事件 —— Web 端用其驱动 StatusBar 状态色码
 *    + 计数器(决策 49),不直接渲染到 chat 流
 *
 * Agent 在 SSE `ai_event` variant 上挂 `streamKind` 字段,Web 端按值 narrow
 * dispatch,不再在客户端做类型推导。
 */

import type { AIEvent } from '../providers/AIEvent.js'

export type StreamKind = 'chat' | 'activity' | 'lifecycle'

/**
 * 把 AIEvent 映射到 StreamKind。
 *
 * 规则(brief Q10.3 + 决策 43b):
 *  - text / thinking → 'chat'     —— 用户能读的对话内容
 *  - tool_use / tool_result / file_written / permission_request → 'activity'
 *  - error / done → 'lifecycle'   —— 驱动 StatusBar 色码与计数器
 *  - retrying → 'lifecycle'       —— 驱动「重试中 N/M」提示
 *
 * @param event AIEvent 联合类型的某个实例
 */
export function classifyStreamKind(event: AIEvent): StreamKind {
  switch (event.type) {
    case 'text':
    case 'thinking':
      return 'chat'
    case 'tool_use':
    case 'tool_result':
    case 'file_written':
    case 'permission_request':
      return 'activity'
    case 'error':
    case 'done':
    case 'retrying':
      return 'lifecycle'
  }
}