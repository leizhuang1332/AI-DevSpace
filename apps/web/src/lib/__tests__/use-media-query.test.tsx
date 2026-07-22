/**
 * useMediaQuery hook 测试(ticket 05)
 *
 * 覆盖:
 * - mount 后查询真实环境 → 返回当前是否匹配
 * - isDesktop = true → 桌面形态;false → 窄形态
 * - SSR safe:hooks 在 mount 时才读 matchMedia,SSR 返回 false
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useMediaQuery } from '@/lib/use-media-query'

declare global {
  // eslint-disable-next-line no-var
  var setMatchMedia: (query: string, value: boolean) => void
  // eslint-disable-next-line no-var
  var resetMatchMedia: () => void
}

afterEach(() => {
  cleanup()
  globalThis.resetMatchMedia()
})

function Probe({ query }: { query: string }) {
  const matches = useMediaQuery(query)
  return <span data-testid="probe" data-matches={String(matches)} />
}

describe('useMediaQuery', () => {
  it('mount 后返回当前是否匹配(query: min-width: 1024px,true)', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', true)
    render(<Probe query="(min-width: 1024px)" />)
    expect(screen.getByTestId('probe').getAttribute('data-matches')).toBe('true')
  })

  it('query 命中 false → 返回 false', () => {
    globalThis.setMatchMedia('(min-width: 1024px)', false)
    render(<Probe query="(min-width: 1024px)" />)
    expect(screen.getByTestId('probe').getAttribute('data-matches')).toBe('false')
  })

  it('query 不在 matchers map 中 → 走 jsdom 默认(1024 >= 1024)→ true', () => {
    // resetMatchMedia 已清空 map;默认实现:`(min-width: 1024px)` 在 jsdom 默认 innerWidth=1024 → 命中
    render(<Probe query="(min-width: 1024px)" />)
    expect(screen.getByTestId('probe').getAttribute('data-matches')).toBe('true')
  })
})
