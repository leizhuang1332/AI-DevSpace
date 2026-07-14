import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrdAnchorBar } from '../prd-anchor-bar'
import { generatePrdSkeleton } from '@ai-devspace/shared'

// ============================================================================
// 公共 fixture:退款 PRD Markdown(模拟 19-final-drafting 演示数据)
//   行号:0=# 退款 | 1=空 | 2=## 背景 | 3=正文 | 4=空 | 5=## 目标 | 6=正文1 | 7=正文2
// ============================================================================

const REFUND_MD = [
  '# 退款功能优化',                // 0
  '',                                // 1
  '## 背景',                        // 2
  '用户发起退款申请后,...',         // 3
  '',                                // 4
  '## 目标',                        // 5
  '- 退款流程自动化',                // 6
  '- 提升退款到账速度',              // 7
  '',                                // 8
].join('\n')

// ============================================================================
// 时钟隔离:1.5s 高亮倒计时由 setTimeout 驱动;统一用 fake timers
// ============================================================================

afterEach(() => {
  vi.useRealTimers()
})

describe('PrdAnchorBar · 渲染(issue 03 验收 #1 #2)', () => {
  it('horizontally mounted 锚点条存在,data-testid=prd-anchor-bar', () => {
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />)
    expect(screen.getByTestId('prd-anchor-bar')).toBeInTheDocument()
  })

  it('列出 PRD 所有 H1 + H2(源顺序),忽略 H3+', () => {
    const md = `# H1-1
## H2-A
## H2-B
### H3 忽略
#### H4 忽略
## H2-C
`
    render(<PrdAnchorBar markdown={md} onJumpTo={() => {}} />)
    const items = screen.getAllByTestId('anchor-item')
    expect(items).toHaveLength(4) // 1 个 H1 + 3 个 H2,H3/H4 不计入

    const titles = items.map((el) => el.getAttribute('data-anchor-title'))
    expect(titles).toEqual(['H1-1', 'H2-A', 'H2-B', 'H2-C'])

    const lines = items.map((el) => Number(el.getAttribute('data-anchor-line')))
    expect(lines).toEqual([0, 1, 2, 5]) // 源顺序 + 真实行号
  })

  it('每个 anchor 标注 level(H1=1,H2=2)', () => {
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />)
    const items = screen.getAllByTestId('anchor-item')
    expect(items[0].getAttribute('data-anchor-level')).toBe('1')
    expect(items[1].getAttribute('data-anchor-level')).toBe('2')
  })

  it('bar 包含中文 label "大纲" + 章节计数', () => {
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />)
    expect(screen.getByTestId('prd-anchor-bar-label').textContent).toContain(
      '大纲',
    )
    // REFUND_MD 有 3 个 anchor(1 个 H1 + 2 个 H2)
    expect(screen.getByTestId('prd-anchor-bar-count').textContent).toContain(
      '3 章节',
    )
  })
})

// ============================================================================
// 实时刷新(issue 03 验收 #3)
// ============================================================================

describe('PrdAnchorBar · 随 markdown 变化实时刷新', () => {
  it('markdown 中新增 H2 → bar 立刻多一个 anchor', () => {
    const { rerender } = render(
      <PrdAnchorBar markdown="# T" onJumpTo={() => {}} />,
    )
    expect(screen.getAllByTestId('anchor-item')).toHaveLength(1)

    rerender(
      <PrdAnchorBar markdown={'# T\n\n## 新增章节\n'} onJumpTo={() => {}} />,
    )
    expect(screen.getAllByTestId('anchor-item')).toHaveLength(2)
    expect(
      screen.getAllByTestId('anchor-item')[1].getAttribute('data-anchor-title'),
    ).toBe('新增章节')
  })

  it('markdown 中删除 H2 → bar 立刻少一个 anchor', () => {
    const { rerender } = render(
      <PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />,
    )
    expect(screen.getAllByTestId('anchor-item')).toHaveLength(3)

    rerender(<PrdAnchorBar markdown="# Only H1" onJumpTo={() => {}} />)
    expect(screen.getAllByTestId('anchor-item')).toHaveLength(1)
  })
})

// ============================================================================
// 空态(issue 03 验收 #4)
// ============================================================================

describe('PrdAnchorBar · 空态隐藏', () => {
  it('Markdown 为空 → bar 不渲染', () => {
    render(<PrdAnchorBar markdown="" onJumpTo={() => {}} />)
    expect(screen.queryByTestId('prd-anchor-bar')).toBeNull()
  })

  it('Markdown 仅有正文(无 H1/H2)→ bar 不渲染', () => {
    // 故意避开以 "# " 开头的行(那就是 H1),用真无标题的纯正文
    render(
      <PrdAnchorBar
        markdown={'这是普通段落\n不是标题\n另一段正文\n### H3 也不算(>H2)'}
        onJumpTo={() => {}}
      />,
    )
    expect(screen.queryByTestId('prd-anchor-bar')).toBeNull()
  })

  it('Markdown 从有 H2 变成空 → bar 自动消失', () => {
    const { rerender } = render(
      <PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />,
    )
    expect(screen.getByTestId('prd-anchor-bar')).toBeInTheDocument()
    rerender(<PrdAnchorBar markdown="" onJumpTo={() => {}} />)
    expect(screen.queryByTestId('prd-anchor-bar')).toBeNull()
  })
})

// ============================================================================
// 点击 → scroll callback(issue 03 验收 #5)
// ============================================================================

describe('PrdAnchorBar · 点击触发跳转', () => {
  it('点击 anchor → onJumpTo 收到正确行号', async () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={onJumpTo} />)
    const user = userEvent.setup()

    // REFUND_MD:H1 at line 0,H2 背景 at line 2,H2 目标 at line 5
    const target = screen.getAllByTestId('anchor-item')[0] // first (H1 line 0)
    await user.click(target)

    expect(onJumpTo).toHaveBeenCalledTimes(1)
    expect(onJumpTo).toHaveBeenCalledWith(0)
  })

  it('点击 "背景" anchor → 收到 line=2', async () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={onJumpTo} />)
    const user = userEvent.setup()

    const items = screen.getAllByTestId('anchor-item')
    // H1 line 0,H2 背景 line 2,H2 目标 line 5
    await user.click(items[1])
    expect(onJumpTo).toHaveBeenCalledWith(2)
  })

  it('点击 "目标" anchor → 收到 line=5', async () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={onJumpTo} />)
    const user = userEvent.setup()

    const items = screen.getAllByTestId('anchor-item')
    await user.click(items[2])
    expect(onJumpTo).toHaveBeenCalledWith(5)
  })
})

// ============================================================================
// 1.5s 高亮窗口(issue 03 验收 #6 · fake timer seam)
// ============================================================================

describe('PrdAnchorBar · 1.5s 高亮窗口', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  // generatePrdSkeleton('退款') 的 H1 在 line 0,H2 "背景" 在 line 2(中间隔一个空行)
  const md = generatePrdSkeleton('退款')

  function getAnchorButton(line: number): HTMLElement {
    const el = document.querySelector(
      `[data-testid="anchor-item"][data-anchor-line="${line}"]`,
    )
    if (!el) throw new Error(`anchor-item[data-anchor-line="${line}"] not found`)
    return el as HTMLElement
  }

  it('点击后 anchor 立即 data-highlighted="true"', () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={md} onJumpTo={onJumpTo} />)

    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('false')

    act(() => {
      getAnchorButton(2).click()
    })

    expect(onJumpTo).toHaveBeenCalledWith(2)
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('true')
  })

  it('1499ms 时仍高亮', () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={md} onJumpTo={onJumpTo} highlightMs={1500} />)

    act(() => {
      getAnchorButton(2).click()
    })
    act(() => {
      vi.advanceTimersByTime(1_499)
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('true')
  })

  it('1500ms 后高亮清除(data-highlighted="false")', () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={md} onJumpTo={onJumpTo} highlightMs={1500} />)

    act(() => {
      getAnchorButton(2).click()
    })
    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('false')
  })

  it('默认 highlightMs = 1500(用 prop 验证)', () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={md} onJumpTo={onJumpTo} />)

    act(() => {
      getAnchorButton(2).click()
    })
    act(() => {
      vi.advanceTimersByTime(1_499)
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('true')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('false')
  })

  it('连点不同 anchor → 上一次的 timer 被替换,后者的高亮 1.5s 后清', () => {
    // # T(0) \n \n ## A(2) \n \n ## B(4)
    const onJumpTo = vi.fn()
    render(
      <PrdAnchorBar
        markdown={'# T\n\n## A\n\n## B\n'}
        onJumpTo={onJumpTo}
        highlightMs={1500}
      />,
    )
    act(() => {
      getAnchorButton(2).click()
    })
    act(() => {
      vi.advanceTimersByTime(750)
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('true')

    act(() => {
      getAnchorButton(4).click()
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('false')
    expect(getAnchorButton(4).getAttribute('data-highlighted')).toBe('true')

    act(() => {
      vi.advanceTimersByTime(750)
    })
    expect(getAnchorButton(4).getAttribute('data-highlighted')).toBe('true')

    act(() => {
      vi.advanceTimersByTime(750)
    })
    expect(getAnchorButton(4).getAttribute('data-highlighted')).toBe('false')
  })

  it('markdown 改为不含当前高亮 anchor → highlight 立刻撤回(不等到 1.5s)', () => {
    // # T(0) \n \n ## A(2) \n \n ## B(6)
    const onJumpTo = vi.fn()
    const { rerender } = render(
      <PrdAnchorBar
        markdown={'# T\n\n## A\n\n## B\n'}
        onJumpTo={onJumpTo}
        highlightMs={1500}
      />,
    )
    act(() => {
      getAnchorButton(2).click()
    })
    expect(getAnchorButton(2).getAttribute('data-highlighted')).toBe('true')

    // 把 markdown 改成只剩 H1,line 2 不再是 anchor → highlight 立刻撤回
    rerender(<PrdAnchorBar markdown="# T\n" onJumpTo={onJumpTo} />)
    // 此时 line=2 的元素已不存在(getAnchorButton 应抛错)
    expect(() => getAnchorButton(2)).toThrow(/not found/)
  })
})

// ============================================================================
// 键盘激活(issue 03 验收 #7 —— 真机 userEvent,无需 fake timer)
// ============================================================================

describe('PrdAnchorBar · 键盘激活', () => {
  it('anchor 是按钮(focusable)', () => {
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />)
    const target = screen.getAllByTestId('anchor-item')[1]
    expect(target.tagName).toBe('BUTTON')
    expect(target.getAttribute('tabindex')).toBeNull()
  })

  it('Enter 键 → 触发 onJumpTo', async () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={onJumpTo} />)
    const user = userEvent.setup()
    const target = screen.getAllByTestId('anchor-item')[1]

    target.focus()
    await user.keyboard('{Enter}')

    expect(onJumpTo).toHaveBeenCalledTimes(1)
    // REFUND_MD 的 H1 在 line 0,H2 背景在 line 2(中间隔空行)
    expect(onJumpTo).toHaveBeenCalledWith(2)
  })

  it('Space 键也激活(浏览器原生 button 行为)', async () => {
    const onJumpTo = vi.fn()
    render(<PrdAnchorBar markdown={REFUND_MD} onJumpTo={onJumpTo} />)
    const user = userEvent.setup()
    const target = screen.getAllByTestId('anchor-item')[2]

    target.focus()
    await user.keyboard(' ')

    // REFUND_MD 的 H2 目标在 line 5
    expect(onJumpTo).toHaveBeenCalledWith(5)
  })
})

// ============================================================================
// 卸载清理(issue 03 隐式验收 —— 内存卫生)
// ============================================================================

describe('PrdAnchorBar · 卸载清理', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('卸载组件时不留未清除的 setTimeout(不报内存泄漏 / 不抛错)', () => {
    const { unmount } = render(
      <PrdAnchorBar markdown={REFUND_MD} onJumpTo={() => {}} />,
    )
    // 点击触发一个 timer
    act(() => {
      (
        document.querySelector(
          '[data-testid="anchor-item"]',
        ) as HTMLElement
      ).click()
    })
    // 立刻卸载(此时 timer 还没到 1500ms)
    expect(() => unmount()).not.toThrow()
    // 推进 1500ms 不应抛错(已卸载组件不接收 setState)
    expect(() => vi.advanceTimersByTime(1_500)).not.toThrow()
  })
})
