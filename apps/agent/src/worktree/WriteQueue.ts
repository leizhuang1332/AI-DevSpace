/**
 * WriteQueue —— ADR-0010 Q4 (P1 写队列)
 *
 * 同一 req 下 N 个 session 共享写操作 FIFO 队列:
 * - 写工具(Edit / Write / NotebookEdit / Bash 写命令)→ exec() 串行
 * - 读工具(Read / Grep / Glob / Bash 读命令)→ 不进队列,直接执行
 * - per-req 独立队列,跨 req 不阻塞
 * - 一次写失败不会卡住后续写(.catch(()=>{}) 吞掉 tail 上的 reject)
 *
 * 设计要点:把"队尾"的 promise 用 .catch(()=>{}) 隔离,这样
 *   const next = prev.then(() => doToolCall(toolCall))
 *   writeQueues.set(reqId, next.catch(() => {}))
 *   return next
 * 调用方拿到的 next 会随工具执行结果 resolve/reject;队尾只关心"是否完成",
 * 不关心"成功还是失败"——这样后续 enqueue 永远能拼到上一轮末尾。
 */

/** 与 AISession 透出的 tool_use.input 同构(只关心 name + input,不强校验) */
export interface WriteToolCall {
  name: string
  input: unknown
}

/** 工具实际执行器 —— 实际场景下接 ClaudeCodeProvider / PermissionHook 等 */
export type WriteRunner = (reqId: string, toolCall: WriteToolCall) => Promise<unknown>

export interface WriteQueueDeps {
  run: WriteRunner
}

export interface WriteQueue {
  /** 串行执行一个写工具调用;返回的 promise 与 run() 的结果同步 */
  exec(reqId: string, toolCall: WriteToolCall): Promise<unknown>
  /** 取消某个 req 的等待队列(已在飞的不动);返回是否真的取消过 */
  cancel(reqId: string): boolean
  /** 当前在排队的 req 数量(测试用) */
  size(): number
}

export function createWriteQueue(deps: WriteQueueDeps): WriteQueue {
  // 队尾类型 = "是否完成" 的 promise,值不重要;用 unknown 接收 .catch 的返回值
  const tails = new Map<string, Promise<unknown>>()

  function exec(reqId: string, toolCall: WriteToolCall): Promise<unknown> {
    const prev = tails.get(reqId) ?? Promise.resolve()
    // next 才是真正"串行执行"的那一格;其 resolve/reject 反映本次工具结果
    const next = prev.then(() => deps.run(reqId, toolCall))
    // 队尾用 .catch(()=>{}) 隔离子任务失败,这样后续 enqueue 不会被卡死。
    // 对齐 ADR-0010 Q4 伪代码:队尾只关心"是否完成",不关心"成功还是失败"。
    // 显式标注 catch handler 返回 void,让 tails 仍保持 Promise<void> 契约。
    tails.set(reqId, next.catch((): void => undefined))
    return next
  }

  function cancel(reqId: string): boolean {
    return tails.delete(reqId)
  }

  function size(): number {
    return tails.size
  }

  return { exec, cancel, size }
}