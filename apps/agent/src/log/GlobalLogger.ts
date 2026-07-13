/**
 * GlobalLogger —— 全局结构化事件日志(agent 级)
 *
 * 薄封装:把领域事件映射到底层结构化日志 sink 的 info/warn/error。
 * server.ts 用 Fastify 的 Pino logger 作为 sink 接入(Task 8);
 * 测试用内存 sink 断言 event 字段与 bindings。
 *
 * 约定:每条日志的 bindings 第一字段是 `event`,便于按事件类型过滤/告警。
 */

/** 底层结构化日志 sink;与 Pino 的 (obj, msg) 签名兼容 */
export interface GlobalLogSink {
  info(bindings: object, message?: string): void
  warn(bindings: object, message?: string): void
  error(bindings: object, message?: string): void
}

export class GlobalLogger {
  constructor(readonly sink: GlobalLogSink) {}

  agentStarted(context: { root: string; version: string }): void {
    this.sink.info({ event: 'agent_started', ...context }, 'agent started')
  }

  agentStopped(context: { reason: string }): void {
    this.sink.info({ event: 'agent_stopped', ...context }, 'agent stopped')
  }

  configChanged(context: { provider: string | null; model: string | null }): void {
    this.sink.info({ event: 'config_changed', ...context }, 'agent configuration loaded')
  }

  retryExhausted(context: object): void {
    this.sink.error({ event: 'query_retry_exhausted', ...context }, 'query retries exhausted')
  }

  queryFailed(context: object): void {
    this.sink.error({ event: 'query_failed', ...context }, 'query failed')
  }

  sessionLogWriteFailed(error: unknown, context: object): void {
    this.sink.error(
      { event: 'session_log_write_failed', err: error, ...context },
      'session log write failed',
    )
  }
}
