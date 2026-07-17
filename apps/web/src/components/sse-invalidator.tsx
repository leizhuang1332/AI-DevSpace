'use client'

/**
 * SSE 订阅器(ticket 07b 决策 ❶ + A)—— 订阅全局需求事件,
 * 收到 `requirement_created` 时调 router.refresh() 让 RSC 重拉。
 *
 * 实现要点:
 * - 走相对路径 /api/agent/events/requirements(Next.js dev proxy 模式,
 *   与 analyzing-zone / useExecutingSse 一致 —— 跨端口 cookie 边界由
 *   API Route 处理)
 * - 只监听 `requirement_created` 命名事件(其他事件 P1+ 加监听)
 * - 错误自动重连由 EventSource 浏览器原生处理
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function SSEInvalidator() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return

    const es = new EventSource('/api/agent/events/requirements')

    const onRequirementCreated = (): void => {
      router.refresh()
    }

    es.addEventListener('requirement_created', onRequirementCreated)
    // error 事件浏览器自动重连 —— 此处无需手动处理
    es.addEventListener('error', () => {
      /* browser auto-reconnect */
    })

    return () => {
      es.removeEventListener('requirement_created', onRequirementCreated)
      es.close()
    }
  }, [router])

  return null
}