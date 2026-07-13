/**
 * ResumeManager —— ADR-0010 Q7.3 / Q8.6 (自动 resume)
 *
 * Q7.3:Web 拉 session → Agent 读 meta → 检查 sdkSessionId → 调 SDK
 * `query({ resume })` 续上下文,全自动。
 *
 * resume 失败(SDK 找不到 session)→ 新建空 session + meta 标 `recovered: true`,
 * 上层据此提示用户「上次对话上下文已丢失」。
 *
 * ## 失效检测
 * SDK 的 `query()` 是惰性的(首次 send 才 spawn),`tryResume` 阶段无法同步得知
 * sdkSessionId 是否还在。因此注入可选 `probe(sdkSessionId): Promise<boolean>`:
 *   - 注入 → 用它判定有效性(测试可 mock「SDK 找不到」;生产可做轻量探测)
 *   - 未注入 → 默认视为有效(真失败留给 P4 错误重试链兜底)
 */

import type { AIProvider, AISession, CreateSessionOptions } from '../providers/AIProvider.js'
import type { SessionStore, SessionMeta } from './SessionStore.js'

export interface ResumeManagerDeps {
  store: SessionStore
  provider: AIProvider
  /**
   * 校验 sdkSessionId 是否仍可 resume。返回 false → 走 recovered 流程。
   * 未注入时默认视为有效。
   */
  probe?: (sdkSessionId: string) => Promise<boolean>
}

/** tryResume 结果 */
export interface ResumeResult {
  /** 续上下文 / 新建的 session 句柄 */
  session: AISession
  /** 更新后的 meta */
  meta: SessionMeta
  /** true = SDK 找不到旧 session,已重建空 session(上层需提示用户) */
  recovered: boolean
}

export class ResumeManager {
  readonly #store: SessionStore
  readonly #provider: AIProvider
  readonly #probe: ((sdkSessionId: string) => Promise<boolean>) | undefined

  constructor(deps: ResumeManagerDeps) {
    this.#store = deps.store
    this.#provider = deps.provider
    this.#probe = deps.probe
  }

  /**
   * 尝试 resume 一个已有 session:
   *   - 无 sdkSessionId(全新未 query)→ fresh session(无 resume),recovered=false
   *   - 有 sdkSessionId + probe 判定有效 → createSession({ resume }),recovered=false
   *   - 有 sdkSessionId + probe 判定失效 → 新空 session + meta.recovered=true,recovered=true
   */
  async tryResume(localSid: string): Promise<ResumeResult> {
    const meta = await this.#store.getSession(localSid)
    if (!meta) throw new Error(`ResumeManager.tryResume: session ${localSid} not found`)

    const baseOpts: CreateSessionOptions = {
      localSid: meta.sid,
      topic: meta.topic,
      kind: meta.kind,
      ...(meta.model !== undefined ? { model: meta.model } : {}),
      ...(meta.cwd !== undefined ? { cwd: meta.cwd } : {}),
    }

    // 全新 session:没有可续的上下文
    if (!meta.sdkSessionId) {
      const session = await this.#provider.createSession(meta.reqId, baseOpts)
      return { session, meta, recovered: false }
    }

    // 有 sdkSessionId:probe 判定是否还能 resume
    const valid = this.#probe ? await this.#probe(meta.sdkSessionId) : true
    if (valid) {
      const session = await this.#provider.createSession(meta.reqId, {
        ...baseOpts,
        resume: meta.sdkSessionId,
      })
      return { session, meta, recovered: false }
    }

    // 失效:重建空 session,清 sdkSessionId + 标 recovered
    const session = await this.#provider.createSession(meta.reqId, baseOpts)
    const updated = await this.#store.updateSession(localSid, {
      recovered: true,
      sdkSessionId: '',
    })
    return { session, meta: updated, recovered: true }
  }
}
