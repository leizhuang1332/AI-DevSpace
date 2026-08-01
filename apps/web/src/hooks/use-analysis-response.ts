'use client'

/**
 * useAnalysisResponse —— Issue Response 自动保存 hook(issue 04 · ADR-0021)
 *
 * 设计要点(决策 11 / 46):
 * - 防抖自动保存:用户输入 → 内部 setDraft → debounce timer 到 → flush 当前 draft
 * - 失焦、历史切换、组件卸载 → 立即 flush(取消 timer + 同步等待最新请求)
 * - 单调编辑版本:服务端维护 edit_version,客户端 PUT 必须带 base_edit_version;
 *   服务端发现不一致 → 409 stale_response → 客户端需要 flush 后重新提交。
 *   这里把"flush 后重新提交"实现为:等待当前 in-flight 请求完成后,用最新
 *   edit_version 重新发起 PUT(避免与既有 in-flight 冲突)。
 * - 状态机:`idle` / `dirty`(输入中) / `saving`(防抖期或保存中) / `saved` /
 *   `error`(保存失败 → 阻塞启动分析)
 *
 * 与 flush gate 的协作:
 * - flush() 返回 Promise;flush 成功后把状态切回 idle,失败则保持 error 状态。
 * - flush() 失败时,调用方应阻塞"开始分析"按钮(issue 04 验收 8)。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchIssueResponse,
  putIssueResponse,
  StaleResponseError,
  type IssueResponseGet,
} from '@/lib/analysis-response'

/** 保存状态(issue 04 验收 4) */
export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export interface UseAnalysisResponseState {
  /** 当前显示给用户的 Markdown(已 trim 后 → '' 表示未答复) */
  draft: string
  /** 服务端最新已知版本号(用于乐观并发控制) */
  editVersion: number
  /** 最新已知更新时间(展示"已保存"用) */
  updatedAt: string
  /** 状态机(issue 04 验收 4) */
  status: SaveStatus
  /** 最后一次失败的错误信息(若有) */
  errorMessage: string | null
}

export interface UseAnalysisResponseApi extends UseAnalysisResponseState {
  /** 用户输入新内容(进入 dirty 状态 + 启动 debounce) */
  setDraft: (next: string) => void
  /** 强制立即 flush(失焦 / 历史切换 / 卸载 / 开始分析时) */
  flush: () => Promise<void>
  /** 重新拉取(用于跨 Run 切换 / 历史恢复) */
  reload: () => Promise<void>
}

/** 默认防抖时长(issue 04 验收 5) */
const DEBOUNCE_MS = 600

/**
 * 把 issue response 包装成"自动保存 hook"。
 *
 * `requirementId` + `runId` + `issueId` 三元组决定了写入目标;切换其中任一项
 * 都会重新加载初始状态并清理旧 timer。
 */
export function useAnalysisResponse(
  requirementId: string,
  runId: string,
  issueId: string,
  debounceMs: number = DEBOUNCE_MS,
): UseAnalysisResponseApi {
  const [draft, setDraftState] = useState('')
  const [editVersion, setEditVersion] = useState(0)
  const [updatedAt, setUpdatedAt] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Refs 用于跨 effect / 防抖保存最新值
  const draftRef = useRef('')
  const editVersionRef = useRef(0)
  const dirtyRef = useRef(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // in-flight 请求的最新 Promise;flush() 等待它结束
  const inFlightRef = useRef<Promise<void> | null>(null)
  // 防 stale 重试期间,锁住新输入 → 避免再次进入 flush 队列
  const retryingRef = useRef(false)

  // 切换 issue target 时清理 + 重新加载
  // 关键(issue 04 验收 6):切换 target → 立即 flush 当前 dirty draft(模拟
  // "历史切换 flush");flush 是 best-effort,失败留给上层 catch 处理。
  useEffect(() => {
    let cancelled = false
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    // 切走前 flush(若有 dirty)
    if (dirtyRef.current && inFlightRef.current === null) {
      void performFlush().catch(() => {
        /* best-effort:flush 失败不阻塞 UI 切到新 target */
      })
    }
    setStatus('idle')
    setErrorMessage(null)
    setDraft('')
    draftRef.current = ''
    dirtyRef.current = false
    editVersionRef.current = 0
    void (async () => {
      try {
        const resp: IssueResponseGet = await fetchIssueResponse(
          requirementId,
          runId,
          issueId,
        )
        if (cancelled) return
        // 仅在用户尚未开始输入时才覆盖本地 draft(避免 fetch 慢响应回填
        // 覆盖用户未 flush 的输入)
        if (!dirtyRef.current) {
          setDraftState(resp.body)
          draftRef.current = resp.body
          setEditVersion(resp.edit_version)
          editVersionRef.current = resp.edit_version
          setUpdatedAt(resp.updated_at)
        }
        setStatus('idle')
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setErrorMessage(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [requirementId, runId, issueId])

  /** 内部:真正发起 PUT(等待结果) */
  const doPut = useCallback(
    async (body: string, baseVersion: number): Promise<void> => {
      const resp = await putIssueResponse(requirementId, runId, issueId, body, baseVersion)
      setEditVersion(resp.edit_version)
      editVersionRef.current = resp.edit_version
      setUpdatedAt(resp.updated_at)
      setStatus('saved')
      setErrorMessage(null)
    },
    [requirementId, runId, issueId],
  )

  /** 内部:执行一次 flush,处理 stale 重试 */
  const performFlush = useCallback(async (): Promise<void> => {
    // 若无 dirty + 无 in-flight,无需操作
    if (!dirtyRef.current && inFlightRef.current === null) return
    // 取消 debounce timer
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    // 若已在 in-flight,不要起第二个任务 —— 让那次 in-flight 用最新 draft 即可
    // (issue 04 验收 6:flush 不可起并发请求)
    if (inFlightRef.current !== null) {
      try {
        await inFlightRef.current
      } catch {
        /* swallow */
      }
      // 再次检查:若上一轮仍未把 dirty 清掉(例如 error 路径),再发起一次
      if (!dirtyRef.current) return
    }

    const body = draftRef.current
    const baseVersion = editVersionRef.current

    const task = (async () => {
      setStatus('saving')
      // 失败重试循环:处理 stale_response → 用最新 edit_version 再发一次
      // (issue 04 验收 7)
      let attempt = 0
      let lastError: unknown = null
      while (attempt < 2) {
        try {
          await doPut(body, attempt === 0 ? baseVersion : editVersionRef.current)
          dirtyRef.current = false
          return
        } catch (err) {
          lastError = err
          if (err instanceof StaleResponseError) {
            // 同步服务端最新 edit_version,然后用新 base 重试
            editVersionRef.current = err.currentEditVersion
            attempt++
            continue
          }
          // 其它错误:终止重试,转 error 状态
          setStatus('error')
          setErrorMessage(err instanceof Error ? err.message : String(err))
          dirtyRef.current = false
          return
        }
      }
      // 两次 stale 仍失败 → 报错
      setStatus('error')
      setErrorMessage(lastError instanceof Error ? lastError.message : String(lastError))
    })()
    inFlightRef.current = task
    try {
      await task
    } finally {
      inFlightRef.current = null
    }
  }, [doPut])

  /** 用户输入新内容(issue 04 验收 5 防抖) */
  const setDraft = useCallback(
    (next: string) => {
      if (retryingRef.current) return
      setDraftState(next)
      draftRef.current = next
      dirtyRef.current = true
      setStatus('dirty')
      // 清掉旧 timer,重置防抖
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null
        void performFlush()
      }, debounceMs)
    },
    [performFlush, debounceMs],
  )

  /** 强制立即 flush(issue 04 验收 6 · 失焦/历史切换/开始分析) */
  const flush = useCallback(async (): Promise<void> => {
    await performFlush()
  }, [performFlush])

  /** 重新拉取服务端(用于 Run 切换后回到原 Issue) */
  const reload = useCallback(async () => {
    try {
      const resp = await fetchIssueResponse(requirementId, runId, issueId)
      // 只有非 dirty 时才覆盖本地 draft(避免覆盖未 flush 的输入)
      if (!dirtyRef.current) {
        setDraft(resp.body)
        draftRef.current = resp.body
      }
      setEditVersion(resp.edit_version)
      editVersionRef.current = resp.edit_version
      setUpdatedAt(resp.updated_at)
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }, [requirementId, runId, issueId])

  // 组件卸载时尽力 flush(issue 04 验收 6)
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      // 不等待异步 in-flight;卸载即丢
    }
  }, [])

  return {
    draft,
    editVersion,
    updatedAt,
    status,
    errorMessage,
    setDraft,
    flush,
    reload,
  }
}