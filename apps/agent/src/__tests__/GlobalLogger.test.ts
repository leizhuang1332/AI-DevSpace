/**
 * GlobalLogger tests —— 全局结构化事件日志(server.ts 接 Pino)
 *
 * 覆盖:
 *  - 每个事件方法映射到 sink 的正确 level 与 bindings(event 字段 + context)
 *  - sessionLogWriteFailed 把 error 放进 err 字段
 */

import { describe, expect, it } from 'vitest'
import { GlobalLogger, type GlobalLogSink } from '../log/GlobalLogger.js'

function makeSink(): { sink: GlobalLogSink; calls: { level: string; bindings: any; message?: string }[] } {
  const calls: { level: string; bindings: any; message?: string }[] = []
  const sink: GlobalLogSink = {
    info: (bindings, message) => calls.push({ level: 'info', bindings, message }),
    warn: (bindings, message) => calls.push({ level: 'warn', bindings, message }),
    error: (bindings, message) => calls.push({ level: 'error', bindings, message }),
  }
  return { sink, calls }
}

describe('GlobalLogger', () => {
  it('agentStarted 走 info 并带 event/root', () => {
    const { sink, calls } = makeSink()
    new GlobalLogger(sink).agentStarted({ root: '/workspace', version: '1.0.0' })
    expect(calls[0].level).toBe('info')
    expect(calls[0].bindings).toMatchObject({ event: 'agent_started', root: '/workspace', version: '1.0.0' })
  })

  it('agentStopped / configChanged 走 info', () => {
    const { sink, calls } = makeSink()
    const logger = new GlobalLogger(sink)
    logger.agentStopped({ reason: 'SIGTERM' })
    logger.configChanged({ provider: 'claude-code', model: 'sonnet' })
    expect(calls[0]).toMatchObject({ level: 'info', bindings: { event: 'agent_stopped', reason: 'SIGTERM' } })
    expect(calls[1]).toMatchObject({ level: 'info', bindings: { event: 'config_changed', provider: 'claude-code', model: 'sonnet' } })
  })

  it('retryExhausted / queryFailed 走 error', () => {
    const { sink, calls } = makeSink()
    const logger = new GlobalLogger(sink)
    logger.retryExhausted({ localSid: 'sid-1', attempts: 3 })
    logger.queryFailed({ localSid: 'sid-1', code: 'boom' })
    expect(calls[0]).toMatchObject({ level: 'error', bindings: { event: 'query_retry_exhausted', localSid: 'sid-1', attempts: 3 } })
    expect(calls[1]).toMatchObject({ level: 'error', bindings: { event: 'query_failed', localSid: 'sid-1', code: 'boom' } })
  })

  it('sessionLogWriteFailed 把 error 放进 err 字段', () => {
    const { sink, calls } = makeSink()
    const err = new Error('disk full')
    new GlobalLogger(sink).sessionLogWriteFailed(err, { localSid: 'sid-1' })
    expect(calls[0].level).toBe('error')
    expect(calls[0].bindings).toMatchObject({ event: 'session_log_write_failed', err, localSid: 'sid-1' })
  })
})
