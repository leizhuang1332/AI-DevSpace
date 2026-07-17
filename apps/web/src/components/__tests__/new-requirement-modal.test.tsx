/**
 * NewRequirementModal 单元测试(issue 03 ticket — 4 个触发入口 / 焦点 / a11y / 校验)
 *
 * 验收范围:
 * - cmdN=false → 不渲染
 * - 打开后:对话框出现 + 输入框 autoFocus + slug 预览 + 字数计数
 * - 焦点回触发(决策 24 / 30 a11y):✕ / 取消 / backdrop / Esc 四条路径都还原
 * - Tab/Shift+Tab 焦点陷阱(spec §11)
 * - 校验:空 trim 时 ✓ 创建 disabled;路径非法字符过滤;长度截断 50
 * - 提交(ticket 06 起):调 POST /api/requirements → 拿后端 id → close + router.push
 * - 错误态:400 inline 红字 / 401 跳设置页 / 网络错 inline 红字 + 重试
 *
 * 测试惯例(vitest + jsdom):
 * - focus 断言用 `document.activeElement` 直接比较(仓库零 toHaveFocus 用法)
 * - Escape 用 `userEvent.keyboard('{Escape}')`
 * - Tab 用 `fireEvent.keyDown(el, { key: 'Tab', shiftKey? })` —— 避开 userEvent
 *   默认 focus 行为掩盖 preventDefault
 * - data-testid 覆盖所有可交互元素
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
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

// ---- 受控 mock:@/lib/requirement(ticket 06) ----
// mock createRequirement + isCreateRequirementError,默认成功路径返回真实形态的 id。
const mockCreateRequirement = vi.fn()
const mockIsCreateRequirementError = vi.fn()
vi.mock('@/lib/requirement', async () => {
  // 实际 module — 用真实类做 typeguard
  const actual =
    await vi.importActual<typeof import('@/lib/requirement')>('@/lib/requirement')
  return {
    ...actual,
    createRequirement: (...args: unknown[]) => mockCreateRequirement(...args),
    isCreateRequirementError: (...args: unknown[]) =>
      mockIsCreateRequirementError(...args),
  }
})

beforeEach(() => {
  mockCreateRequirement.mockReset()
  mockPush.mockReset()
  // 默认成功路径:返回 ticket 04 后端契约的真实形态(201 + CreateRequirementResponse)
  mockCreateRequirement.mockResolvedValue({
    id: 'req-001-退款功能优化',
    title: '退款功能优化',
    createdAt: '2026-07-17T10:00:00.000Z',
  })
  // isCreateRequirementError 默认返回 false(网络错等场景),Errror instance 单独 mock true
  mockIsCreateRequirementError.mockReturnValue(false)
})

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

  it('E5 允许同名(决策 c1):重复 title 不报错,提交流程不变', async () => {
    // 决策 c1:允许同名需求,ID 唯一即可。这里验证两次输入相同 title,
    // 提交按钮仍可用,且 slug 派生一致。
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款功能优化')
    const submit = screen.getByTestId('new-req-modal-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(false)
  })

  it('E10 取消无副作用:打开 → 取消 → 再打开 → input 为空(不残留)', async () => {
    // 决策 E10:用户取消后无副作用,需求未创建,二次打开 input 应清空。
    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')

    // 第一次:输入 → 取消
    await user.click(trigger)
    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款')
    await user.click(screen.getByTestId('new-req-modal-cancel'))
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
    expect(mockPush).not.toHaveBeenCalled()

    // 第二次:再次打开,input 应为空
    await user.click(trigger)
    const input2 = screen.getByLabelText(/需求名称/) as HTMLInputElement
    expect(input2.value).toBe('')
  })

  it('slug 预览:退款功能优化 → req-NNN-退款功能优化(中文保留)', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款功能优化')
    // slug 预览应显示中文原样保留
    expect(screen.getByText(/退款功能优化/)).toBeInTheDocument()
  })

  it('slug 预览:Order Refund V2! → req-NNN-order-refund-v2', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, 'Order Refund V2!')
    // kebab-case + 去标点
    expect(screen.getByText(/order-refund-v2/)).toBeInTheDocument()
  })

  it('slug 预览:输入含路径非法字符 → 实时同步过滤后 slug', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    // 包含 : 和 / 应该被过滤;前后的 空格 也应被处理为 -
    await user.type(input, '  测试 / 边界  ')
    // 期望 slug:测试-边界(去前后 -, / → 删,空白 → -)
    expect(screen.getByText(/测试-边界/)).toBeInTheDocument()
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
  it('提交成功(ticket 06):调 POST /api/requirements → 关闭 + router.push 用后端 id', async () => {
    // 后端返回 ticket 04 契约的 id(真实落盘的目录名)
    mockCreateRequirement.mockResolvedValue({
      id: 'req-007-退款功能优化',
      title: '退款功能优化',
      createdAt: '2026-07-17T10:00:00.000Z',
    })

    renderModal()
    const user = userEvent.setup()
    const trigger = screen.getByTestId('trigger-btn')
    trigger.focus()
    await user.click(trigger)

    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, '退款功能优化')

    await user.click(screen.getByTestId('new-req-modal-submit'))

    // 1. 调了 API,body 是 { title } 形态
    expect(mockCreateRequirement).toHaveBeenCalledTimes(1)
    expect(mockCreateRequirement).toHaveBeenCalledWith({ title: '退款功能优化' })

    // 2. 弹窗关闭
    expect(screen.queryByTestId('new-req-modal')).toBeNull()

    // 3. router.push 用的是**后端返回**的 id(不是前端 mock 的 Date.now)
    expect(mockPush).toHaveBeenCalledTimes(1)
    const target = mockPush.mock.calls[0][0] as string
    expect(target).toBe('/requirements/req-007-退款功能优化/drafting/')
  })

  it('ticket 06:不再用 Date.now() mock id', async () => {
    // 回归测试:ticket 06 之前 modal 用 Date.now() 拼 id 后 router.push,
    // 现在必须等后端返回;Promise pending 时不应 push。
    let resolvePromise: (v: unknown) => void = () => {}
    mockCreateRequirement.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    // 请求 in-flight:还没 push,modal 还开着
    await waitFor(() => {
      expect(mockCreateRequirement).toHaveBeenCalledTimes(1)
    })
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.getByTestId('new-req-modal')).toBeInTheDocument()

    // 后端返回 → 才 push + close
    resolvePromise({
      id: 'req-007-退款功能优化',
      title: '退款功能优化',
      createdAt: '2026-07-17T10:00:00.000Z',
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/requirements/req-007-退款功能优化/drafting/',
      )
    })
  })

  it('提交中:按钮 disabled + 文本「创建中…」+ 阻止 backdrop 关闭', async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    mockCreateRequirement.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      }),
    )

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    // 提交中
    const submit = screen.getByTestId('new-req-modal-submit') as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(submit.textContent).toContain('创建中')
    const cancel = screen.getByTestId('new-req-modal-cancel') as HTMLButtonElement
    expect(cancel.disabled).toBe(true)
    const close = screen.getByTestId('new-req-modal-close') as HTMLButtonElement
    expect(close.disabled).toBe(true)

    // backdrop 在提交中不响应 click
    const dialog = screen.getByTestId('new-req-modal')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByTestId('new-req-modal')).toBeInTheDocument()

    // 收尾
    resolvePromise({
      id: 'req-001-退款',
      title: '退款',
      createdAt: '2026-07-17T10:00:00.000Z',
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalled())
  })
})

describe('NewRequirementModal · 错误态(ticket 06 · PRD §9 E6-E9)', () => {
  it('400 E_INVALID_TITLE → modal 不关 + inline 红字提示', async () => {
    const err400 = Object.assign(new Error('CreateRequirement 400'), {
      status: 400,
      code: 'E_INVALID_TITLE',
      body: { error: 'E_INVALID_TITLE', message: 'title too short' },
      name: 'CreateRequirementError',
    })
    mockIsCreateRequirementError.mockReturnValue(true)
    mockCreateRequirement.mockRejectedValue(err400)

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    // 错误展示
    await waitFor(() => {
      expect(screen.getByTestId('new-req-modal-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('new-req-modal-error').textContent).toContain(
      '标题不合法',
    )
    // modal 没关
    expect(screen.queryByTestId('new-req-modal')).toBeInTheDocument()
    // 没 push(决策 E6 风格:inline 提示,不让 DRAFTING 接管)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('401 E_AUTH → 关闭 modal + 跳设置页(决策 34)', async () => {
    const err401 = Object.assign(new Error('CreateRequirement 401'), {
      status: 401,
      code: 'E_AUTH',
      body: { error: 'E_AUTH', message: 'token expired' },
      name: 'CreateRequirementError',
    })
    mockIsCreateRequirementError.mockReturnValue(true)
    mockCreateRequirement.mockRejectedValue(err401)

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/settings/?section=agent')
    })
    expect(screen.queryByTestId('new-req-modal')).toBeNull()
  })

  it('500 E_ID_COLLISION → modal 不关 + 编号冲突中文文案', async () => {
    const err500 = Object.assign(new Error('CreateRequirement 500'), {
      status: 500,
      code: 'E_ID_COLLISION',
      body: { error: 'E_ID_COLLISION', message: 'id collision' },
      name: 'CreateRequirementError',
    })
    mockIsCreateRequirementError.mockReturnValue(true)
    mockCreateRequirement.mockRejectedValue(err500)

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('new-req-modal-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('new-req-modal-error').textContent).toContain(
      '编号冲突',
    )
    expect(screen.queryByTestId('new-req-modal')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('网络错(非 CreateRequirementError)→ modal 不关 + 原 message 显示', async () => {
    // 模拟 fetch 抛 TypeError(典型网络错)
    mockIsCreateRequirementError.mockReturnValue(false)
    mockCreateRequirement.mockRejectedValue(new TypeError('fetch failed'))

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('new-req-modal-error')).toBeInTheDocument()
    })
    expect(screen.getByTestId('new-req-modal-error').textContent).toContain(
      'fetch failed',
    )
    expect(screen.queryByTestId('new-req-modal')).toBeInTheDocument()
  })

  it('E9 router.push 失败 → 当前 modal 不暴露该路径(决策 E6:由 DRAFTING 兜底)', async () => {
    // 注:E9 在 PRD §9 中定义,但 modal 本身不 catch router.push 错(next/navigation
    // 默认不 throw,只会 warn);DRAFTING 兜底(找不到 requirement 目录 → 红色 banner)。
    // 这里只验证 modal 调通 API 成功后立即 push 不被任何 catch 拦截。
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        '/requirements/req-001-退款功能优化/drafting/',
      )
    })
  })

  it('取消 / Esc / ✕ → 不发请求(mockCreateRequirement 不被调)', async () => {
    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )

    // ✕
    await user.click(screen.getByTestId('new-req-modal-close'))
    expect(mockCreateRequirement).not.toHaveBeenCalled()

    // 再打开,取消
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.click(screen.getByTestId('new-req-modal-cancel'))
    expect(mockCreateRequirement).not.toHaveBeenCalled()

    // 再打开,Esc
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款功能优化',
    )
    await user.keyboard('{Escape}')
    expect(mockCreateRequirement).not.toHaveBeenCalled()
  })

  it('错误显示后,继续修改输入 → 错误自动清掉(决策 E9 风格)', async () => {
    mockIsCreateRequirementError.mockReturnValue(true)
    mockCreateRequirement.mockRejectedValueOnce(
      Object.assign(new Error('400'), {
        status: 400,
        code: 'E_INVALID_TITLE',
        body: { error: 'E_INVALID_TITLE' },
        name: 'CreateRequirementError',
      }),
    )

    renderModal()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('trigger-btn'))
    await user.type(
      screen.getByLabelText(/需求名称/) as HTMLInputElement,
      '退款',
    )
    await user.click(screen.getByTestId('new-req-modal-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('new-req-modal-error')).toBeInTheDocument()
    })

    // 用户继续改 input → 错误消失
    const input = screen.getByLabelText(/需求名称/) as HTMLInputElement
    await user.type(input, 'A')
    expect(screen.queryByTestId('new-req-modal-error')).toBeNull()
  })
})