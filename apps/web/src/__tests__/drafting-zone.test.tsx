import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftingZone } from '@/components/drafting-zone'
import {
  emptyDrafting,
  getDraftingData,
} from '@/lib/drafting'

// ============================================================================
// Router mock — DraftingForm 用 useRouter().push 跳到 ANALYZING 工位
// ============================================================================

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/requirements/req-001/drafting/',
  notFound: vi.fn(),
}))

afterEach(() => {
  cleanup()
  routerPush.mockReset()
})

beforeEach(() => {
  vi.useRealTimers()
})

// ============================================================================
// 满数据渲染(对应原型 11a)
// ============================================================================

describe('DraftingZone · 满数据渲染', () => {
  it('根节点 + toolbar + Form 容器存在', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const root = screen.getByTestId('drafting-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    // toolbar
    expect(screen.getByTestId('drafting-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-toolbar-crumb')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-toolbar-status').textContent).toContain('草稿')

    // 主区 Form
    expect(screen.getByTestId('drafting-main')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-form')).toBeInTheDocument()
  })

  it('Form 标题 / PRD 编辑器 / AC 列表 / 仓库 chips 渲染', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // 标题 input
    const title = screen.getByTestId('drafting-title') as HTMLInputElement
    expect(title).toBeInTheDocument()
    expect(title.value).toContain('退款')

    // PRD 编辑器
    expect(screen.getByTestId('drafting-editor')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-editor-toolbar')).toBeInTheDocument()
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd).toBeInTheDocument()
    expect(prd.value.length).toBeGreaterThan(0)

    // AC 列表
    const acList = screen.getByTestId('drafting-ac')
    const acItems = within(acList).getAllByTestId('drafting-ac-item')
    expect(acItems.length).toBe(3)
    acItems.forEach((item) => {
      const input = within(item).getByTestId('drafting-ac-input') as HTMLInputElement
      expect(input.value.length).toBeGreaterThan(0)
    })

    // 仓库 chips(通过 data-repo 属性筛)
    const repoGroup = screen.getByTestId('drafting-repos')
    const chips = within(repoGroup).getAllByTestId(/^drafting-repo-chip-/)
    expect(chips.length).toBeGreaterThan(0)
  })

  it('底部动作按钮:保存草稿 + 创建并启动 AI 分析', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const saveBtn = screen.getByTestId('drafting-action-save')
    const launchBtn = screen.getByTestId('drafting-action-launch')
    expect(saveBtn).toBeInTheDocument()
    expect(saveBtn.textContent).toContain('保存草稿')
    expect(launchBtn).toBeInTheDocument()
    expect(launchBtn.textContent).toContain('创建并启动 AI 分析')
    expect(launchBtn.getAttribute('data-variant')).toBe('primary')
    expect(launchBtn.getAttribute('disabled')).toBeNull() // 满数据 → 可提交
  })

  it('主区编辑器可见(PRD 大纲由资源树承载,见 resource-tree 测试)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // PRD 编辑器与 textarea 可见
    expect(screen.getByTestId('drafting-editor')).toBeInTheDocument()
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd).toBeInTheDocument()
    expect(prd.value.length).toBeGreaterThan(0)
    // PRD 字符计数可见
    expect(screen.getByTestId('drafting-markdown-chars')).toBeInTheDocument()
  })

  it('面包屑:DRAFTING 工位的当前态标记', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const current = screen.getByTestId('drafting-crumb-current')
    expect(current.getAttribute('data-current')).toBe('true')
    expect(current.textContent).toContain('草稿')

    const items = screen.getAllByTestId('drafting-crumb-item')
    expect(items.length).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================================
// 表单交互:AC 增删 + 仓库多选
// ============================================================================

describe('DraftingZone · 表单交互', () => {
  it('添加 AC 按钮 → 列表追加一条', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const before = screen.getAllByTestId('drafting-ac-item').length
    await user.click(screen.getByTestId('drafting-ac-add'))
    const after = screen.getAllByTestId('drafting-ac-item').length
    expect(after).toBe(before + 1)
  })

  it('删除 AC → 列表减少一条', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const before = screen.getAllByTestId('drafting-ac-item').length
    const firstItem = screen.getAllByTestId('drafting-ac-item')[0]
    const removeBtn = within(firstItem).getByTestId('drafting-ac-remove')
    await user.click(removeBtn)
    const after = screen.getAllByTestId('drafting-ac-item').length
    expect(after).toBe(before - 1)
  })

  it('AC 勾选切换', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const firstItem = screen.getAllByTestId('drafting-ac-item')[0]
    expect(firstItem.getAttribute('data-checked')).toBe('false')
    await user.click(within(firstItem).getByTestId('drafting-ac-toggle'))
    expect(firstItem.getAttribute('data-checked')).toBe('true')
  })

  it('仓库 chip 点击 → 切换 selected', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 选一个未选的 chip("coupon-service")
    const coupon = screen.getByTestId('drafting-repo-chip-coupon-service')
    expect(coupon.getAttribute('data-selected')).toBe('false')
    await user.click(coupon)
    expect(coupon.getAttribute('data-selected')).toBe('true')

    // 取消一个已选的
    const refund = screen.getByTestId('drafting-repo-chip-refund-service')
    expect(refund.getAttribute('data-selected')).toBe('true')
    await user.click(refund)
    expect(refund.getAttribute('data-selected')).toBe('false')
  })

  it('标题为空时,launch 按钮 disabled;填写标题后恢复', async () => {
    // 用空数据起手
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    const user = userEvent.setup()

    const launchBtn = screen.getByTestId('drafting-action-launch')
    expect(launchBtn.getAttribute('disabled')).not.toBeNull()

    // 填标题 → 仍缺 PRD / AC → 仍 disabled
    const title = screen.getByTestId('drafting-title')
    await user.type(title, '新需求')
    expect(launchBtn.getAttribute('disabled')).not.toBeNull()

    // 缺字段提示文案
    const missing = screen.getByTestId('drafting-form-missing')
    expect(missing.getAttribute('data-missing')).toContain('prd')
  })
})

// ============================================================================
// 表单交互:PRD Markdown 预览切换 + 字符计数
// ============================================================================

describe('DraftingZone · PRD 预览切换', () => {
  it('点击预览按钮 → textarea 隐藏,预览面板出现', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const toggle = screen.getByTestId('drafting-preview-toggle')
    expect(toggle.getAttribute('data-active')).toBe('false')

    await user.click(toggle)
    expect(toggle.getAttribute('data-active')).toBe('true')
    expect(screen.getByTestId('drafting-preview')).toBeInTheDocument()
    expect(screen.queryByTestId('drafting-prd')).toBeNull()
  })

  it('字符计数随 PRD 内容变化', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const counter = screen.getByTestId('drafting-markdown-chars')
    const before = parseInt(counter.getAttribute('data-chars') ?? '0', 10)

    const prd = screen.getByTestId('drafting-prd')
    await user.click(prd) // focus
    await user.keyboard('xxx')

    const after = parseInt(counter.getAttribute('data-chars') ?? '0', 10)
    expect(after).toBeGreaterThan(before)
  })
})

// ============================================================================
// 表单交互:保存草稿 + 启动 AI 分析
// ============================================================================

describe('DraftingZone · 底部动作', () => {
  it('[💾 保存草稿] 触发自动保存时间戳', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('drafting-action-save'))
    const saved = screen.getByTestId('drafting-autosaved')
    expect(saved).toBeInTheDocument()
    expect(saved.getAttribute('data-saved-at')).toBeTruthy()
  })

  it('[🚀 创建并启动 AI 分析] 跳转到 ANALYZING 工位路由', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('drafting-action-launch'))
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-001/analyzing/')
  })

  it('空草稿点击 launch 时不跳转(disabled)', async () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    const user = userEvent.setup()

    // 1) 按钮必须 disabled(防止误触发)
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()

    // 2) userEvent 对 disabled 按钮会 silently no-op,模拟点击不应触发跳转
    await user.click(btn)
    expect(routerPush).not.toHaveBeenCalled()
  })
})

// ============================================================================
// 空数据(新建需求)
// ============================================================================

describe('DraftingZone · 空数据', () => {
  it('empty=true 时仍渲染 Form 容器,字段全部为空', () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)

    expect(screen.getByTestId('drafting-zone').getAttribute('data-empty')).toBe('true')
    expect((screen.getByTestId('drafting-title') as HTMLInputElement).value).toBe('')
    expect((screen.getByTestId('drafting-prd') as HTMLTextAreaElement).value).toBe('')
    // AC 列表为空(显示"尚无 AC"提示)
    expect(screen.queryAllByTestId('drafting-ac-item')).toHaveLength(0)
    // launch 按钮 disabled
    expect(screen.getByTestId('drafting-action-launch').getAttribute('disabled')).not.toBeNull()
  })
})

// ============================================================================
// 自动保存定时器 — 30 秒周期(本期 mock:仅 UI 更新)
// ============================================================================

describe('DraftingZone · 自动保存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('表单非空时,30s 后触发自动保存', () => {
    const data = {
      ...emptyDrafting('NEW'),
      title: 't',
      prdMarkdown: 'p',
      // 给一条 AC 以让 canSave 触发
      acceptanceCriteria: [{ id: 'a', text: 'ac', checked: false }],
    }
    render(<DraftingZone data={data} />)

    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()
    // 用 act() 包住,确保 React 18 在 fake timers 下也 flush state update
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('drafting-autosaved')).toBeInTheDocument()
  })

  it('表单全空时,30s 后不触发自动保存', () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()
  })

  it('卸载组件时清理定时器(不漏报内存泄漏警告)', () => {
    const { unmount } = render(<DraftingZone data={emptyDrafting('NEW')} />)
    expect(() => unmount()).not.toThrow()
  })
})