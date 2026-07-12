import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ThinkBar } from '@/components/think-bar'

afterEach(() => cleanup())

/**
 * ThinkBar 组件单元测试(issue 16 · ADR-0012 §3)。
 *
 * 模式约定(registry `thinking_bar` 字段,3 档):
 * - required: 脉冲点 + 1 行文本 + 右侧按钮组(查看详情 / 暂停)
 * - minimal:  状态点 + 1 行短文本(无按钮)
 * - hidden:   返回 null,不渲染
 *
 * 状态约定:
 * - status: { title, sub }
 * - title: 主文案(如 "AI 正在执行 T-05")
 * - sub:   meta 信息(时间戳 / 候命 / 待回答 等)
 */

const sampleStatus = {
  title: 'AI 正在执行 T-05',
  sub: '· 12:08:41 · 候命 5 · 待回答 2',
}

describe('ThinkBar · mode=required', () => {
  it('渲染外层 [data-testid=think-bar]', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    expect(screen.getByTestId('think-bar')).toBeInTheDocument()
  })

  it('外层 data-mode=required + data-hidden≠"true"', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    const el = screen.getByTestId('think-bar')
    expect(el.getAttribute('data-mode')).toBe('required')
    expect(el.getAttribute('data-hidden')).not.toBe('true')
  })

  it('渲染主文案 title(strong/highlight)', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    expect(screen.getByTestId('think-bar-title')).toHaveTextContent('AI 正在执行 T-05')
  })

  it('渲染副文案 sub', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    expect(screen.getByTestId('think-bar-sub')).toHaveTextContent(
      '· 12:08:41 · 候命 5 · 待回答 2',
    )
  })

  it('渲染脉冲点(pulse wrap 圆形容器)', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    expect(screen.getByTestId('think-bar-pulse')).toBeInTheDocument()
  })

  it('渲染右侧按钮组(查看详情 + 暂停)— 2 个按钮', () => {
    render(<ThinkBar mode="required" status={sampleStatus} />)
    expect(screen.getByTestId('think-bar-btn-detail')).toBeInTheDocument()
    expect(screen.getByTestId('think-bar-btn-pause')).toBeInTheDocument()
  })
})

describe('ThinkBar · mode=minimal', () => {
  it('渲染 think-bar + data-mode=minimal', () => {
    render(
      <ThinkBar
        mode="minimal"
        status={{ title: 'AI 暂停', sub: '· 闲置 5 分钟' }}
      />,
    )
    const el = screen.getByTestId('think-bar')
    expect(el).toBeInTheDocument()
    expect(el.getAttribute('data-mode')).toBe('minimal')
  })

  it('渲染主文案', () => {
    render(
      <ThinkBar
        mode="minimal"
        status={{ title: 'AI 暂停', sub: '· 闲置 5 分钟' }}
      />,
    )
    expect(screen.getByTestId('think-bar-title')).toHaveTextContent('AI 暂停')
  })

  it('不渲染右侧按钮组(minimal 模式无按钮,issue 验收 #3)', () => {
    render(
      <ThinkBar
        mode="minimal"
        status={{ title: 'AI 暂停', sub: '· 闲置 5 分钟' }}
      />,
    )
    expect(screen.queryByTestId('think-bar-actions')).toBeNull()
    expect(screen.queryByTestId('think-bar-btn-detail')).toBeNull()
    expect(screen.queryByTestId('think-bar-btn-pause')).toBeNull()
  })
})

describe('ThinkBar · mode=hidden', () => {
  it('不渲染任何 DOM(返回 null)', () => {
    const { container } = render(
      <ThinkBar mode="hidden" status={sampleStatus} />,
    )
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('think-bar')).toBeNull()
  })
})
