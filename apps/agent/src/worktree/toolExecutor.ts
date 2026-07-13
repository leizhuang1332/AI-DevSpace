/**
 * toolExecutor —— ADR-0010 Q4 (P1 工具执行器)
 *
 * 把「分类」+「WriteQueue」粘起来,给上层(AISession / PermissionHook 等)一个简单的入口:
 *
 *   await executor.exec(reqId, { name: 'Edit', input: {...} })
 *
 * 内部流程:
 *   1. classifyTool(name, input) → 'read' | 'write'
 *   2. write → writeQueue.exec(reqId, tc) → writeRunner
 *   3. read  → readRunner(reqId, tc) (直接,不排队)
 *
 * 这是 P1 阶段的最小执行器。PreToolUse hook(Q6 高危检测)留到 P2 接 SDK 原生 hook。
 */

import { createWriteQueue, type WriteRunner, type WriteToolCall } from './WriteQueue.js'
import { classifyTool } from './toolClassifier.js'

/** 原始工具调用 —— 不透明载荷,runner 自行解析 input */
export interface RawToolCall {
  name: string
  input: unknown
}

/** 读工具执行器 —— 直接调,不等队列 */
export type ReadRunner = (reqId: string, tc: RawToolCall) => Promise<unknown>

export interface ToolExecutorDeps {
  readRunner: ReadRunner
  writeRunner: WriteRunner
}

export interface ToolExecutor {
  exec(reqId: string, tc: RawToolCall): Promise<unknown>
  /** 调试用 —— 当前在排队的 req 数 */
  queueSize(): number
}

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutor {
  const queue = createWriteQueue({ run: deps.writeRunner })

  async function exec(reqId: string, tc: RawToolCall): Promise<unknown> {
    const cls = classifyTool(tc.name, tc.input)
    if (cls === 'write') {
      // WriteToolCall 与 RawToolCall 形状一致(name + input),但保留独立类型以便
      // 后续给 WriteQueue 加更严格的契约。
      const wtc: WriteToolCall = { name: tc.name, input: tc.input }
      return queue.exec(reqId, wtc)
    }
    return deps.readRunner(reqId, tc)
  }

  function queueSize(): number {
    return queue.size()
  }

  return { exec, queueSize }
}