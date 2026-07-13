/**
 * SessionLogger —— 会话级 query 生命周期日志(log.jsonl)
 *
 * 每次 query 结束后追加一条 JSON 行到
 * `<root>/requirements/<reqId>/sessions/<localSid>/log.jsonl`。
 *
 * 设计约束:
 *  - redaction:input/output preview 落盘前先抹掉 Bearer token / apiKey= /
 *    token= / secret= 等敏感串,避免明文密钥进日志。
 *  - preview 截断:超过 maxPreviewChars 只留前缀,并标 truncated + 原始字符数。
 *  - append 失败绝不抛出:磁盘写入是尽力而为(best-effort),失败走 onWriteError
 *    回调交给 GlobalLogger 记录,不影响主 query 流程。
 *
 * Task 6 会在 query 结束时调用 logQuery();Task 8 把 onWriteError 接到 GlobalLogger。
 */

import { mkdir, appendFile } from 'node:fs/promises'
import { sessionDirFor, logPathFor } from '../session/sessionPaths.js'

/** token 用量摘要;字段可为 null(SDK 未回传) */
export interface TokenUsageSummary {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

/** logQuery 入参 —— 一次 query 的完整生命周期快照 */
export interface SessionQueryLogInput {
  localSid: string
  reqId: string
  durationMs: number
  attempts: number
  retryDelaysMs: number[]
  status: 'succeeded' | 'failed' | 'cancelled' | 'business_error'
  inputText: string
  outputText: string
  incomplete: boolean
  tokens: TokenUsageSummary | null
  error: { category: 'A' | 'B' | 'C' | 'D' | 'E'; code: string; message: string } | null
}

export interface SessionLoggerOptions {
  /** workspace 根路径 */
  root: string
  /** 时间戳注入 —— 便于测试;默认 new Date().toISOString() */
  now?: () => string
  /** preview 最大字符数;默认 500 */
  maxPreviewChars?: number
  /** append 失败回调(不抛出);典型接到 GlobalLogger.sessionLogWriteFailed */
  onWriteError?: (error: unknown, input: SessionQueryLogInput) => void
}

const DEFAULT_MAX_PREVIEW_CHARS = 500

/** preview 摘要:redaction → 截断 */
interface TextSummary {
  preview: string
  characters: number
  truncated: boolean
}

/**
 * 抹掉常见敏感串再截断。
 * 覆盖:`Bearer <token>`、`apiKey=...`、`token=...`、`secret=...`(大小写不敏感);
 * 带引号的值(可含空格)整体抹掉,裸值抹到下一个空白/引号为止。
 */
function summarize(text: string, maxPreviewChars: number): TextSummary {
  const redacted = text
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    // 带引号的值:secret="a b c" —— 连引号带内容一起抹
    .replace(/(api[_-]?key|token|secret)(\s*[=:]\s*)"[^"]*"/gi, '$1$2[REDACTED]')
    .replace(/(api[_-]?key|token|secret)(\s*[=:]\s*)'[^']*'/gi, '$1$2[REDACTED]')
    // 裸值:secret=abc —— 抹到下一个空白/引号
    .replace(/(api[_-]?key|token|secret)(\s*[=:]\s*)[^\s"']+/gi, '$1$2[REDACTED]')
  const characters = redacted.length
  const truncated = characters > maxPreviewChars
  const preview = truncated ? redacted.slice(0, maxPreviewChars) : redacted
  return { preview, characters, truncated }
}

export class SessionLogger {
  readonly #root: string
  readonly #now: () => string
  readonly #maxPreviewChars: number
  readonly #onWriteError?: (error: unknown, input: SessionQueryLogInput) => void

  constructor(options: SessionLoggerOptions) {
    this.#root = options.root
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#maxPreviewChars = options.maxPreviewChars ?? DEFAULT_MAX_PREVIEW_CHARS
    this.#onWriteError = options.onWriteError
  }

  /** 追加一条 query 日志;写盘失败不抛出,走 onWriteError */
  async logQuery(input: SessionQueryLogInput): Promise<void> {
    const tokens = input.tokens ?? {
      input: null,
      output: null,
      cacheRead: null,
      cacheCreation: null,
    }
    const record = {
      timestamp: this.#now(),
      localSid: input.localSid,
      reqId: input.reqId,
      durationMs: input.durationMs,
      attempts: input.attempts,
      retryDelaysMs: input.retryDelaysMs,
      status: input.status,
      input: summarize(input.inputText, this.#maxPreviewChars),
      output: { ...summarize(input.outputText, this.#maxPreviewChars), incomplete: input.incomplete },
      tokens,
      error: input.error,
    }
    try {
      await mkdir(sessionDirFor(this.#root, input.reqId, input.localSid), { recursive: true })
      await appendFile(
        logPathFor(this.#root, input.reqId, input.localSid),
        JSON.stringify(record) + '\n',
        'utf8',
      )
    } catch (error) {
      this.#onWriteError?.(error, input)
    }
  }
}
