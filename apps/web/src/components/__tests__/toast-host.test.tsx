import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToastHost } from '../toast-host'
import type { ToastItem } from '../toast'

describe('ToastHost', () => {
  it('renders all items stacked', () => {
    const items: ToastItem[] = [
      { id: '1', message: 'first', tone: 'info', durationMs: 3000 },
      { id: '2', message: 'second', tone: 'warn', durationMs: 3000 },
    ]
    render(<ToastHost items={items} onDismiss={() => {}} />)
    expect(screen.getByTestId('toast-1')).toBeInTheDocument()
    expect(screen.getByTestId('toast-2')).toBeInTheDocument()
  })

  it('calls onDismiss with id when child toast dismissed', () => {
    const onDismiss = vi.fn()
    const items: ToastItem[] = [{ id: 'x', message: 'm', tone: 'info', durationMs: 3000 }]
    render(<ToastHost items={items} onDismiss={onDismiss} />)
    screen.getByLabelText('关闭通知').click()
    expect(onDismiss).toHaveBeenCalledWith('x')
  })

  it('renders empty container when no items', () => {
    const { container } = render(<ToastHost items={[]} onDismiss={() => {}} />)
    expect(container.querySelector('[data-testid="toast-host"]')).toBeInTheDocument()
  })
})
