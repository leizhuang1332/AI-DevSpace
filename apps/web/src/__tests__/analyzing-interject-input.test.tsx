import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { InterjectInput } from '@/components/interject-input'

afterEach(() => {
  cleanup()
})

// ============================================================================
// 基础渲染(issue 19b 验收:输入框 + [提交] 按钮)
// ============================================================================

describe('InterjectInput · 渲染', () => {
  it('根节点 + textarea + submit button 渲染', () => {
    render(<InterjectInput onSubmit={vi.fn()} />)
    expect(screen.getByTestId('interject-input')).toBeInTheDocument()
    expect(screen.getByTestId('interject-textarea')).toBeInTheDocument()
    expect(screen.getByTestId('interject-submit-btn')).toBeInTheDocument()
  })

  it('textarea 默认空,placeholder 含"补充"提示', () => {
    render(<InterjectInput onSubmit={vi.fn()} />)
    const ta = screen.getByTestId('interject-textarea') as HTMLTextAreaElement
    expect(ta.value).toBe('')
    expect(ta.placeholder).toContain('补充上下文')
  })

  it('初始提交按钮 disabled(text 为空)', () => {
    render(<InterjectInput onSubmit={vi.fn()} />)
    const btn = screen.getByTestId('interject-submit-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('字符计数同步 text 长度', () => {
    render(<InterjectInput onSubmit={vi.fn()} />)
    const ta = screen.getByTestId('interject-textarea')
    fireEvent.change(ta, { target: { value: 'hello' } })
    expect(screen.getByTestId('interject-char-count').textContent).toBe('5')
  })

  it('props.placeholder 可被覆盖', () => {
    render(<InterjectInput onSubmit={vi.fn()} placeholder="自定义提示" />)
    expect(screen.getByTestId('interject-textarea').getAttribute('placeholder')).toBe('自定义提示')
  })
})

// ============================================================================
// 输入与禁用
// ============================================================================

describe('InterjectInput · 输入与禁用', () => {
  it('text 为空 / 仅空白 → 按钮 disabled', () => {
    render(<InterjectInput onSubmit={vi.fn()} />)
    const ta = screen.getByTestId('interject-textarea')
    const btn = screen.getByTestId('interject-submit-btn') as HTMLButtonElement

    fireEvent.change(ta, { target: { value: '   ' } })
    expect(btn.disabled).toBe(true)

    fireEvent.change(ta, { target: { value: '\n\t' } })
    expect(btn.disabled).toBe(true)

    fireEvent.change(ta, { target: { value: 'real text' } })
    expect(btn.disabled).toBe(false)
  })

  it('isSubmitting=true → 按钮 disabled,文案变"提交中"', () => {
    render(<InterjectInput onSubmit={vi.fn()} isSubmitting={true} />)
    const ta = screen.getByTestId('interject-textarea')
    fireEvent.change(ta, { target: { value: 'text' } })
    const btn = screen.getByTestId('interject-submit-btn') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.textContent).toContain('提交中')
  })

  it('isSubmitting=true → textarea 也 disabled', () => {
    render(<InterjectInput onSubmit={vi.fn()} isSubmitting={true} />)
    expect((screen.getByTestId('interject-textarea') as HTMLTextAreaElement).disabled).toBe(true)
  })

  it('根 data-submitting 与 props.isSubmitting 同步', () => {
    const { rerender } = render(<InterjectInput onSubmit={vi.fn()} />)
    expect(screen.getByTestId('interject-input').getAttribute('data-submitting')).toBe('false')

    rerender(<InterjectInput onSubmit={vi.fn()} isSubmitting={true} />)
    expect(screen.getByTestId('interject-input').getAttribute('data-submitting')).toBe('true')
  })
})

// ============================================================================
// 提交逻辑(issue 19b 验收 #8:输入 + 提交 → 触发 onSubmit + 清空输入框)
// ============================================================================

describe('InterjectInput · 提交', () => {
  it('点击 [提交] → onSubmit(text),输入框清空', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} />)
    const ta = screen.getByTestId('interject-textarea')

    fireEvent.change(ta, { target: { value: '退款限额的合规边界?' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit).toHaveBeenCalledWith('退款限额的合规边界?')
    expect((ta as HTMLTextAreaElement).value).toBe('')
  })

  it('提交时 trim 输入文本', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} />)
    const ta = screen.getByTestId('interject-textarea')

    fireEvent.change(ta, { target: { value: '  hello world  ' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))

    expect(onSubmit).toHaveBeenCalledWith('hello world')
  })

  it('Enter(不带 Shift)→ 提交;Shift+Enter → 换行不提交', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} />)
    const ta = screen.getByTestId('interject-textarea')

    fireEvent.change(ta, { target: { value: 'first line' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()
    // shift+enter 后 text 还在(由 textarea 自己处理换行)
    expect((ta as HTMLTextAreaElement).value).toBe('first line')

    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledWith('first line')
  })

  it('空文本时点击 [提交] 不触发 onSubmit', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} />)
    fireEvent.click(screen.getByTestId('interject-submit-btn'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('isSubmitting=true 时点击 [提交] 不触发 onSubmit', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} isSubmitting={true} />)
    const ta = screen.getByTestId('interject-textarea')
    fireEvent.change(ta, { target: { value: 'text' } })
    // 按钮被 disabled,fireEvent.click 在 jsdom 下不会触发 onClick on disabled button
    fireEvent.click(screen.getByTestId('interject-submit-btn'))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

// ============================================================================
// SSE listener 触发链(issue 19b 验收 #8:输入 + 提交 → 触发 SSE listener → 新 chunk 入打字机)
//   这里是上层集成测试的入口:InterjectInput 的 onSubmit 与 AnalyzingZone 的 SSE 订阅解耦,
//   验证 onSubmit 回调能被正确触发即可(实际 SSE 行为在 AnalyzingZone 集成测试中验证)。
// ============================================================================

describe('InterjectInput · 与父组件 SSE 集成契约', () => {
  it('提交后 onSubmit 被调用,且输入框清空,便于父组件立刻发请求 + 收 SSE chunk', () => {
    // 模拟父组件行为:onSubmit 内部记录被调,然后检查 text 已清空即可触发 POST
    const submitted: string[] = []
    render(
      <InterjectInput
        onSubmit={(t) => {
          submitted.push(t)
          // 父组件发起 POST /analysis/interject → SSE 推 chunk → useEffect append
        }}
      />,
    )
    const ta = screen.getByTestId('interject-textarea')
    fireEvent.change(ta, { target: { value: '补充:退款限额的合规边界' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))

    expect(submitted).toEqual(['补充:退款限额的合规边界'])
    expect((ta as HTMLTextAreaElement).value).toBe('')
  })

  it('连续多次提交 → 每次 onSubmit 都触发(text 立即清空)', () => {
    const onSubmit = vi.fn()
    render(<InterjectInput onSubmit={onSubmit} />)
    const ta = screen.getByTestId('interject-textarea')

    fireEvent.change(ta, { target: { value: 'first' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))
    fireEvent.change(ta, { target: { value: 'second' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))
    fireEvent.change(ta, { target: { value: 'third' } })
    fireEvent.click(screen.getByTestId('interject-submit-btn'))

    expect(onSubmit).toHaveBeenCalledTimes(3)
    expect(onSubmit.mock.calls[0][0]).toBe('first')
    expect(onSubmit.mock.calls[1][0]).toBe('second')
    expect(onSubmit.mock.calls[2][0]).toBe('third')
  })
})
