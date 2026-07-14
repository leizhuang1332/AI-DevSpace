import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyAuxPlaceholder } from '../empty-aux-placeholder'

describe('EmptyAuxPlaceholder · 渲染(issue 04 验收 #7)', () => {
  it('testid = aux-empty-placeholder', () => {
    render(<EmptyAuxPlaceholder />)
    expect(screen.getByTestId('aux-empty-placeholder')).toBeInTheDocument()
  })

  it('label "新建/上传" 存在', () => {
    render(<EmptyAuxPlaceholder />)
    expect(screen.getByTestId('aux-empty-placeholder-label')).toHaveTextContent(
      '新建/上传',
    )
  })

  it('aria-label 描述占位语义', () => {
    render(<EmptyAuxPlaceholder onCreate={() => {}} />)
    expect(
      screen.getByTestId('aux-empty-placeholder').getAttribute('aria-label'),
    ).toContain('新建或上传辅助文件')
  })
})

describe('EmptyAuxPlaceholder · 交互', () => {
  it('点击 → 调用 onCreate', async () => {
    const onCreate = vi.fn()
    render(<EmptyAuxPlaceholder onCreate={onCreate} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-empty-placeholder'))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('键盘 Enter → 调用 onCreate', async () => {
    const onCreate = vi.fn()
    render(<EmptyAuxPlaceholder onCreate={onCreate} />)
    const user = userEvent.setup()
    const el = screen.getByTestId('aux-empty-placeholder')
    el.focus()
    await user.keyboard('{Enter}')
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('键盘 Space → 调用 onCreate', async () => {
    const onCreate = vi.fn()
    render(<EmptyAuxPlaceholder onCreate={onCreate} />)
    const user = userEvent.setup()
    const el = screen.getByTestId('aux-empty-placeholder')
    el.focus()
    await user.keyboard(' ')
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('不传 onCreate → 不可交互(role/tabindex 退化)', () => {
    render(<EmptyAuxPlaceholder />)
    const el = screen.getByTestId('aux-empty-placeholder')
    expect(el.getAttribute('role')).toBeNull()
    expect(el.getAttribute('tabindex')).toBe('-1')
  })
})