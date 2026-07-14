import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftingZone } from '@/components/drafting-zone'
import {
  emptyDrafting,
  getDraftingData,
} from '@/lib/drafting'
import { generatePrdSkeleton } from '@ai-devspace/shared'

// ============================================================================
// Router mock — DraftingPrdPane 用 useRouter().push 跳到 ANALYZING 工位
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
// 满数据渲染(对应原型 19-final-drafting 的 PRD 顶置区域)
// ============================================================================

describe('DraftingZone · 满数据渲染', () => {
  it('根节点 + toolbar + PRD 卡片存在', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const root = screen.getByTestId('drafting-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    // toolbar(壳层)
    expect(screen.getByTestId('drafting-toolbar')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-toolbar-crumb')).toBeInTheDocument()

    // 主区 PRD 卡片(issue 02)
    expect(screen.getByTestId('drafting-main')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-prd-pane')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-prd-card')).toBeInTheDocument()
  })

  it('PRD 卡片头显示 "PRD" badge + "主文档" 标题 + 自动保存指示(无则隐藏)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const head = screen.getByTestId('drafting-prd-head')
    expect(within(head).getByTestId('drafting-prd-badge')).toBeInTheDocument()
    expect(head.textContent).toContain('主文档')

    // lastSavedAt=null 时不渲染时间戳(本期样例未保存过)
    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()
  })

  it('标题 input 渲染并带初始值', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const title = screen.getByTestId('drafting-title') as HTMLInputElement
    expect(title).toBeInTheDocument()
    expect(title.value).toContain('退款')
  })

  it('PRD 编辑器渲染(含 toolbar + textarea + 字符计数)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    expect(screen.getByTestId('drafting-editor')).toBeInTheDocument()
    expect(screen.getByTestId('drafting-editor-toolbar')).toBeInTheDocument()
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd).toBeInTheDocument()
    expect(prd.value.length).toBeGreaterThan(0)
    // 字符计数
    const chars = screen.getByTestId('drafting-markdown-chars')
    expect(chars.getAttribute('data-chars')).toBe(String(prd.value.length))
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
// 骨架自动填充(issue 02 验收 #2)
// ============================================================================

describe('DraftingZone · 骨架自动填充', () => {
  it('empty=true + PRD 为空 → mount 后 PRD textarea 显示骨架内容', () => {
    // emptyDrafting 默认 title='' prdMarkdown='' empty=true → 触发骨架
    render(<DraftingZone data={emptyDrafting('NEW')} />)

    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    // generatePrdSkeleton('') 的 fallback H1
    expect(prd.value).toBe(generatePrdSkeleton(''))
    // 骨架的 4 个 H2
    expect(prd.value).toContain('## 背景')
    expect(prd.value).toContain('## 目标')
    expect(prd.value).toContain('## 验收标准')
    expect(prd.value).toContain('## 非目标')
  })

  it('empty=true 且 title 非空 → 骨架 H1 与 title 一致', () => {
    render(
      <DraftingZone
        data={{ ...emptyDrafting('NEW'), title: '退款功能优化' }}
      />,
    )

    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd.value).toBe(generatePrdSkeleton('退款功能优化'))
    expect(prd.value.startsWith('# 退款功能优化')).toBe(true)
  })

  it('empty=false(已存 PRD)→ 骨架不覆盖,保留原始内容', async () => {
    const data = await getDraftingData('req-001')
    // req-001 prdMarkdown 已是 generatePrdSkeleton('退款功能优化') 的结果
    const original = data.prdMarkdown
    render(<DraftingZone data={data} />)

    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd.value).toBe(original)
  })

  it('empty=true 但 PRD 已有内容(异常态)→ 不触发骨架,保留内容', () => {
    render(
      <DraftingZone
        data={{
          ...emptyDrafting('NEW'),
          prdMarkdown: '# 已有 PRD\n\n## 自定义\n- 内容',
          empty: true,
        }}
      />,
    )
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    expect(prd.value).toBe('# 已有 PRD\n\n## 自定义\n- 内容')
  })
})

// ============================================================================
// 编辑交互(issue 02 验收 #3)
// ============================================================================

describe('DraftingZone · 受控编辑', () => {
  it('编辑标题 → title state 更新', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const title = screen.getByTestId('drafting-title') as HTMLInputElement
    await user.clear(title)
    await user.type(title, 'X')
    expect(title.value).toBe('X')
  })

  it('编辑 PRD → prdMarkdown state 更新(字符计数同步)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    const before = prd.value.length
    await user.click(prd)
    await user.keyboard('xxx')
    expect(prd.value.length).toBe(before + 3)
    // 字符计数同步
    expect(
      screen.getByTestId('drafting-markdown-chars').getAttribute('data-chars'),
    ).toBe(String(prd.value.length))
  })

  it('title 与 PRD 各自独立(title 不写入 PRD H1)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const title = screen.getByTestId('drafting-title') as HTMLInputElement
    await user.clear(title)
    await user.type(title, '新标题')

    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    // PRD H1 仍为原始 "退款功能优化",没有跟随 title 变化
    expect(prd.value).toContain('# 退款功能优化')
    expect(prd.value).not.toContain('# 新标题')
  })
})

// ============================================================================
// 自动保存(issue 02 验收 #4)
// ============================================================================

describe('DraftingZone · 自动保存', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('表单有内容 → 30s 后出现 "已保存 · x 秒前" 时间戳', async () => {
    const data = await getDraftingData('req-001')
    // req-001 PRD 已有内容 → 应触发自动保存
    render(<DraftingZone data={data} />)
    // 起始 lastSavedAt=null → 时间戳不渲染
    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.getByTestId('drafting-autosaved')).toBeInTheDocument()
  })

  it('clearing all content suppresses the autosave tick —— 实际交互场景', async () => {
    // 真实场景:用户清空 PRD → PRD 为空时 autosave 不再 tick
    // (骨架默认有内容,故需要先清空 PRD 才能验证 suppress)
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // 用 fireEvent 直接修改 React 状态(避免 userEvent + fake timers 集成问题)
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    fireEvent.change(prd, { target: { value: '' } })
    fireEvent.change(screen.getByTestId('drafting-title'), { target: { value: '' } })

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()
  })

  it('卸载组件时清理定时器(不漏报内存泄漏警告)', () => {
    const { unmount } = render(<DraftingZone data={emptyDrafting('NEW')} />)
    expect(() => unmount()).not.toThrow()
  })
})

// ============================================================================
// 启动动作(issue 02 验收 #5 #6 #7 #8)
// ============================================================================

describe('DraftingZone · 启动 ANALYZING', () => {
  it('按钮文案为 "▶ 进入 ANALYZING"', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn).toBeInTheDocument()
    expect(btn.textContent).toContain('▶ 进入 ANALYZING')
    expect(btn.getAttribute('data-variant')).toBe('primary')
  })

  it('title + PRD 均有内容 → 按钮 enabled 且点击跳到 /requirements/<id>/analyzing/', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).toBeNull()

    await user.click(btn)
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-001/analyzing/')
  })

  it('title 为空 → 按钮 disabled 且点击不触发跳转', async () => {
    // 用 empty=true + 手工写 title='' 的场景无法直接构造(骨架会覆盖 PRD)
    // → 通过 user 清空 title 触发
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.clear(screen.getByTestId('drafting-title'))
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()

    await user.click(btn)
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('PRD 全空白 → 按钮 disabled', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.clear(screen.getByTestId('drafting-prd'))
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()
  })

  it('点击启动按钮不触发任何副作用(mockside routerPush 仅一次)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('drafting-action-launch'))
    // 仅 1 次 push,无其他 API 调用 / 状态变更
    expect(routerPush).toHaveBeenCalledTimes(1)
  })

  it('disabled 时点击 → 不跳转(disabled 按钮被 userEvent silent no-op)', async () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    const user = userEvent.setup()

    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()
    await user.click(btn)
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('不依赖仓库或辅助文件 —— 满数据 + 空仓库/辅助也能 launch', async () => {
    // 构造一个不带 repos/auxFiles 的数据(issue 02 数据层已无这些字段)
    const data = {
      ...emptyDrafting('req-002'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
    }
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).toBeNull()
    await user.click(btn)
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-002/analyzing/')
  })
})

// ============================================================================
// 空数据(新建需求)
// ============================================================================

describe('DraftingZone · 空数据', () => {
  it('empty=true → launch 按钮 disabled + PRD 字段被骨架填充', () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)

    expect(screen.getByTestId('drafting-zone').getAttribute('data-empty')).toBe(
      'true',
    )
    expect((screen.getByTestId('drafting-title') as HTMLInputElement).value).toBe(
      '',
    )
    // PRD 已被骨架填充,验证骨架存在即可
    expect(
      (screen.getByTestId('drafting-prd') as HTMLTextAreaElement).value,
    ).toContain('## 背景')
    // launch 按钮 disabled(title 为空 → canLaunch=false)
    expect(
      screen.getByTestId('drafting-action-launch').getAttribute('disabled'),
    ).not.toBeNull()
  })
})

// ============================================================================
// 旧 UI 元素已彻底移除(issue 02 验收 #9)
// ============================================================================

describe('DraftingZone · 旧 UI 元素已移除', () => {
  it('不再渲染 AC checklist / 添加按钮 / 仓库 chips / 保存草稿按钮', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // AC checklist
    expect(screen.queryByTestId('drafting-ac')).toBeNull()
    expect(screen.queryByTestId('drafting-ac-add')).toBeNull()
    expect(screen.queryByTestId('drafting-ac-item')).toBeNull()
    // 仓库多选
    expect(screen.queryByTestId('drafting-repos')).toBeNull()
    // 旧保存草稿 action
    expect(screen.queryByTestId('drafting-action-save')).toBeNull()
    // 旧"创建并启动 AI 分析"
    expect(screen.queryByTestId('drafting-action-cancel')).toBeNull()
    expect(screen.queryByTestId('drafting-form-missing')).toBeNull()
  })
})