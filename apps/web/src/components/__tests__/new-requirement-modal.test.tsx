/**
 * NewRequirementModal 单元测试(issue 03 ticket — 4 个触发入口 / 焦点 / a11y / 校验)
 *
 * 验收范围:
 * - cmdN=false → 不渲染
 * - 打开后:对话框出现 + 输入框 autoFocus + slug 预览 + 字数计数
 * - 焦点回触发(决策 24 / 30 a11y):✕ / 取消 / backdrop / Esc 四条路径都还原
 * - Tab/Shift+Tab 焦点陷阱(spec §11)
 * - 校验:空 trim 时 ✓ 创建 disabled;路径非法字符过滤;长度截断 50
 * - 提交:关闭 + router.push 到 /requirements/<id>/drafting/
 *
 * 测试惯例(vitest + jsdom):
 * - focus 断言用 `document.activeElement` 直接比较(仓库零 toHaveFocus 用法)
 * - Escape 用 `userEvent.keyboard('{Escape}')`
 * - Tab 用 `fireEvent.keyDown(el, { key: 'Tab', shiftKey? })` —— 避开 userEvent
 *   默认 focus 行为掩盖 preventDefault
 * - data-testid 覆盖所有可交互元素
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  UIOverlayProvider,
  useUIOverlay,
} from '@/components/ui-overlay-store'
import { NewRequirementModal } from '@/components/new-requirement-modal'

// ---- 受控 mock:next/navigation(useRouter) ----
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
}))

afterEach(() => cleanup())

/**
 * Helper:渲染 <UIOverlayProvider> + <NewRequirementModal />。
 * 返回 triggerEl —— 一个会调用 `open('cmdN')` 的按钮,用于模拟「按钮触发」入口。
 */
function renderModal() {
  function Trigger() {
    const { open } = useUIOverlay()
    return (
      <button type="button" data-testid="trigger-btn" onClick={() => open('cmdN')}>
        trigger
      </button>
    )
  }
  return render(
    <UIOverlayProvider>
      <Trigger />
      <NewRequirementModal />
    </UIOverlayProvider>,
  )
}

describe('NewRequirementModal · 渲染条件', () => {
  it('cmdN=false → 不渲染 dialog', () => {
    renderModal()
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
  })

  it('open("cmdN") → dialog 出现 + role=dialog + aria-modal=true', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const dialog = screen.getByTestId('new-req-modal')
    expect(dialog).toBeInTheDocument()
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('打开后输入框 autoFocus', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    expect(document.activeElement).toBe(input)
  })

  it('slug 预览:空输入显示 req-NNN-<slug>,有输入显示 req-NNN-<slugify>', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    expect(screen.getByText(/req-NNN-<slug>/)).toBeInTheDocument()

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款功能优化')
    // slug 应显示 「退款功能优化」 的 kebab-case(中文保留)
    expect(screen.getByText(/退款功能优化/)).toBeInTheDocument()
  })

  it('字数计数:name.length / 50', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款')
    expect(screen.getByText('2 / 50')).toBeInTheDocument()
  })
})

describe('NewRequirementModal · 校验', () => {
  it('空 / 全空白 → ✓ 创建 disabled', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const submit = screen.getByTestId('new-req-modal-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '   ')
    expect(submit.disabled).toBe(true)
  })

  it('含路径非法字符(\\ / : * ? " < > |)→ 实时过滤', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, 'a\\b/c:d*e?f"g<h>i|j')
    expect(input.value).toBe('abcdefghij')
  })

  it('> 50 字 → 截断 50', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, 'a'.repeat(60))
    expect(input.value.length).toBe(50)
    expect(screen.getByText('50 / 50')).toBeInTheDocument()
  })
})

describe('NewRequirementModal · 关闭路径 + 焦点回触发(决策 24 / 30 a11y)', () => {
  it('点击 ✕ → 关闭 + 焦点回到 trigger 按钮', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await user.click(trigger)
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()

    await user.click(screen.getByTestId('new-req-modal-close'))
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    // 注:模态 useEffect([cmdN]) 在 commit 后异步触发;此处 flush 一下
    await act(async () => {})
    expect(document.activeElement).toBe(trigger)
  })

  it('点击 取消 → 关闭 + 焦点回到 trigger 按钮', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    await user.click(screen.getByTestId('new-req-modal-cancel'))
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    await act(async () => {})
    expect(document.activeElement).toBe(trigger)
  })

  it('点击 backdrop → 关闭 + 焦点回到 trigger 按钮', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    // backdrop 是 <div class="fixed inset-0 ...">,包裹 form。点 form 外的部分
    // 即点击 backdrop 本身(form.onClick stopPropagation)
    const dialog = screen.getByTestId('new-req-modal')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    await act(async () => {})
    expect(document.activeElement).toBe(trigger)
  })

  it('ESC → 关闭 + 焦点回到 trigger 按钮(store 全局 Esc)', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    await act(async () => {})
    expect(document.activeElement).toBe(trigger)
  })
})

describe('NewRequirementModal · Tab 焦点陷阱(spec §11)', () => {
  it('焦点在末元素(✓ 创建)按 Tab → 回到首元素(✕)', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    // 先填名以启用 submit,使其进入可聚焦列表
    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款')

    const submit = screen.getByTestId('new-req-modal-submit')
    submit.focus()
    expect(document.activeElement).toBe(submit)

    // 用 fireEvent 直接派发 Tab keydown,避免 user-event 默认 focus 行为掩盖 preventDefault
    fireEvent.keyDown(submit, { key: 'Tab' })
    const close = screen.getByTestId('new-req-modal-close')
    expect(document.activeElement).toBe(close)
  })

  it('焦点在首元素(✕)按 Shift+Tab → 跳到末元素(✓ 创建)', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款')

    const close = screen.getByTestId('new-req-modal-close')
    close.focus()
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByTestId('new-req-modal-submit'))
  })
})

describe('NewRequirementModal · 提交', () => {
  it('提交 → 关闭 + router.push 到 /requirements/<id>/drafting/', async () => {
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款功能优化')

    await user.click(screen.getByTestId('new-req-modal-submit'))

    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    expect(mockPush).toHaveBeenCalledTimes(1)
    const target = mockPush.mock.calls[0][0] as string
    // 路径形如 /requirements/req-NNNNNN-退款功能优化/drafting/
    expect(target).toMatch(/^\/requirements\/req-\d{6}-.+?\/drafting\/$/)
  })
})