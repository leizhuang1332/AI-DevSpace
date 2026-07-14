import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DraggableDivider } from '../draggable-divider'

// ============================================================================
// jsdom polyfills
// ============================================================================
// jsdom (vitest 默认 environment) 不带 PointerEvent;React 的 onPointerDown
// 通过事件代理最终会落到 document 上的 "pointerdown" 监听,我们手工 dispatch
// 时也要给一个 PointerEvent。本地塞一个最小 polyfill,只在测试环境生效。

beforeAll(() => {
  if (typeof PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      public pointerId: number
      public pointerType: string
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params)
        this.pointerId = params.pointerId ?? 1
        this.pointerType = params.pointerType ?? 'mouse'
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).PointerEvent = PointerEventPolyfill
  }
})

// ============================================================================
// 基础渲染(issue 04 验收 #3)
// ============================================================================

describe('DraggableDivider · 渲染', () => {
  it('默认 testid = split-resizer', () => {
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    expect(screen.getByTestId('split-resizer')).toBeInTheDocument()
  })

  it('hover → cursor-row-resize(Tailwind class 存在)', () => {
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    expect(el.className).toContain('cursor-row-resize')
  })

  it('role=separator + aria-orientation=horizontal', () => {
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    expect(el.getAttribute('role')).toBe('separator')
    expect(el.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('aria-valuenow / -valuemin / -valuemax 反映 ratio * 100', () => {
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    expect(el.getAttribute('aria-valuenow')).toBe('60')
    expect(el.getAttribute('aria-valuemin')).toBe('10')
    expect(el.getAttribute('aria-valuemax')).toBe('90')
  })
})

// ============================================================================
// 鼠标拖拽(issue 04 验收 #4)
// ============================================================================

describe('DraggableDivider · 鼠标拖拽', () => {
  it('pointerdown + mousemove → onDragClientY 被调(带 clientY)', () => {
    const onDragClientY = vi.fn()
    const onDragStart = vi.fn()
    const onDragEnd = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={onDragClientY}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }),
    )
    expect(onDragStart).toHaveBeenCalledTimes(1)

    // 模拟一次 document mousemove
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 120 }))

    expect(onDragClientY).toHaveBeenCalledWith(120)

    // mouseup → onDragEnd
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onDragEnd).toHaveBeenCalledTimes(1)

    // mouseup 后 mousemove 不应再调 onDragClientY
    onDragClientY.mockClear()
    document.dispatchEvent(new MouseEvent('mousemove', { clientY: 200 }))
    expect(onDragClientY).not.toHaveBeenCalled()
  })

  it('右键 pointerdown → 不进入拖拽态', () => {
    const onDragStart = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={onDragStart}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 2 }),
    )
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('拖拽中设置 body.user-select=none;抬起后恢复', () => {
    document.body.style.userSelect = ''
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }),
    )
    expect(document.body.style.userSelect).toBe('none')
    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(document.body.style.userSelect).toBe('')
  })
})

// ============================================================================
// 键盘操作(隐式可访问性)
// ============================================================================

describe('DraggableDivider · 键盘操作', () => {
  it('ArrowUp → onRatioChangeBy(-0.01)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{ArrowUp}')
    expect(onRatioChangeBy).toHaveBeenCalledWith(-0.01)
  })

  it('ArrowDown → onRatioChangeBy(+0.01)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{ArrowDown}')
    expect(onRatioChangeBy).toHaveBeenCalledWith(0.01)
  })

  it('PageUp → onRatioChangeBy(-0.05)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{PageUp}')
    expect(onRatioChangeBy).toHaveBeenCalledWith(-0.05)
  })

  it('PageDown → onRatioChangeBy(+0.05)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{PageDown}')
    expect(onRatioChangeBy).toHaveBeenCalledWith(0.05)
  })

  it('Home → onRatioChangeBy(minRatio - ratio)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{Home}')
    expect(onRatioChangeBy).toHaveBeenCalledWith(-0.5) // 0.1 - 0.6
  })

  it('End → onRatioChangeBy(maxRatio - ratio)', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('{End}')
    // 0.9 - 0.6 = 0.30000000000000004(JS 浮点);用 toBeCloseTo
    expect(onRatioChangeBy).toHaveBeenCalledWith(expect.closeTo(0.3, 10))
  })

  it('其他键 → 不触发 onRatioChangeBy', async () => {
    const onRatioChangeBy = vi.fn()
    render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={onRatioChangeBy}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.focus()
    const user = userEvent.setup()
    await user.keyboard('a')
    expect(onRatioChangeBy).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 卸载清理
// ============================================================================

describe('DraggableDivider · 卸载清理', () => {
  it('拖拽中卸载组件 → body.user-select 恢复', () => {
    document.body.style.userSelect = ''
    const { unmount } = render(
      <DraggableDivider
        ratio={0.6}
        minRatio={0.1}
        maxRatio={0.9}
        onDragClientY={() => {}}
        onDragStart={() => {}}
        onDragEnd={() => {}}
        onRatioChangeBy={() => {}}
      />,
    )
    const el = screen.getByTestId('split-resizer')
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0, clientY: 100 }),
    )
    expect(document.body.style.userSelect).toBe('none')
    expect(() => unmount()).not.toThrow()
    expect(document.body.style.userSelect).toBe('')
  })
})

// ============================================================================
// 集成:与 stateful 父组件协作
// ============================================================================

describe('DraggableDivider · 与 stateful 父组件协作', () => {
  it('键盘 ArrowDown 触发 → 父组件 ratio state 更新', () => {
    function Harness() {
      const [ratio, setRatio] = useState(0.6)
      return (
        <div data-testid="harness" data-ratio={ratio}>
          <DraggableDivider
            ratio={ratio}
            minRatio={0.1}
            maxRatio={0.9}
            onDragClientY={() => {}}
            onDragStart={() => {}}
            onDragEnd={() => {}}
            onRatioChangeBy={(delta) => setRatio((r) => r + delta)}
          />
        </div>
      )
    }
    render(<Harness />)
    const el = screen.getByTestId('split-resizer')
    el.focus()
    // 直接 fire React keyboard 事件,React batching 自动 flush
    fireEvent.keyDown(el, { key: 'ArrowDown' })
    // ratio 从 0.6 + 0.01 = 0.61
    expect(screen.getByTestId('harness').getAttribute('data-ratio')).toBe(
      '0.61',
    )
  })
})