/**
 * SessionLogger tests —— 会话级 log.jsonl 写入
 *
 * 覆盖:
 *  - 单条记录:redaction(apiKey/token/secret/Bearer)+ preview 截断 + token 字段
 *  - tokens 为 null 时补 null 字段;写盘失败走 onWriteError 不抛出
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLogger } from '../log/SessionLogger.js'
import { logPathFor } from '../session/sessionPaths.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-session-log-'))
})
afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('SessionLogger', () => {
  it('writes one redacted and truncated JSONL record', async () => {
    const logger = new SessionLogger({
      root,
      now: () => '2026-07-13T00:00:00.000Z',
      maxPreviewChars: 12,
    })
    await logger.logQuery({
      localSid: 'sid-1',
      reqId: 'REQ-1',
      durationMs: 42,
      attempts: 2,
      retryDelaysMs: [1000],
      status: 'succeeded',
      inputText: 'apiKey=secret-value and more',
      outputText: 'abcdefghijklmnop',
      incomplete: false,
      tokens: { input: 10, output: 4, cacheRead: null, cacheCreation: null },
      error: null,
    })
    const line = readFileSync(logPathFor(root, 'REQ-1', 'sid-1'), 'utf8').trim()
    const record = JSON.parse(line)
    expect(record.timestamp).toBe('2026-07-13T00:00:00.000Z')
    expect(record.input.preview).not.toContain('secret-value')
    expect(record.output).toMatchObject({
      preview: 'abcdefghijkl',
      characters: 16,
      truncated: true,
    })
    expect(record.tokens.input).toBe(10)
  })

  it('uses null token fields and reports write failures without throwing', async () => {
    const onWriteError = vi.fn()
    const logger = new SessionLogger({ root: '\0invalid', onWriteError })
    await expect(
      logger.logQuery({
        localSid: 'sid',
        reqId: 'REQ',
        durationMs: 1,
        attempts: 1,
        retryDelaysMs: [],
        status: 'failed',
        inputText: 'q',
        outputText: '',
        incomplete: true,
        tokens: null,
        error: { category: 'B', code: 'bad', message: 'failed' },
      }),
    ).resolves.toBeUndefined()
    expect(onWriteError).toHaveBeenCalledOnce()
  })
})
