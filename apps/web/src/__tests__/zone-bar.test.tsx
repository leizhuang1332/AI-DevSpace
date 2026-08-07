import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

// Mock next/navigation 以提供受控的 pathname
let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Mock next/link 以避免 next 内部 router 上下文
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { ZoneBar } from '@/components/zone-bar'

beforeEach(() => {
  mockPathname = '/'
})

afterEach(() => cleanup())

describe('ZoneBar', () => {
  describe('路由匹配', () => {
    it('在 /requirements/REF-001/drafting/ 渲染 ZoneBar', () => {
      mockPathname = '/requirements/REF-001/drafting'
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-bar')).toBeInTheDocument()
    })

    it('在 /requirements/REF-001/drafting(无尾 /)也渲染', () => {
      mockPathname = '/requirements/REF-001/drafting'
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-bar')).toBeInTheDocument()
    })

    it('在 /requirements/REF-001/board/ 渲染(board section)', () => {
      mockPathname = '/requirements/REF-001/board'
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-bar')).toBeInTheDocument()
      expect(screen.getByTestId('zone-bar').getAttribute('data-active-zone')).toBe('board')
    })

    it('在 /requirements/ 不渲染', () => {
      mockPathname = '/requirements/REF-001'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })

    it('在 /requirements 不渲染', () => {
      mockPathname = '/requirements'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })

    it('在 /settings 等无关路由不渲染', () => {
      mockPathname = '/settings'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })

    it('在根路由不渲染', () => {
      mockPathname = '/'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })

    it('退役 zone segment 不渲染(clarifying/designing/executing 不再合法)', () => {
      mockPathname = '/requirements/REF-001/clarifying'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })

    it('未知 zone segment 不渲染', () => {
      mockPathname = '/requirements/REF-001/unknown-zone'
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-bar')).toBeNull()
    })
  })

  describe('Tab 渲染(ADR-0026 D4:4 section + 1 Overview)', () => {
    beforeEach(() => {
      mockPathname = '/requirements/REF-001/drafting'
    })

    it('渲染 1 个 Overview Tab + 4 个 section Tab', () => {
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-tab-overview')).toBeInTheDocument()
      expect(screen.getByTestId('zone-tab-drafting')).toBeInTheDocument()
      expect(screen.getByTestId('zone-tab-board')).toBeInTheDocument()
      expect(screen.getByTestId('zone-tab-analyzing')).toBeInTheDocument()
      expect(screen.getByTestId('zone-tab-wrapup')).toBeInTheDocument()
    })

    it('退役 section Tab 不再渲染(clarifying/designing/executing)', () => {
      render(<ZoneBar />)
      expect(screen.queryByTestId('zone-tab-clarifying')).toBeNull()
      expect(screen.queryByTestId('zone-tab-designing')).toBeNull()
      expect(screen.queryByTestId('zone-tab-executing')).toBeNull()
    })

    it('Tab 顺序:Overview → DRAFTING → ANALYZING → BOARD → WRAP-UP', () => {
      const { container } = render(<ZoneBar />)
      const links = container.querySelectorAll('[data-testid^="zone-tab-"]')
      const order = Array.from(links).map((el) =>
        el.getAttribute('data-testid')!.replace('zone-tab-', ''),
      )
      expect(order).toEqual([
        'overview',
        'drafting',
        'analyzing',
        'board',
        'wrapup',
      ])
    })

    it('Tab href 指向正确的 section URL', () => {
      render(<ZoneBar />)
      const draftingTab = screen.getByTestId('zone-tab-drafting')
      expect(draftingTab.getAttribute('href')).toBe('/requirements/REF-001/drafting/')

      const boardTab = screen.getByTestId('zone-tab-board')
      expect(boardTab.getAttribute('href')).toBe('/requirements/REF-001/board/')

      const wrapupTab = screen.getByTestId('zone-tab-wrapup')
      expect(wrapupTab.getAttribute('href')).toBe('/requirements/REF-001/wrap-up/')

      const overviewTab = screen.getByTestId('zone-tab-overview')
      expect(overviewTab.getAttribute('href')).toBe('/requirements/REF-001/')
    })
  })

  describe('激活态', () => {
    it('当前 section 的 data-active=true', () => {
      mockPathname = '/requirements/REF-001/board'
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-bar').getAttribute('data-active-zone')).toBe('board')
      expect(screen.getByTestId('zone-tab-board').getAttribute('data-active')).toBe('true')
      expect(screen.getByTestId('zone-tab-drafting').getAttribute('data-active')).toBe('false')
    })

    it('激活态随路由变化(analyzing)', () => {
      mockPathname = '/requirements/REF-001/analyzing'
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-tab-analyzing').getAttribute('data-active')).toBe('true')
    })

    it('激活态应用 ADR §6 视觉规格(brand-600 + 下划线 + 加粗)', () => {
      mockPathname = '/requirements/REF-001/drafting'
      render(<ZoneBar />)
      const active = screen.getByTestId('zone-tab-drafting')
      expect(active.className).toContain('text-brand-600')
      expect(active.className).toContain('font-semibold')
      expect(active.className).toContain('border-b-2')
      expect(active.className).toContain('border-brand-600')
      // 非激活态不应有这些 class
      const inactive = screen.getByTestId('zone-tab-analyzing')
      expect(inactive.className).not.toContain('text-brand-600')
      expect(inactive.className).not.toContain('border-b-2')
    })
  })

  describe('状态色点(ADR-0026 D2 + 决策 22)', () => {
    beforeEach(() => {
      mockPathname = '/requirements/REF-001/drafting'
    })

    it('每个 section Tab 含一个状态色点', () => {
      render(<ZoneBar />)
      expect(screen.getByTestId('zone-status-drafting').getAttribute('data-status-color')).toBe('gray')
      expect(screen.getByTestId('zone-status-board').getAttribute('data-status-color')).toBe('blue')
      expect(screen.getByTestId('zone-status-analyzing').getAttribute('data-status-color')).toBe('purple-warn')
      expect(screen.getByTestId('zone-status-wrapup').getAttribute('data-status-color')).toBe('gray')
    })

    it('ANALYZING 状态色点含 ring(警示红圈,原 CLARIFYING 迁移至 analyzing,ADR-0026)', () => {
      render(<ZoneBar />)
      const dot = screen.getByTestId('zone-status-analyzing')
      expect(dot.className).toMatch(/ring-/)
    })

    it('ANALYZING 状态色点含 animate-pulse(ADR §6 决策 49)', () => {
      render(<ZoneBar />)
      const dot = screen.getByTestId('zone-status-analyzing')
      expect(dot.className).toContain('animate-pulse')
    })

    it('非脉动 section 的状态色点不含 animate-pulse', () => {
      render(<ZoneBar />)
      for (const id of ['drafting', 'board', 'wrapup']) {
        const dot = screen.getByTestId(`zone-status-${id}`)
        expect(dot.className).not.toContain('animate-pulse')
      }
    })
  })
})
