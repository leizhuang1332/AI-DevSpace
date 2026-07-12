'use client'

import { useEffect, useState } from 'react'
import { useZone } from '@/lib/use-zone'
import {
  getZoneAIStatus,
  getRequirementAIStatus,
  ambientAIStatus,
  type AIStatusLine,
} from '@/lib/zone-ai-status'
import { ThinkBar } from './think-bar'

/**
 * ThinkBarSlot — Shell 层 1 bottom-fixed slot 容器(issue 16 · ADR-0012 §3)。
 *
 * 行为合约:
 * - kind='zone'     → mode 来自 zone.thinking_bar + 同步 zone 状态
 * - kind='overview' → mode='required' + 异步需求级 AI 状态
 * - kind='none'     → mode='required' + ambient(AI 始终在场,决策 24)
 *
 * 设计:
 * - 'use client' 是因为 useZone 依赖 usePathname(client-only hook)
 * - useEffect + useState 而非 useQuery:
 *   本期数据是 mock,无需 cache/staleTime/网络层;
 *   接 agent API 时此 hook 可换成 useQuery(staleTime/refetch),
 *   ThinkBar 接收的 status 接口不变。
 * - sticky 定位 + z-index 由 slot 容器提供;
 *   ThinkBar 内部只负责 mode/status 的视觉渲染
 */

const FALLBACK_REQUIREMENT: AIStatusLine = {
  title: 'AI 累计工作 · 加载中',
  sub: '· 等待数据',
}

export function ThinkBarSlot() {
  const loc = useZone()
  const [requirementStatus, setRequirementStatus] =
    useState<AIStatusLine>(FALLBACK_REQUIREMENT)

  useEffect(() => {
    if (loc.kind !== 'overview') return
    let cancelled = false
    getRequirementAIStatus(loc.id).then((s) => {
      if (!cancelled) setRequirementStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [loc.kind === 'overview' ? loc.id : null])

  // ─── zone 路由:mode 来自 zone.thinking_bar + 同步 zone 状态 ───
  if (loc.kind === 'zone') {
    return (
      <ThinkBarSlotFrame
        mode={loc.zone.thinking_bar}
        status={getZoneAIStatus(loc.zone.route_segment)}
        dataZoneId={loc.zone.id}
        dataSource="zone"
        fadeKey={`zone:${loc.zone.id}`}
      />
    )
  }

  // ─── Overview 路由:mode 强制 'required' + 异步需求级状态 ───
  if (loc.kind === 'overview') {
    return (
      <ThinkBarSlotFrame
        mode="required"
        status={requirementStatus}
        dataRequirementId={loc.id}
        dataSource="requirement"
        fadeKey={`req:${loc.id}`}
      />
    )
  }

  // ─── 其他路由:mode='required' + ambient(决策 24 "AI 始终在场") ───
  return (
    <ThinkBarSlotFrame
      mode="required"
      status={ambientAIStatus()}
      dataSource="ambient"
      fadeKey="ambient"
    />
  )
}

// ---------------------------------------------------------------------------
// 内部 frame wrapper —— 提供 sticky bottom 定位 + data-* 元数据(e2e 用)
// ---------------------------------------------------------------------------

interface ThinkBarSlotFrameProps {
  mode: 'required' | 'minimal' | 'hidden'
  status: AIStatusLine
  dataZoneId?: string
  dataRequirementId?: string
  dataSource: 'zone' | 'requirement' | 'ambient'
  /** 切换 zone/overview/ambient 时改变 → 触发 fade-in 过渡(issue 16 验收 #4) */
  fadeKey: string
}

function ThinkBarSlotFrame({
  mode,
  status,
  dataZoneId,
  dataRequirementId,
  dataSource,
  fadeKey,
}: ThinkBarSlotFrameProps) {
  return (
    <div
      data-testid="think-bar-slot"
      data-mode={mode}
      data-zone-id={dataZoneId}
      data-requirement-id={dataRequirementId}
      data-source={dataSource}
      className="sticky bottom-0 z-20"
    >
      <ThinkBar mode={mode} status={status} fadeKey={fadeKey} />
    </div>
  )
}
