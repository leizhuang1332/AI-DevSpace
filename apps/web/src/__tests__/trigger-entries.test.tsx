/**
 * 4 个触发入口接入测试(issue 03 ticket — 单例 + 共用 modal)
 *
 * 验收:
 * - 入口 1:⌘N / Ctrl+N 全局快捷键
 * - 入口 2:Cmd+K 命令面板搜「新建需求」点击
 * - 入口 3:概览页 `+ 新建需求` 按钮
 * - 入口 4:需求列表页 `+ 新建需求` 按钮
 * - 4 个入口共用同一 <NewRequirementModal /> 单例(决策 36)
 * - 关闭后焦点回触发(决策 24 / 30 a11y)
 *
 * Pattern:模拟 (workspace)/layout.tsx 的 overlay 树,但只关心 NewRequirementModal
 * 的可见性 / 单例性 / 焦点行为,不重复单测已经覆盖过的字段校验。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// 受控 mock:next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

// 必须在 vi.mock 之后
import { UIOverlayProvider } from '@/components/ui-overlay-store'
import { CommandPalette } from '@/components/command-palette'
import { NewRequirementModal } from '@/components/new-requirement-modal'
import { NewRequirementButton } from '@/components/new-requirement-button'

afterEach(() => cleanup())

/**
 * 模拟 layout 里的 overlay 树(决策 36 单例):
 * - 真实 <UIOverlayProvider>
 * - 真实 <CommandPalette>、<NewRequirementModal>
 * - 4 个触发按钮(快捷键 ⌘N / Cmd+K 按钮 / 概览按钮 / 列表按钮)
 */
function Shell() {
  return (
    <UIOverlayProvider>
      <div>
        {/* 入口 3:概览页「+ 新建需求」 */}
        <NewRequirementButton label="+ 新建需求" />
        {/* 入口 4:列表页「+ 新建需求」 */}
        <NewRequirementButton label="列表按钮" />
        {/* 入口 2 触发:打开 Cmd+K */}
        <button
          type="button"
          data-testid="open-palette-btn"
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
          }}
        >
          open palette
        </button>
      </div>
      <CommandPalette />
      <NewRequirementModal />
    </UIOverlayProvider>
  )
}

describe('4 个触发入口 · 共用单例 NewRequirementModal(决策 36)', () => {
  it('入口 3 · 概览页按钮 → 打开 dialog(role=dialog)', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    await user.click(screen.getByText('+ 新建需求'))
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('入口 4 · 列表页按钮 → 打开 dialog', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    await user.click(screen.getByText('列表按钮'))
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('入口 2 · Cmd+K 搜「新建需求」点击 → 打开 dialog', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    // 打开 Cmd+K
    await user.click(screen.getByTestId('open-palette-btn'))
    expect(screen.getByTestId('cmd-new-requirement')).toBeInTheDocument()
    // 点击该项 → 触发 action(open('cmdN') + close())
    await user.click(screen.getByTestId('cmd-new-requirement'))
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('入口 1 · ⌘N 全局快捷键 → 打开 dialog', async () => {
    render(<Shell />)
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('入口 1 · Ctrl+N(非 mac) → 同样打开 dialog', () => {
    render(<Shell />)
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('单例:任意入口打开后,DOM 中只渲染一个 role="dialog"', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    await user.click(screen.getByText('+ 新建需求'))
    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(1)
  })
})

describe('4 个触发入口 · 焦点回触发(决策 24 / 30 a11y)', () => {
  it('按钮触发 → 关闭后焦点回到该按钮', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    const trigger = screen.getByText('+ 新建需求')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await user.click(trigger)
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('new-req-modal-close'))
    await act(async () => {})
    expect(document.activeElement).toBe(trigger)
  })

  it('⌘N 触发 → 关闭后焦点回 body(键按下前无 focus 元素)', async () => {
    render(<Shell />)
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    await act(async () => {})
    // jsdom 默认 activeElement 是 body
    expect(document.activeElement).toBe(document.body)
  })

  it('Cmd+K 「新建需求」触发 → 关闭后焦点回 body(palette item 已卸载)', async () => {
    render(<Shell />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('open-palette-btn'))
    const item = screen.getByTestId('cmd-new-requirement')
    item.focus()
    expect(document.activeElement).toBe(item)

    await user.click(item)
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('new-req-modal-close'))
    await act(async () => {})
    // palette 已关闭,原 item 元素已卸载 → fallback 到 body
    expect(document.activeElement).toBe(document.body)
  })
})

describe('NewRequirementButton · label prop(issue 03 验收 §8.3)', () => {
  it('默认 label = "+ 新建需求"', () => {
    render(
      <UIOverlayProvider>
        <NewRequirementButton />
      </UIOverlayProvider>,
    )
    expect(screen.getByTestId('new-requirement-button')).toHaveTextContent('+ 新建需求')
  })

  it('空需求列表引导文案 "创建你的第一个需求"', () => {
    render(
      <UIOverlayProvider>
        <NewRequirementButton label="创建你的第一个需求" />
      </UIOverlayProvider>,
    )
    expect(screen.getByTestId('new-requirement-button')).toHaveTextContent('创建你的第一个需求')
  })
})