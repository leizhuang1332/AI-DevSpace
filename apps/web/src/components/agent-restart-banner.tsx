'use client'

/**
 * AgentRestartBanner (ADR-0037 D4)
 *
 * 全局监听 agent SSE 通道(`/api/agent/events/requirements`,
 * 内部走 SseHub.publishAll 广播),过滤两种事件:
 *
 * - `agent-restarting` —— 由 POST /api/agent/restart 在 agent 退出前 publishAll 广播。
 *   看到此事件 → 状态切到 `restarting`,顶部固定 toast「🔄 Agent 正在重启...」。
 * - `open`(EventSource 原生) —— SSE 连接 (重)连成功,这是「agent 已恢复」的最
 *   强信号(EventSource 自动重连机制会在 agent 退出 → 重启 后触发)。
 *   看到 open 且当前状态是 `restarting` → 切到 `recovered`,toast 变
 *   「✓ Agent 已恢复」,3 秒后淡出回 idle。
 *
 * 三态机:`idle` → `restarting` → `recovered` → `idle`。**默认不渲染任何
 * DOM**(idle 时返回 null),不占布局空间,不影响其他 shell 组件。
 */

import { useEffect, useState } from 'react'

type BannerState = 'idle' | 'restarting' | 'recovered'

const RECOVERED_FADE_MS = 3000

export function AgentRestartBanner() {
  const [state, setState] = useState<BannerState>('idle')
  const [reason, setReason] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    const es = new EventSource('/api/agent/events/requirements')

    const onRestarting = (e: Event): void => {
      const ev = e as MessageEvent
      let parsed: { reason?: string } | null = null
      try {
        parsed = JSON.parse(ev.data)
      } catch {
        parsed = null
      }
      setReason(parsed?.reason ?? 'manual-restart')
      setState('restarting')
    }

    // EventSource 自带重连机制 —— 'open' 事件在每次 (重)连成功后触发。
    // agent 退出 → SSE 断开 → agent 拉起 → 自动重连 → 'open' 触发 →
    // 我们据此切到 'recovered'。
    const onOpen = (): void => {
      setState((prev) => {
        if (prev === 'restarting') {
          // 安排 3 秒后回到 idle(让「✓ 已恢复」可见)
          setTimeout(() => {
            setState((cur) => (cur === 'recovered' ? 'idle' : cur))
          }, RECOVERED_FADE_MS)
          return 'recovered'
        }
        return prev
      })
    }

    es.addEventListener('agent-restarting', onRestarting)
    es.addEventListener('open', onOpen)

    return () => {
      es.removeEventListener('agent-restarting', onRestarting)
      es.removeEventListener('open', onOpen)
      es.close()
    }
  }, [])

  if (state === 'idle') return null

  return (
    <div
      data-testid="agent-restart-banner"
      data-state={state}
      className={`fixed top-0 left-0 right-0 z-[100] px-4 py-2 text-center text-sm font-medium shadow-md ${
        state === 'restarting'
          ? 'bg-yellow-100 text-yellow-900 border-b border-yellow-300'
          : 'bg-green-100 text-green-900 border-b border-green-300'
      }`}
    >
      {state === 'restarting' ? (
        <>
          🔄 Agent 正在重启…
          {reason && (
            <span className="ml-2 text-xs opacity-75">({reason})</span>
          )}
        </>
      ) : (
        <>✓ Agent 已恢复</>
      )}
    </div>
  )
}