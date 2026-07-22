/**
 * useMediaQuery — SSR-safe 媒体查询 hook
 *   (ticket 05 · ADR-0017 窄视口 UX)
 *
 * 行为:
 * - SSR 阶段返回 `false`(无 window);首屏渲染总是"非窄视口"形态 → 与桌面 SSR 一致
 * - 客户端 mount 后读 `mql.matches` 同步初始值 → 避免 hydration mismatch
 * - 订阅 `change` 事件:真实浏览器断点变化时 sync state
 * - 卸载清 listener
 *
 * 用法:
 *   const isDesktop = useMediaQuery('(min-width: 1024px)')
 *   isDesktop ? <DesktopLayout /> : <MobileLayout />
 *
 * 测试:
 * - jsdom 不实现 matchMedia;本仓库 vitest setup 在 `apps/web/vitest.setup.ts`
 *   全局桩 `window.matchMedia`,并暴露 `globalThis.setMatchMedia(query, value)`
 *   让测试控制当前匹配状态(直接覆写 `mql.matches` 的初始值;不影响后续 change)。
 * - 测试用例:见 `apps/web/src/lib/__tests__/use-media-query.test.tsx`
 */

'use client'

import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(query)
    // 同步初始值(mount 时)
    setMatches(mql.matches)
    const handler = (e: MediaQueryListEvent): void => {
      setMatches(e.matches)
    }
    // 现代浏览器(MDN):addEventListener('change');旧版(Safari < 14):
    // addListener(legacy handler).jsdom + 测试桩兼容两者。
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mql as any
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(handler)
      return () => legacy.removeListener(handler)
    }
    return
  }, [query])

  return matches
}
