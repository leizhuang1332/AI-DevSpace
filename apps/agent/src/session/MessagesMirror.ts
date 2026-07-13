/**
 * MessagesMirror —— ADR-0010 Q7.4 / Q8.6 (本地 messages.jsonl 镜像)
 *
 * Q7.4:历史 source of truth 是 Agent 本地维护的 `messages.jsonl`,而不是 SDK
 * 内部 jsonl(后者仅供 resume)。UI 展示走本地镜像。
 *
 * 每条 AI 事件 → 1 行 JSON,追加写(O_APPEND,天然增量)。
 * Q8.6:错误/取消导致的 partial 流式响应,标 `incomplete: true`。
 *
 * 读接口只收 `localSid`,靠 findSessionDir 反查 reqId(见 sessionPaths.ts)。
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  sessionDirFor,
  messagesPathFor,
  findSessionDir,
} from './sessionPaths.js'

/** 镜像里的一条消息 */
export interface MirrorMessage {
  /** 消息唯一 id(调用方生成) */
  id: string
  /** 事件类型 —— text / thinking / tool_use / tool_result / error / ... */
  type: string
  /** 角色 —— assistant / user / system / tool */
  role: string
  /** 文本内容(或工具摘要) */
  content: string
  /** ISO 8601 时间戳 */
  timestamp: string
  /** SDK 原始 message(可选,便于排查) */
  sdkMessageRaw?: unknown
  /** partial 流式响应标记 (Q8.6) */
  incomplete?: boolean
}

export interface MessagesMirrorDeps {
  root: string
}

export class MessagesMirror {
  readonly #root: string

  constructor(deps: MessagesMirrorDeps) {
    this.#root = deps.root
  }

  /** 追加一条消息(1 行 jsonl)。会自动建 session 目录。 */
  async appendMessage(reqId: string, localSid: string, msg: MirrorMessage): Promise<void> {
    const dir = sessionDirFor(this.#root, reqId, localSid)
    await mkdir(dir, { recursive: true })
    const line = JSON.stringify(msg) + '\n'
    await appendFile(messagesPathFor(this.#root, reqId, localSid), line, 'utf8')
  }

  /** 追加一条 incomplete 的 partial 消息 (Q8.6) */
  async appendIncomplete(
    reqId: string,
    localSid: string,
    msg: Omit<MirrorMessage, 'incomplete'>,
  ): Promise<void> {
    await this.appendMessage(reqId, localSid, { ...msg, incomplete: true })
  }

  /**
   * 读回 session 的全部消息(顺序 = 写入顺序)。
   * `sinceId` 给定且命中时,只返回其之后(不含)的消息;未命中则返回全部。
   * 坏行(非法 JSON)/ 空行跳过,不抛错。无文件返回 []。
   */
  async readMessages(localSid: string, sinceId?: string): Promise<MirrorMessage[]> {
    const found = findSessionDir(this.#root, localSid)
    if (!found) return []
    const path = messagesPathFor(this.#root, found.reqId, localSid)
    if (!existsSync(path)) return []

    const raw = await readFile(path, 'utf8')
    const messages: MirrorMessage[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        messages.push(JSON.parse(trimmed) as MirrorMessage)
      } catch {
        // 坏行(半截流式写入被中断等)跳过 —— 不让一行坏数据毁掉整个历史
      }
    }

    if (sinceId === undefined) return messages
    const idx = messages.findIndex((m) => m.id === sinceId)
    if (idx < 0) return messages
    return messages.slice(idx + 1)
  }
}
