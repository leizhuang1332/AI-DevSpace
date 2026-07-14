import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Toast, type ToastItem } from '../toast'

describe('Toast', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('renders message and tone class', () => {
    const item: ToastItem = { id: '1', message: 'hello', tone: 'warn', durationMs: 3000 }
    render(<Toast item={item} onDismiss={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByTestId('toast-1')).toHaveAttribute('data-tone', 'warn')
  })

  it('calls onDismiss after durationMs', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'hi', tone: 'info', durationMs: 3000 }
    render(<Toast item={item} onDismiss={onDismiss} />)
    vi.advanceTimersByTime(3000)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('does not auto-dismiss when durationMs is null', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'sticky', tone: 'err', durationMs: null }
    render(<Toast item={item} onDismiss={onDismiss} />)
    vi.advanceTimersByTime(60_000)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('clicking close button calls onDismiss immediately', () => {
    const onDismiss = vi.fn()
    const item: ToastItem = { id: '1', message: 'hi', tone: 'info', durationMs: 5000 }
    render(<Toast item={item} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('关闭通知'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
