import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { DraftingSkeleton } from '../drafting-skeleton'

// ============================================================================
// Fixture
// ============================================================================

afterEach(() => cleanup())

// ============================================================================
// 渲染(issue 01 ticket 验收 #1 · 决策 30)
// ============================================================================

describe('DraftingSkeleton · 渲染', () => {
  it('默认 hint = "正在创建需求…"', () => {
    render(<DraftingSkeleton />)
    expect(screen.getByTestId('drafting-skeleton-hint').textContent).toBe(
      '正在创建需求…',
    )
  })

  it('可定制 hint', () => {
    render(<DraftingSkeleton hint="正在加载草稿…" />)
    expect(screen.getByTestId('drafting-skeleton-hint').textContent).toBe(
      '正在加载草稿…',
    )
  })

  it('3 行 shimmer 占位(标题行 + 2 行内容行)', () => {
    render(<DraftingSkeleton />)
    expect(screen.getByTestId('drafting-skeleton-line-title')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-skeleton-line-1')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-skeleton-line-2')).toBeInTheDocument()
  })

  it('role=status + aria-live=polite(屏幕阅读器友好)', () => {
    render(<DraftingSkeleton />)
    const root = screen.getByTestId('drafting-skeleton')
    expect(root.getAttribute('role')).toBe('status')
    expect(root.getAttribute('aria-live')).toBe('polite')
  })

  it('aria-label 反映 hint 文案', () => {
    render(<DraftingSkeleton hint="请稍候" />)
    expect(screen.getByTestId('drafting-skeleton').getAttribute('aria-label')).toBe(
      '请稍候',
    )
  })
})