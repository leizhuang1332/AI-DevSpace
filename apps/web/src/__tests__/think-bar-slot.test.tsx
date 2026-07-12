import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

// Mock next/navigation 控制 pathname
let mockPathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import { ThinkBarSlot } from '@/components/think-bar-slot'

beforeEach(() => {
  mockPathname = '/'
})
afterEach(() => cleanup())

/**
 * ThinkBarSlot 集成测试(issue 16 · ADR-0012 §3):
 *
 * - 6 工位路由 → mode 来自 zone.thinking_bar
 *   - drafting/analyzing/clarifying/designing/executing → required
 *   - wrap-up → minimal
 * - Overview 路由 → required + 需求级 AI 状态
 * - 需求列表 / settings / 根 → ambient 状态
 *
 * 关键验收点(issue 16):
 * - 所有工位路由底部都有 ThinkBar
 * - WRAP-UP 工位 ThinkBar 显示 minimal 模式(无按钮)
 * - Overview 显示需求级 AI 状态
 */

const ZONE_ROUTES: { seg: string; expectedMode: 'required' | 'minimal' }[] = [
  { seg: 'drafting', expectedMode: 'required' },
  { seg: 'analyzing', expectedMode: 'required' },
  { seg: 'clarifying', expectedMode: 'required' },
  { seg: 'designing', expectedMode: 'required' },
  { seg: 'executing', expectedMode: 'required' },
  { seg: 'wrap-up', expectedMode: 'minimal' },
]

describe('ThinkBarSlot · 6 工位路由', () => {
  for (const { seg, expectedMode } of ZONE_ROUTES) {
    it(`/requirements/REF-001/${seg}/ → mode=${expectedMode}`, () => {
      mockPathname = `/requirements/REF-001/${seg}/`
      render(<ThinkBarSlot />)
      const slot = screen.getByTestId('think-bar-slot')
      expect(slot).toBeInTheDocument()
      expect(slot.getAttribute('data-mode')).toBe(expectedMode)
      expect(slot.getAttribute('data-zone-id')).toBeTruthy()
      expect(slot.getAttribute('data-source')).toBe('zone')
      // mode=required 有按钮;minimal 没有
      const hasPause = !!screen.queryByTestId('think-bar-btn-pause')
      expect(hasPause).toBe(expectedMode === 'required')
    })
  }

  it('WRAP-UP 工位 ThinkBar 渲染 minimal(无按钮)— 验收 #3', () => {
    mockPathname = '/requirements/REF-001/wrap-up/'
    render(<ThinkBarSlot />)
    expect(screen.getByTestId('think-bar-slot').getAttribute('data-mode')).toBe(
      'minimal',
    )
    expect(screen.queryByTestId('think-bar-btn-pause')).toBeNull()
    expect(screen.queryByTestId('think-bar-btn-detail')).toBeNull()
  })

  it('EXECUTING 工位 ThinkBar 内容包含任务标识(T-NN)', () => {
    mockPathname = '/requirements/REF-001/executing/'
    render(<ThinkBarSlot />)
    const title = screen.getByTestId('think-bar-title')
    expect(title.textContent).toMatch(/T-\d+/)
  })
})

describe('ThinkBarSlot · Overview 路由', () => {
  it('/requirements/REF-001/ 渲染 ThinkBarSlot + mode=required + data-source=requirement', async () => {
    mockPathname = '/requirements/REF-001/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot).toBeInTheDocument()
    expect(slot.getAttribute('data-mode')).toBe('required')
    expect(slot.getAttribute('data-source')).toBe('requirement')
    expect(slot.getAttribute('data-requirement-id')).toBe('REF-001')
    // 等待 useEffect + Promise setState settle(消除 act 警告)
    await waitFor(() => {
      expect(screen.getByTestId('think-bar-title')).toBeInTheDocument()
    })
  })

  it('Overview 异步加载需求级 AI 状态(useEffect 触发)', async () => {
    mockPathname = '/requirements/REF-001/'
    render(<ThinkBarSlot />)
    // waitFor: useEffect + Promise.then 完成后,think-bar-title 应该被更新的 status 覆盖
    await waitFor(() => {
      const title = screen.getByTestId('think-bar-title')
      // req-001 mock 中 totalActiveMinutes=83 → "1h 23min"
      expect(title.textContent).toMatch(/累计|工作/)
    })
  })
})

describe('ThinkBarSlot · 列表 / Dashboard / 其他路由', () => {
  it('/requirements/ 列表页渲染 ambient(默认 required)', () => {
    mockPathname = '/requirements/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot.getAttribute('data-mode')).toBe('required')
    expect(slot.getAttribute('data-source')).toBe('ambient')
  })

  it('/settings/ 渲染 ambient', () => {
    mockPathname = '/settings/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot.getAttribute('data-source')).toBe('ambient')
  })

  it('/knowledge/ 渲染 ambient', () => {
    mockPathname = '/knowledge/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot.getAttribute('data-source')).toBe('ambient')
  })

  it('/ 根路由渲染 ambient', () => {
    mockPathname = '/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot.getAttribute('data-source')).toBe('ambient')
  })
})

describe('ThinkBarSlot · 未知 zone segment', () => {
  it('未知 zone([zone]/layout 已 notFound,这里兜底仍渲染 ambient)', () => {
    mockPathname = '/requirements/REF-001/unknown-zone/'
    render(<ThinkBarSlot />)
    const slot = screen.getByTestId('think-bar-slot')
    expect(slot.getAttribute('data-source')).toBe('ambient')
  })
})
