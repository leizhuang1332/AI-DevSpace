import { describe, it, expect, afterEach, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, cleanup, within, act, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftingZone } from '@/components/drafting-zone'
import {
  emptyDrafting,
  getDraftingData,
  DEFAULT_PRD_RATIO,
  AUX_PANE_MIN_HEIGHT_PX,
  SPLIT_RESIZER_HEIGHT_PX,
} from '@/lib/drafting'
import { generatePrdSkeleton } from '@ai-devspace/shared'

// ============================================================================
// jsdom polyfills
// ============================================================================
// jsdom 不带 PointerEvent 与 ResizeObserver;DraftingZone 用后者测容器高度,
// DraggableDivider 用前者接收拖拽。本测试文件提供最小 polyfill,仅在测试环境
// 生效。

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

  if (typeof ResizeObserver === 'undefined') {
    class ResizeObserverPolyfill {
      private cb: ResizeObserverCallback
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      observe(_target: any) {
        // 不主动回调;测试如需触发,通过 stub getBoundingClientRect 实现
      }
      unobserve() {}
      disconnect() {}
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).ResizeObserver = ResizeObserverPolyfill
  }
})

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

  it('标题只读 hero 渲染(data.title 大字号显示),不再有 title input', async () => {
    // issue 04 ticket:title 在 DRAFTING 里只读,由 NewRequirementModal 一次性写入
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // 原 input 形态的 testid 不再存在(ticket 明确要求)
    expect(screen.queryByTestId('drafting-title')).toBeNull()

    // 只读 hero 显示 data.title
    // 注:同名文案也出现在面包屑 + 锚点条 H1,所以用 within 限定到 hero 内查找
    const hero = screen.getByTestId('drafting-title-hero')
    expect(hero).toBeInTheDocument()
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe(
      '退款功能优化',
    )
    // hero 含副标题
    expect(within(hero).getByText('你在写这个需求')).toBeInTheDocument()
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
// 编辑交互(issue 02 验收 #3 + issue 04 ticket 收窄)
// ============================================================================
// issue 04 ticket:title 不再受控,本 describe 仅覆盖 PRD Markdown 的受控编辑。
// title 的 hero 只读展示已在上面的 "标题只读 hero 渲染" 用例中覆盖。

describe('DraftingZone · 受控编辑', () => {
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

  it('title hero 在 PRD 编辑后仍显示原 data.title(不跟随 PRD 变化)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // PRD 改写 → 标题 hero 不变
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    await user.click(prd)
    await user.keyboard('\n# 在 PRD 内新写的 H1')

    // hero 仍展示 NewRequirementModal 写入的原 title(在 hero 内查找以避开 anchor / crumb 同名文本)
    const hero = screen.getByTestId('drafting-title-hero')
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe(
      '退款功能优化',
    )
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
    // issue 04 ticket:title 不再受控,只需清空 PRD
    const prd = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    fireEvent.change(prd, { target: { value: '' } })

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

  it('PRD 全空白 → 按钮 disabled + launchDisabledHint = "请填写 PRD Markdown"', async () => {
    // issue 04 ticket:title 不再受控,只 PRD 决定 canLaunch
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.clear(screen.getByTestId('drafting-prd'))
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()

    await user.click(btn)
    expect(routerPush).not.toHaveBeenCalled()

    // ticket 验收 #3:launchDisabledHint === '请填写 PRD Markdown'
    expect(screen.getByTestId('drafting-launch-disabled-hint').textContent).toBe(
      '请填写 PRD Markdown',
    )
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
    // 用 empty=false + PRD='' 模拟"PRD 真为空"的 disabled 场景
    // (emptyDrafting + empty=true 会触发骨架填充,会让按钮反而 enabled)
    render(
      <DraftingZone
        data={{
          ...emptyDrafting('NEW'),
          prdMarkdown: '',
          empty: false,
        }}
      />,
    )
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
  it('empty=true → launch 按钮 disabled + PRD 字段被骨架填充 + title hero 显示 "未命名需求"', () => {
    // 用 PRD=空白 + empty=false 模拟"PRD 真为空 + 不可被骨架填充"的场景
    // (如果保留 empty=true,DraftingPrdPane 的 mount 副作用会触发骨架填充 →
    // PRD 不空 → launch 反而 enabled,覆盖本用例的 disabled 断言)
    const data = {
      ...emptyDrafting('NEW'),
      prdMarkdown: '   \n   ', // 空白 PRD:满足 validateLaunch 的 trim 非空判断为 false
      empty: false,
    }
    render(<DraftingZone data={data} />)

    expect(screen.getByTestId('drafting-zone').getAttribute('data-empty')).toBe(
      'false',
    )
    // issue 04 ticket:title 不再受控 → 不再有 input;hero 显示 "未命名需求" 兜底文案
    expect(screen.queryByTestId('drafting-title')).toBeNull()
    // 仅在 hero 内查找,避开 anchor bar 等其它出现 "未命名需求" 的位置
    const hero = screen.getByTestId('drafting-title-hero')
    expect(within(hero).getByRole('heading', { level: 1 }).textContent).toBe(
      '未命名需求',
    )
    // PRD 仍是空白 → launch 按钮 disabled
    expect(
      screen.getByTestId('drafting-action-launch').getAttribute('disabled'),
    ).not.toBeNull()
    // launchDisabledHint 文案统一为「请填写 PRD Markdown」(issue 04 ticket)
    expect(screen.getByTestId('drafting-launch-disabled-hint').textContent).toBe(
      '请填写 PRD Markdown',
    )
  })

  it('empty=true + PRD 为空 → mount 后骨架填充 + PRD 出现 + launch enabled', () => {
    // 验证 mount 时骨架仍会触发(issue 02 行为不变)
    render(<DraftingZone data={emptyDrafting('NEW')} />)

    // 骨架在 mount 时通过 useEffect 填入,render 调用后已 flush
    expect(
      (screen.getByTestId('drafting-prd') as HTMLTextAreaElement).value,
    ).toContain('## 背景')
    // PRD 有内容 → 按钮 enabled
    expect(
      screen.getByTestId('drafting-action-launch').getAttribute('disabled'),
    ).toBeNull()
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

// ============================================================================
// PRD 锚点条(issue 03 端到端集成 —— 验收 #1 #2 #3 #4 #5 #6 #7)
// ============================================================================

describe('DraftingZone · PRD 锚点条 (issue 03)', () => {
  // 验收 #1:horizontal 锚点条渲染在 PRD 编辑器之上
  it('锚点条挂载在 PRD 编辑器之上', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const field = document.querySelector(
      '[data-testid="drafting-field"][data-field-label="PRD Markdown"]',
    ) as HTMLElement
    const bar = screen.getByTestId('prd-anchor-bar')
    const editor = screen.getByTestId('drafting-editor')

    // bar 与 editor 都在 field 之后
    expect(field).not.toBeNull()
    expect(
      (field.compareDocumentPosition(bar) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true)
    expect(
      (field.compareDocumentPosition(editor) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true)
    // bar 在 editor 之前(DOM 顺序)
    expect(
      (bar.compareDocumentPosition(editor) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true)
  })

  // 验收 #2:列出 H1 + H2,忽略更深
  it('退款项 PRD 骨架 → 锚点条列出 H1 + 4 个 H2', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const items = screen.getAllByTestId('anchor-item')
    expect(items).toHaveLength(5) // 1 H1 + 4 H2 (背景 / 目标 / 验收标准 / 非目标)
    expect(items[0].getAttribute('data-anchor-title')).toBe('退款功能优化')
    expect(items[1].getAttribute('data-anchor-title')).toBe('背景')
    expect(items[2].getAttribute('data-anchor-title')).toBe('目标')
    expect(items[3].getAttribute('data-anchor-title')).toBe('验收标准')
    expect(items[4].getAttribute('data-anchor-title')).toBe('非目标')
  })

  // 验收 #3:实时更新
  it('编辑 PRD 删除一个 H2 → 锚点条立刻少一个', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    expect(screen.getAllByTestId('anchor-item')).toHaveLength(5)

    // 用 fireEvent 把 textarea 改成只剩 H1
    fireEvent.change(screen.getByTestId('drafting-prd'), {
      target: { value: '# 仅 H1\n' },
    })

    expect(screen.getAllByTestId('anchor-item')).toHaveLength(1)
    expect(
      screen.getByTestId('anchor-item').getAttribute('data-anchor-title'),
    ).toBe('仅 H1')
  })

  // 验收 #4:无 H1/H2 → bar 隐藏
  it('PRD 全是普通段落(无 # 标题) → 锚点条不渲染', async () => {
    const data = await getDraftingData('req-001')
    render(
      <DraftingZone
        data={{
          ...data,
          prdMarkdown:
            '这是普通段落\n不是标题\n另一段\n#notheading (无空格)\n> # 引用里的 # 不算',
          empty: false,
        }}
      />,
    )
    expect(screen.queryByTestId('prd-anchor-bar')).toBeNull()
  })

  // 验收 #5:点击 anchor → textarea selectionStart 推到目标行
  it('点击 anchor → textarea 的 selectionStart 移到目标行', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const ta = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    // "背景" 在骨架 line 2 ( # 退款 \n \n ## 背景 ... )
    // 前两行 = "# 退款功能优化" + "" → charOffset = len + 1 + 0 + 1 = len(# 退款功能优化) + 2
    const expectedOffset =
      '# 退款功能优化'.length + 1 + ''.length + 1
    expect(expectedOffset).toBeGreaterThan(0)

    const items = screen.getAllByTestId('anchor-item')
    await user.click(items[1]) // H2 背景

    expect(ta.selectionStart).toBe(expectedOffset)
    expect(ta.selectionEnd).toBe(expectedOffset)
  })

  // 验收 #6 + #7:1.5s 高亮窗口(focus on zone 端到端)
  // 仅这条用 fake timers:userEvent.keyboard 与 fake timers 时序不稳,
  // 所以 fake 限定在该用例范围(try/finally 收尾)
  it('点击 anchor → data-highlighted="true";1500ms 后清除', async () => {
    vi.useFakeTimers()
    try {
      const data = await getDraftingData('req-001')
      render(<DraftingZone data={data} />)

      const target = screen.getAllByTestId('anchor-item')[1] // H2 背景
      expect(target.getAttribute('data-highlighted')).toBe('false')

      act(() => {
        target.click()
      })
      expect(target.getAttribute('data-highlighted')).toBe('true')

      // 1499ms 还高亮
      act(() => {
        vi.advanceTimersByTime(1_499)
      })
      expect(target.getAttribute('data-highlighted')).toBe('true')

      // 1500ms 清掉
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(target.getAttribute('data-highlighted')).toBe('false')
    } finally {
      vi.useRealTimers()
    }
  })

  // 验收 #7:键盘激活(zone 端到端)
  it('Enter 键 → 触发跳转 + selectionStart 移到目标行', async () => {
    // 高亮窗口由 PrdAnchorBar 单元测试用 fake timers 覆盖;
    // 端到端这里只用真实 timer,验证"键盘 Enter → onJumpTo"链路接通父组件。
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const ta = screen.getByTestId('drafting-prd') as HTMLTextAreaElement
    // H2 目标 在骨架 line 6;其字符偏移 = #退款+空+## 背景+(正文+空)×2+## 目标
    // 估算在 ~30 以内
    const target = screen.getAllByTestId('anchor-item')[2] // H2 目标

    target.focus()
    await user.keyboard('{Enter}')

    // selectionStart 被推到目标行(line 6)的字符偏移
    expect(ta.selectionStart).toBeGreaterThan(0)
  })
})

// ============================================================================
// issue 04 · 辅助文件卡片 + 拖拽分割(端到端集成)
// ============================================================================
//
// 关键设计点:
// - DraftingZone 在 mount 时用 ResizeObserver 实测 split-row 容器高度,
//   用该高度计算 clampSplitRatio 后的 effectiveRatio(控制 PRD/aux 的 flexGrow)
// - jsdom 不带 ResizeObserver,我们注入一个 no-op polyfill + window resize
//   手动触发 measure → setContainerHeight
// - 当容器高度 = 0(unmeasured 状态),effectiveRatio = prdRatio = 0.6(默认值)
// - 测试"拖拽"用键盘 ArrowDown / ArrowUp 更稳定;真实 mouse drag 在
//   单元测试中需要精确控制 clientY,jsdom 模拟起来不如键盘直接
//
// 验收清单(对照 issue 04 acceptance criteria):
// #1 辅助文件面板在 PRD 下方
// #2 每条 AuxFile 渲染为卡片,带 icon / filename / usage tag
// #3 拖拽条存在 + hover row-resize cursor
// #4 拖拽改变 ratio(用键盘 ArrowDown 验证)
// #5 默认 60/40(data-prd-ratio)
// #6 最小行 floor(用极小容器高度模拟)
// #7 空态 → dashed 占位
// #8 视觉匹配 19-final-drafting.html(类名 / testid 路径一致即可,不渲染真实浏览器)
// #9 tests cover(本 describe 覆盖 #1 #2 #3 #4 #6 #7)

describe('DraftingZone · 辅助文件卡片 + 拖拽分割 (issue 04)', () => {
  // 工具:模拟 split-row 容器高度 = h,触发 DraftingZone 的 measure() 重读
  function stubSplitRowHeight(heightPx: number) {
    // jsdom 下 ResizeObserver polyfill 不会主动回调,所以改用 dispatchEvent
    // window 'resize' 来触发 DraftingZone 的 measure 副作用。
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      // 仅对 split-row 元素返回指定高度;其它元素用默认 0
      if (
        this instanceof HTMLElement &&
        this.getAttribute('data-testid') === 'drafting-split-row'
      ) {
        return {
          width: 800,
          height: heightPx,
          top: 0,
          left: 0,
          right: 800,
          bottom: heightPx,
          x: 0,
          y: 0,
          toJSON() {
            return {}
          },
        } as DOMRect
      }
      return original.call(this)
    }
    return () => {
      Element.prototype.getBoundingClientRect = original
    }
  }

  afterEach(() => {
    // 清理:把 getBoundingClientRect 还原(在 stubSplitRowHeight 测试中 restore)
  })

  // -------------------------------------------------------------------------
  // 验收 #1 辅助文件面板在 PRD 下方
  // -------------------------------------------------------------------------
  it('PRD 卡片与 aux-files-pane 同时渲染(PRD 在上,aux 在下)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    // PRD 卡片还在(issue 02 / 03 不回归)
    expect(screen.getByTestId('drafting-prd-pane')).toBeInTheDocument()
    // issue 04 新增:辅助文件面板
    expect(screen.getByTestId('aux-files-pane')).toBeInTheDocument()

    // 顺序:PRD wrapper 在 aux wrapper 之前(DOM 顺序 = 视觉顺序)
    const prdWrapper = screen.getByTestId('drafting-prd-wrapper')
    const auxWrapper = screen.getByTestId('drafting-aux-wrapper')
    expect(
      (prdWrapper.compareDocumentPosition(auxWrapper) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
    ).toBe(true)
  })

  it('split-row 容器 + 拖拽条存在', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    expect(screen.getByTestId('drafting-split-row')).toBeInTheDocument()
    expect(screen.getByTestId('split-resizer')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 验收 #2 卡片渲染
  // -------------------------------------------------------------------------
  it('auxFiles 列表 → 渲染对应数量的 aux-card', async () => {
    const data = await getDraftingData('req-001')
    // req-001 mock 有 4 个 aux files
    expect(data.auxFiles).toHaveLength(4)
    render(<DraftingZone data={data} />)

    const cards = screen.getAllByTestId('aux-card')
    expect(cards).toHaveLength(4)
    const ids = cards.map((c) => c.getAttribute('data-aux-id'))
    expect(ids).toEqual([
      'aux-api-draft',
      'aux-data-model',
      'aux-existing-flow',
      'aux-competitor',
    ])
  })

  it('每张卡片显示 filename + usage tag 文本', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const allCards = screen.getAllByTestId('aux-card')
    const apiCardEl = allCards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-api-draft',
    ) as HTMLElement
    expect(within(apiCardEl).getByTestId('aux-card-filename').textContent).toBe(
      'api-draft.md',
    )
    expect(within(apiCardEl).getByTestId('aux-card-usage-tag').textContent).toBe(
      'API 草案',
    )

    const dataCardEl = allCards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-data-model',
    ) as HTMLElement
    expect(
      within(dataCardEl).getByTestId('aux-card-usage-tag').textContent,
    ).toBe('数据字典')

    const sopCardEl = allCards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-existing-flow',
    ) as HTMLElement
    expect(within(sopCardEl).getByTestId('aux-card-usage-tag').textContent).toBe(
      'SOP',
    )

    const researchCardEl = allCards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-competitor',
    ) as HTMLElement
    expect(
      within(researchCardEl).getByTestId('aux-card-usage-tag').textContent,
    ).toBe('调研')
  })

  it('docx / pdf 源 + converted=true → 显示 "↻ 已转 MD"', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const cards = screen.getAllByTestId('aux-card')
    const sopCard = cards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-existing-flow',
    ) as HTMLElement
    expect(within(sopCard).getByTestId('aux-card-converted')).toHaveTextContent(
      /已转 MD/,
    )

    // md 源 + converted=false → 不显示
    const apiCard = cards.find(
      (c) => c.getAttribute('data-aux-id') === 'aux-api-draft',
    ) as HTMLElement
    expect(within(apiCard).queryByTestId('aux-card-converted')).toBeNull()
  })

  it('点击卡片 → 打开 aux-drawer(issue 05 接线)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 抽屉初始不存在(openAuxId=null)
    expect(screen.queryByTestId('aux-drawer')).toBeNull()

    const cards = screen.getAllByTestId('aux-card')
    await user.click(cards[0]) // aux-api-draft

    // 抽屉已渲染,且显示对应文件
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(
      screen.getByTestId('aux-drawer-filename').textContent,
    ).toBe('api-draft.md')
  })

  // -------------------------------------------------------------------------
  // 验收 #3 拖拽条存在 + row-resize cursor
  // -------------------------------------------------------------------------
  it('拖拽条带 cursor-row-resize', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const resizer = screen.getByTestId('split-resizer')
    expect(resizer.className).toContain('cursor-row-resize')
  })

  it('拖拽条 role=separator', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    expect(screen.getByTestId('split-resizer').getAttribute('role')).toBe(
      'separator',
    )
  })

  // -------------------------------------------------------------------------
  // 验收 #4 拖拽改变 ratio + 立即反映
  // 验收 #5 默认 60/40
  // -------------------------------------------------------------------------
  it('默认 prdRatio = 0.6(验收 #5)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const zone = screen.getByTestId('drafting-zone')
    expect(zone.getAttribute('data-prd-ratio')).toBe(String(DEFAULT_PRD_RATIO))
    expect(DEFAULT_PRD_RATIO).toBeCloseTo(0.6, 5)
  })

  it('键盘 ArrowDown(1% × N)→ data-prd-ratio 同步增长', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()
    const resizer = screen.getByTestId('split-resizer')

    resizer.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')

    const zone = screen.getByTestId('drafting-zone')
    expect(Number(zone.getAttribute('data-prd-ratio'))).toBeCloseTo(0.63, 5)
  })

  it('键盘 ArrowUp → ratio 减小', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()
    const resizer = screen.getByTestId('split-resizer')

    resizer.focus()
    await user.keyboard('{ArrowUp}')

    const zone = screen.getByTestId('drafting-zone')
    expect(Number(zone.getAttribute('data-prd-ratio'))).toBeCloseTo(0.59, 5)
  })

  it('键盘 PageDown(5%)→ ratio 增大 0.05', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()
    const resizer = screen.getByTestId('split-resizer')

    resizer.focus()
    await user.keyboard('{PageDown}')

    const zone = screen.getByTestId('drafting-zone')
    expect(Number(zone.getAttribute('data-prd-ratio'))).toBeCloseTo(0.65, 5)
  })

  it('键盘 Home → ratio 跳到 min', async () => {
    const restore = stubSplitRowHeight(1200)
    try {
      const data = await getDraftingData('req-001')
      render(<DraftingZone data={data} />)
      // 触发 window resize 让 DraftingZone 重测高度
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      const user = userEvent.setup()
      const resizer = screen.getByTestId('split-resizer')
      resizer.focus()
      await user.keyboard('{Home}')

      const zone = screen.getByTestId('drafting-zone')
      const minRatio = SPLIT_RESIZER_HEIGHT_PX / (1200 - SPLIT_RESIZER_HEIGHT_PX)
      expect(Number(zone.getAttribute('data-prd-ratio'))).toBeCloseTo(
        minRatio,
        3,
      )
    } finally {
      restore()
    }
  })

  it('键盘 End → ratio 跳到 max', async () => {
    const restore = stubSplitRowHeight(1200)
    try {
      const data = await getDraftingData('req-001')
      render(<DraftingZone data={data} />)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      const user = userEvent.setup()
      const resizer = screen.getByTestId('split-resizer')
      resizer.focus()
      await user.keyboard('{End}')

      const zone = screen.getByTestId('drafting-zone')
      const maxRatio =
        1 - AUX_PANE_MIN_HEIGHT_PX / (1200 - SPLIT_RESIZER_HEIGHT_PX)
      expect(Number(zone.getAttribute('data-prd-ratio'))).toBeCloseTo(
        maxRatio,
        3,
      )
    } finally {
      restore()
    }
  })

  // -------------------------------------------------------------------------
  // 验收 #6 最小行 floor —— 即使 prdRatio 极大,aux 仍 ≥ 行卡片高
  // -------------------------------------------------------------------------
  it('容器较小 → effectiveRatio 被 clamp,aux flexGrow 不为负', async () => {
    // 容器 800px:usable = 794px;maxPrdRatio = 1 - 140/794 ≈ 0.824
    const restore = stubSplitRowHeight(800)
    try {
      const data = await getDraftingData('req-001')
      render(<DraftingZone data={data} />)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      // 键盘 End 把 prdRatio 推到最大
      const user = userEvent.setup()
      const resizer = screen.getByTestId('split-resizer')
      resizer.focus()
      await user.keyboard('{End}')

      const zone = screen.getByTestId('drafting-zone')
      const effectivePrd = Number(zone.getAttribute('data-effective-prd-ratio'))
      const effectiveAux = 1 - effectivePrd

      // aux flexGrow 必须 > 0(至少保留 floor)
      expect(effectiveAux).toBeGreaterThan(0)
      // aux 实际高度 = 800 * effectiveAux ≥ AUX_PANE_MIN_HEIGHT_PX
      expect(800 * effectiveAux).toBeGreaterThanOrEqual(
        AUX_PANE_MIN_HEIGHT_PX - 0.01,
      )
    } finally {
      restore()
    }
  })

  it('容器 200px 极小 → aux 仍 ≥ AUX_PANE_MIN_HEIGHT_PX', async () => {
    const restore = stubSplitRowHeight(200)
    try {
      const data = await getDraftingData('req-001')
      render(<DraftingZone data={data} />)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      const user = userEvent.setup()
      const resizer = screen.getByTestId('split-resizer')
      resizer.focus()
      // 反复 End 推到 max
      await user.keyboard('{End}')

      const zone = screen.getByTestId('drafting-zone')
      const effectivePrd = Number(zone.getAttribute('data-effective-prd-ratio'))
      const auxHeight = 200 * (1 - effectivePrd)
      // clampSplitRatio 保证 aux ≥ AUX_PANE_MIN_HEIGHT_PX
      expect(auxHeight).toBeGreaterThanOrEqual(AUX_PANE_MIN_HEIGHT_PX - 0.01)
    } finally {
      restore()
    }
  })

  // -------------------------------------------------------------------------
  // 验收 #7 空态 → dashed 占位卡
  // -------------------------------------------------------------------------
  it('emptyDrafting() → auxFiles=[] → 渲染 EmptyAuxPlaceholder', () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    expect(screen.getByTestId('aux-empty-placeholder')).toBeInTheDocument()
    expect(screen.queryAllByTestId('aux-card')).toHaveLength(0)
    // pane 也标记 data-empty="true"
    expect(
      screen.getByTestId('aux-files-pane').getAttribute('data-empty'),
    ).toBe('true')
  })

  it('空态点击占位卡 → 打开新建对话框(issue 06)', async () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    const user = userEvent.setup()
    // 点击前对话框不存在
    expect(screen.queryByTestId('new-aux-dialog')).toBeNull()
    await user.click(screen.getByTestId('aux-empty-placeholder'))
    expect(screen.getByTestId('new-aux-dialog')).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // 回归:issue 02/03 的 PRD / 锚点条测试在 issue 04 改造后仍通过
  // -------------------------------------------------------------------------
  it('issue 02 验收仍通过:PRD 卡片 + 锚点条 + ANALYZING 跳转', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // PRD 卡片 + 锚点条 + 启动按钮
    expect(screen.getByTestId('drafting-prd-card')).toBeInTheDocument()
    expect(screen.getByTestId('prd-anchor-bar')).toBeInTheDocument()
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).toBeNull()

    await user.click(btn)
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-001/analyzing/')
  })
})

// ============================================================================
// issue 05 · 辅助文件抽屉(端到端集成)
//
// 验收清单(对照 issue 05 acceptance criteria):
// #1  点击卡片打开抽屉
// #2  60% 宽度 + min/max width(由 AuxDrawer 单测覆盖;这里走存在性)
// #3  半透明 backdrop,点击关闭(由 AuxDrawer 单测覆盖;这里走存在性)
// #4  Escape 关闭(由 AuxDrawer 单测覆盖)
// #5  dialog 语义 + 可见关闭按钮(由 AuxDrawer 单测覆盖)
// #6  抽屉宿主 Markdown 编辑器,编辑更新该文件状态
// #7  与 PRD 共 30s 自动保存(由 AuxDrawer 单测覆盖)
// #8  关闭再开同一文件 → 内容恢复
// #9  唯一抽屉:打开第二个文件时切换
// #10 视觉匹配 19-final-drafting.html(类名 / testid 一致即可)
// #11 tests cover — 本 describe 覆盖 #1 #6 #8 #9
// ============================================================================

describe('DraftingZone · 辅助文件抽屉 (issue 05)', () => {
  it('验收 #1:点击卡片 → 抽屉打开显示该文件', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 打开前不存在
    expect(screen.queryByTestId('aux-drawer')).toBeNull()

    // 点击第 1 张(api-draft.md)
    const cards = screen.getAllByTestId('aux-card')
    await user.click(cards[0])

    // 抽屉展示对应文件名
    expect(screen.getByTestId('aux-drawer')).toBeInTheDocument()
    expect(
      screen.getByTestId('aux-drawer-filename').textContent,
    ).toBe('api-draft.md')
  })

  it('验收 #6:抽屉内的编辑 → 该文件持久化(关闭再开仍存在)', async () => {
    const data = await getDraftingData('req-001')
    const { rerender } = render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 打开抽屉
    await user.click(screen.getAllByTestId('aux-card')[0])
    const ta = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    const original = ta.value
    fireEvent.change(ta, { target: { value: original + '\n> 修改痕迹' } })
    expect(ta.value).toContain('> 修改痕迹')

    // 关闭抽屉
    await user.click(screen.getByTestId('aux-drawer-close'))
    expect(screen.queryByTestId('aux-drawer')).toBeNull()

    // 重新打开同一文件 → 内容仍在
    await user.click(screen.getAllByTestId('aux-card')[0])
    const reopened = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    expect(reopened.value).toContain('> 修改痕迹')
    expect(reopened.value).not.toBe(original)
  })

  it('验收 #9:唯一抽屉 — 打开第二个文件 → 自动切换', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 先开 aux-1
    const cards = screen.getAllByTestId('aux-card')
    await user.click(cards[0]) // aux-api-draft
    expect(
      screen.getByTestId('aux-drawer-filename').textContent,
    ).toBe('api-draft.md')

    // 直接点另一张卡片(不点 close)→ 应只显示一个抽屉 + 内容切换
    await user.click(cards[1]) // aux-data-model
    expect(screen.queryByTestId('aux-drawer')).toBeInTheDocument()
    expect(
      screen.getByTestId('aux-drawer-filename').textContent,
    ).toBe('data-model.md')
    // 仍只有一个抽屉(物理上 DOM 中也只有一个 backdrop)
    expect(screen.queryAllByTestId('aux-drawer-backdrop')).toHaveLength(1)
  })

  it('验收 #8:打开 → 编辑 → 关闭 → 切到另一个文件 → 切回 → 该文件内容恢复', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 1) 打开第一张并编辑
    const cards = screen.getAllByTestId('aux-card')
    await user.click(cards[0])
    const ta1 = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    fireEvent.change(ta1, { target: { value: 'X-' + data.auxFiles[0].body } })

    // 2) 不点 close,直接点另一张
    await user.click(cards[1])
    const ta2 = screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement
    expect(ta2.value).toBe(data.auxFiles[1].body) // 第二张是没编辑过的原值
    // 编辑第二张
    fireEvent.change(ta2, { target: { value: 'Y-' + data.auxFiles[1].body } })

    // 3) 关掉抽屉
    await user.click(screen.getByTestId('aux-drawer-close'))
    expect(screen.queryByTestId('aux-drawer')).toBeNull()

    // 4) 重新打开第一张 → 内容恢复为 X-...
    await user.click(cards[0])
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('X-' + data.auxFiles[0].body)

    // 5) 切到第二张 → 内容恢复为 Y-...
    await user.click(cards[1])
    expect(
      (screen.getByTestId('aux-drawer-editor') as HTMLTextAreaElement).value,
    ).toBe('Y-' + data.auxFiles[1].body)
  })

  it('不在 issue 04 验收测试失败的回归', async () => {
    // 关闭抽屉不抛错
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()
    await user.click(screen.getAllByTestId('aux-card')[0])
    await user.click(screen.getByTestId('aux-drawer-close'))
    // 卸载组件
    cleanup()
    expect(data.auxFiles).toHaveLength(4)
  })

  it('空数据(empty=true)下点击占位卡不打开抽屉(issue 06 不在本期范围)', async () => {
    render(<DraftingZone data={emptyDrafting('NEW')} />)
    const user = userEvent.setup()
    await user.click(screen.getByTestId('aux-empty-placeholder'))
    // 不应打开抽屉 — 占位是 onCreate,不在 issue 05 路径
    expect(screen.queryByTestId('aux-drawer')).toBeNull()
  })
})

// ============================================================================
// issue 08 · 仓库底部条 + 软警告 + 启动按钮迁入(端到端集成)
//
// 验收清单(对照 issue 08 acceptance criteria):
// #1  sticky 底部条在工作区底部
// #2  条包含 chips + 软警告区 + ▶ 进入 ANALYZING 按钮
// #3  条在垂直滚动时仍然可见(sticky)
// #4  0 / 1 个仓库 → 警告 ⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文
// #5  ≥ 2 个仓库 → 警告隐藏
// #6  警告纯视觉:launch 按钮 enabled 由 title + PRD 决定,与仓库数量无关
// #7  切换 chip → 同一 render 内更新警告可见性
// #8  视觉匹配 19-final-drafting.html(.repo-bar 类名 / testid 路径一致)
// #9  tests cover —— 本 describe 覆盖 #1 #2 #4 #5 #6 #7
// ============================================================================

describe('DraftingZone · 仓库底部条 + 软警告 (issue 08)', () => {
  // 验收 #1 #2 sticky 底部条 + 三段式布局(chips / 警告 / 启动按钮)
  it('验收 #1+#2:repo-bar 渲染于工作区底部,包含 chips / 软警告区 / 启动按钮', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar).toBeInTheDocument()
    // sticky bottom —— 设计稿一致
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('bottom-0')
    // 三段都在
    expect(within(bar).getByTestId('drafting-repo-bar-label')).toBeInTheDocument()
    expect(within(bar).getByTestId('drafting-repo-bar-chips')).toBeInTheDocument()
    expect(within(bar).getByTestId('drafting-action-launch')).toBeInTheDocument()

    // chip 渲染数量 = 真实仓库数(req-001 mock 有 5 个 repos,但其中
    // 「＋ 更多仓库…」占位被 issue 01 ticket 过滤,实际渲染 4 个 chips)
    const chips = within(bar).getAllByTestId('drafting-repo-chip')
    expect(chips.length).toBeGreaterThan(0)
    expect(chips).toHaveLength(
      data.repos.filter((r) => !r.name.startsWith('＋')).length,
    )
    // repo-bar 节点上 data 齐全
    expect(bar.getAttribute('data-repo-count')).toBe(String(data.repos.length))
    expect(bar.getAttribute('data-selected-count')).toBe(
      String(data.selectedRepoIds.length),
    )
  })

  // 验收 #4 0 个仓库 → 警告显示
  it('验收 #4:0 个仓库 → 软警告 ⚠ 仅 0 个仓库 · … 显示', async () => {
    const data = {
      ...emptyDrafting('req-empty'),
      // 0 仓库:显式覆盖 repos=[] + selectedRepoIds=[](emptyDrafting 自带
      // GLOBAL_REPO_POOL 5 个 repo;这里覆盖回 0 模拟 issue 08 时代场景)
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [],
      selectedRepoIds: [],
    }
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('0')
    const warn = screen.getByTestId('drafting-repo-soft-warning')
    expect(warn.textContent).toContain('⚠ 仅 0 个仓库')
    expect(warn.textContent).toContain('ANALYZING 可能无法完整关联代码上下文')
    // chips 容器是 empty 占位(issue 01 ticket 新 testid)
    expect(screen.getByTestId('repo-bar-empty')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-add')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-empty-hint')).toBeInTheDocument()
    expect(screen.queryAllByTestId('drafting-repo-chip')).toHaveLength(0)
  })

  // 验收 #4 1 个仓库 → 警告显示
  it('验收 #4:1 个仓库 → 软警告 ⚠ 仅 1 个仓库 · … 显示', async () => {
    const data = {
      ...emptyDrafting('req-one'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: ['r1'],
    }
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('1')
    const warn = screen.getByTestId('drafting-repo-soft-warning')
    expect(warn.getAttribute('data-warning-count')).toBe('1')
    expect(warn.textContent).toContain('⚠ 仅 1 个仓库')
  })

  // 验收 #5 2 个仓库 → 警告隐藏
  it('验收 #5:2 个仓库 → 软警告隐藏', async () => {
    const data = {
      ...emptyDrafting('req-two'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: ['r1', 'r2'],
    }
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('false')
    expect(bar.getAttribute('data-selected-count')).toBe('2')
    expect(screen.queryByTestId('drafting-repo-soft-warning')).toBeNull()
  })

  it('验收 #5:3+ 仓库 → 软警告仍隐藏', async () => {
    const data = {
      ...emptyDrafting('req-three'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
        { id: 'r3', name: 'coupon-service' },
      ],
      selectedRepoIds: ['r1', 'r2', 'r3'],
    }
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('false')
  })

  // 验收 #7 同一 render 内更新警告可见性
  it('验收 #7:点击 chip 切换 → 软警告在同一 render 内更新', async () => {
    // 起始:2 个仓库 → 警告隐藏
    const data = {
      ...emptyDrafting('req-toggle'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: ['r1', 'r2'],
    }
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('false')

    // 取消勾选 r2 → 仅剩 1 个仓库 → 警告出现
    const r2 = screen.getAllByTestId('drafting-repo-chip').find(
      (c) => c.getAttribute('data-repo-id') === 'r2',
    ) as HTMLElement
    await user.click(r2)

    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('1')
    expect(screen.getByTestId('drafting-repo-soft-warning')).toBeInTheDocument()

    // 再取消 r1 → 0 个仓库 → 警告依然显示;此时 RepoBar 进入 N=0 空态
    // (issue 01 ticket 扩展:chips 被替换为 add button + hint)
    const r1 = screen.getAllByTestId('drafting-repo-chip').find(
      (c) => c.getAttribute('data-repo-id') === 'r1',
    ) as HTMLElement
    await user.click(r1)
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('0')
    // chips 已不在 DOM(被 N=0 空态替换)
    expect(screen.queryByTestId('drafting-repo-chip')).toBeNull()
    expect(screen.getByTestId('repo-bar-empty')).toBeInTheDocument()
    expect(screen.getByTestId('repo-bar-add')).toBeInTheDocument()

    // 从 N=0 回到 N≥1 需要走 RepoBar ＋ 按钮(banner [+] 同样入口);
    // 此处不展开 attach-repos-dialog 的内部断言,只验证「点 ＋ → 弹层打开」
    await user.click(screen.getByTestId('repo-bar-add'))
    expect(screen.getByTestId('attach-repos-dialog')).toBeInTheDocument()
    expect(
      screen.getByTestId('attach-repos-dialog-title').textContent,
    ).toContain('关联仓库')

    // 关闭弹层
    await user.click(screen.getByTestId('attach-repos-dialog-cancel'))
    expect(screen.queryByTestId('attach-repos-dialog')).toBeNull()

    // 警告状态仍在(0 个仓库 → 警告显示)
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    expect(bar.getAttribute('data-selected-count')).toBe('0')
  })

  it('验收 #7 同步性:chip data-selected 跟随 selectedRepoIds 切换', async () => {
    const data = {
      ...emptyDrafting('req-chip-sync'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: ['r1'],
    }
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    const chips = screen.getAllByTestId('drafting-repo-chip')
    const r1 = chips.find(
      (c) => c.getAttribute('data-repo-id') === 'r1',
    ) as HTMLElement
    expect(r1.getAttribute('data-selected')).toBe('true')
    const r2 = chips.find(
      (c) => c.getAttribute('data-repo-id') === 'r2',
    ) as HTMLElement
    expect(r2.getAttribute('data-selected')).toBe('false')

    await user.click(r2)
    expect(r2.getAttribute('data-selected')).toBe('true')

    await user.click(r1)
    expect(r1.getAttribute('data-selected')).toBe('false')
  })

  // 验收 #6 警告纯视觉 —— launch validity 与仓库数量无关
  it('验收 #6:0 仓库 + PRD 完整 → launch 按钮 enabled(警告存在但按钮不 disabled)', async () => {
    const data = {
      ...emptyDrafting('req-empty-launchable'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [],
      selectedRepoIds: [],
    }
    render(<DraftingZone data={data} />)

    // 软警告显示
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    // 但 launch 按钮 enabled
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).toBeNull()
    expect(bar.getAttribute('data-can-launch')).toBe('true')
  })

  it('验收 #6:1 仓库 + PRD 不全 → launch 按钮 disabled', async () => {
    // issue 04 ticket:title 不再受控,只 PRD 决定 canLaunch
    // 用 PRD=空白 + empty=false 阻止骨架填充(否则 PRD 会被填上 → launch 反而 enabled)
    const data = {
      ...emptyDrafting('req-one-bad'),
      prdMarkdown: '   ', // 空白 → validateLaunch.trim 非空判断为 false
      empty: false,
      repos: [{ id: 'r1', name: 'refund-service' }],
      selectedRepoIds: ['r1'],
    }
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    // 警告显示(1 个仓库)
    expect(bar.getAttribute('data-soft-warning')).toBe('true')
    // 但按钮 disabled(PRD 为空白 → canLaunch=false)
    const btn = screen.getByTestId('drafting-action-launch')
    expect(btn.getAttribute('disabled')).not.toBeNull()
    expect(bar.getAttribute('data-can-launch')).toBe('false')
    // 提示文案统一(issue 04 ticket:title 不再受控,只剩 PRD 一支)
    expect(screen.getByTestId('drafting-launch-disabled-hint').textContent).toBe(
      '请填写 PRD Markdown',
    )
  })

  // 验收 #6 #7 启动按钮从 PRD 卡片脚迁出,位置在 RepoBar 中
  it('启动按钮在 repo-bar 内部,不在 PRD 卡片内(issue 08 验收 #7)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)

    const bar = screen.getByTestId('drafting-repo-bar')
    const btn = screen.getByTestId('drafting-action-launch')
    // launch 按钮存在于 repo-bar 子树
    expect(bar.contains(btn)).toBe(true)
    // PRD 卡片脚不再渲染 launch 按钮
    const prdCard = screen.getByTestId('drafting-prd-card')
    expect(prdCard.contains(btn)).toBe(false)
  })

  // 验收 #8 视觉匹配 —— 关键 class 与 design 一致(sticky / 上边框 / bg-elevated)
  it('验收 #8:repo-bar 视觉匹配 19-final-drafting.html 的 .repo-bar', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('bottom-0')
    expect(bar.className).toContain('border-t')
    expect(bar.className).toContain('bg-bg-elevated')
  })

  // 验收 #3 条在工作区滚动时仍然可见 —— 通过 sticky bottom + flex 父级
  // 实现层 sticky;这里验证关键 CSS 已应用,真实滚动行为交给浏览器
  it('验收 #3:repo-bar 是 sticky 底部,父容器允许滚动', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('bottom-0')
    // 主区允许滚动
    expect(screen.getByTestId('drafting-main').className).toContain('overflow-auto')
  })

  // 启动按钮跳转(从 RepoBar 触发)—— issue 02 验收 #7 + issue 08 验收 #7
  it('issue 02/08 验收:launch 按钮点击 → router.push 到 ANALYZING', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('drafting-action-launch'))
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-001/analyzing/')
  })

  // 旧 UI 不再渲染(issue 08 验收:启动按钮不在 PRD 卡片脚)
  it('PRD 卡片脚不再渲染 "drafting-launch-disabled-hint"(已迁到 RepoBar)', () => {
    // 用 PRD=空白 + empty=false 阻止骨架填充,确保 canLaunch=false 触发 hint 渲染
    const data = {
      ...emptyDrafting('NEW'),
      prdMarkdown: '   ', // 空白 → canLaunch=false
      empty: false,
    }
    render(<DraftingZone data={data} />)
    const prdCard = screen.getByTestId('drafting-prd-card')
    // hint 在 RepoBar 内,不在 PRD 卡片子树
    const bar = screen.getByTestId('drafting-repo-bar')
    const hint = screen.getByTestId('drafting-launch-disabled-hint')
    expect(bar.contains(hint)).toBe(true)
    expect(prdCard.contains(hint)).toBe(false)
  })

  // issue 01 ticket:旧 issue 08 的「＋ 更多仓库…」占位 chip 已被「＋ 添加仓库…」
  // 实按钮取代;此处验证"以 '＋' 开头的占位条目**不**作为 chip 渲染,防止误判
  it('以 "＋" 开头的占位条目不渲染为 chip(issue 01 ticket 取代占位)', async () => {
    // 1 个真仓库 + 1 个 "＋ 更多仓库…" 占位(沿用 issue 08 的 fixture 形态);
    // r1 预选中以让 chips 进入 DOM,否则 N=0 空态会替换整个 chips 容器
    const data = {
      ...emptyDrafting('req-more'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r-more', name: '＋ 更多仓库…' },
      ],
      selectedRepoIds: ['r1'],
    }
    render(<DraftingZone data={data} />)

    // 占位条目不作为 chip 渲染(issue 01 ticket 取代)
    const allChips = screen.queryAllByTestId('drafting-repo-chip')
    expect(allChips.find((c) => c.getAttribute('data-repo-id') === 'r-more')).toBeUndefined()
    expect(allChips).toHaveLength(1)
    // N≥1 状态:追加按钮出现
    expect(screen.getByTestId('repo-bar-add-more')).toBeInTheDocument()
    // 但 N=0 才出现的 testid 「repo-bar-empty」不存在
    expect(screen.queryByTestId('repo-bar-empty')).toBeNull()

    // 真实仓库的初始勾选状态正确
    const r1Chip = screen
      .getAllByTestId('drafting-repo-chip')
      .find((c) => c.getAttribute('data-repo-id') === 'r1') as HTMLElement
    expect(r1Chip.getAttribute('data-selected')).toBe('true')
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-selected-count')).toBe('1')
  })

  // 启动时调用 handle.saveNow()(issue 02/08 兼容,code-review 修复)
  it('launch 按钮点击 → 触发 DraftingPrdPane.handle.saveNow()(issue 02 行为保留)', async () => {
    const data = await getDraftingData('req-001')
    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 启动前 lastSavedAt=null → 不渲染时间戳
    expect(screen.queryByTestId('drafting-autosaved')).toBeNull()

    // 启动
    await user.click(screen.getByTestId('drafting-action-launch'))

    // 启动后 lastSavedAt 应被更新(drafting-autosaved 时间戳渲染出来)
    expect(screen.getByTestId('drafting-autosaved')).toBeInTheDocument()
    // 跳转也正常触发
    expect(routerPush).toHaveBeenCalledWith('/requirements/req-001/analyzing/')
  })
})

// ============================================================================
// ticket 02 · 关联仓库 API 接入(.scratch/new-requirement-modal/issues/02)
// ============================================================================

// mock bootstrap,让真实 agentFetch 跑通;fetch mock 返回 controlled Response
const mockFetch = vi.fn()
vi.mock('@/lib/agent-bootstrap', () => ({
  hasAuthCookie: () => true,
  getOrBootstrap: vi.fn(),
  resetBootstrapCache: vi.fn(),
}))

function makeSuccessResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function makeErrorResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockAttachReposFetch(body: unknown, status = 200): void {
  mockFetch.mockReset()
  // 用 mockImplementation(每次返回**新** Response 对象):Response body 只能读一次,
  // 否则后续 fetch 调用会抛 "Body is unusable: Body has already b..."
  // —— 这是 issue 06 引入 refetch 后必须修的 mock(原 mockResolvedValue
  // 共享同一 Response,导致 dialog 打开触发的 GET /api/repos 把 body 读完,
  // 后面真 POST /api/requirement/:id/repos 拿到空 body)
  mockFetch.mockImplementation(() => {
    if (status === 200) {
      return Promise.resolve(makeSuccessResponse(body as Record<string, unknown>))
    }
    return Promise.resolve(makeErrorResponse(status, body as Record<string, unknown>))
  })
  // @ts-ignore - mock fetch
  globalThis.fetch = mockFetch
}

describe('DraftingZone · 关联仓库 API 接入 (ticket 02)', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  afterEach(() => {
    mockFetch.mockReset()
    // @ts-ignore - restore default fetch
    delete (globalThis as { fetch?: unknown }).fetch
  })

  it('全成功:fetch 200 + 2 ok=true → selectedRepoIds 合并 + lockedBranchName 写入 + banner hidden', async () => {
    const data = {
      ...emptyDrafting('req-attach-ok'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: [],
    }
    mockAttachReposFetch({
      requirementId: 'req-attach-ok',
      branchName: 'feat/refund',
      succeeded: 2,
      failed: 0,
      results: [
        { ok: true, repoId: 'r1', branch: 'feat/refund', worktreePath: '/x/r1', base: 'main' },
        { ok: true, repoId: 'r2', branch: 'feat/refund', worktreePath: '/x/r2', base: 'main' },
      ],
    })

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 打开弹层 → 填分支名 + 勾 2 个 → 提交
    await user.click(screen.getByTestId('repo-bar-add'))
    const branchInput = screen.getByTestId('attach-repos-dialog-branch')
    await user.type(branchInput, 'feat/refund')
    const checkboxes = screen.getAllByTestId('attach-repos-dialog-repo-checkbox')
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // banner 应隐藏
    await waitFor(() => {
      expect(screen.queryByTestId('drafting-banner')).toBeNull()
    })
    // selectedRepoIds 应包含 r1 + r2
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-selected-count')).toBe('2')

    // fetch 被调 2 次(issue 06 refetch + POST attach):
    // 1. attachDialogOpen 翻 true → useEffect 触发 GET /api/repos
    // 2. submit → POST /api/requirement/:id/repos
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' &&
        url.includes('/api/requirement/req-attach-ok/repos') &&
        (init as RequestInit).method === 'POST',
    )
    expect(postCall).toBeDefined()
    const [url, init] = postCall as [string, RequestInit]
    expect(url).toContain('/api/requirement/req-attach-ok/repos')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.repoIds.sort()).toEqual(['r1', 'r2'])
    expect(body.branchName).toBe('feat/refund')
  })

  it('部分成功:1 ok + 1 fail → selectedRepoIds 仅成功 + banner partial(橙色)', async () => {
    const data = {
      ...emptyDrafting('req-partial'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-service' },
        { id: 'r2', name: 'order-service' },
      ],
      selectedRepoIds: [],
    }
    mockAttachReposFetch({
      requirementId: 'req-partial',
      branchName: 'feat/x',
      succeeded: 1,
      failed: 1,
      results: [
        { ok: true, repoId: 'r1', branch: 'feat/x', worktreePath: '/x/r1', base: 'main' },
        { ok: false, repoId: 'r2', code: 'E_DISK_FULL', message: 'No space left' },
      ],
    })

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/x')
    const checkboxes = screen.getAllByTestId('attach-repos-dialog-repo-checkbox')
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // banner partial 态
    await waitFor(() => {
      expect(screen.getByTestId('drafting-banner')).toHaveAttribute('data-banner-state', 'partial')
    })
    const banner = screen.getByTestId('drafting-banner')
    expect(banner.getAttribute('data-failed-count')).toBe('1')
    expect(banner.textContent).toMatch(/已关联 1/)
    expect(banner.textContent).toMatch(/失败 1/)
    expect(banner.textContent).toContain('r2')

    // 部分成功:成功 repo 进 selectedRepoIds
    const bar = screen.getByTestId('drafting-repo-bar')
    expect(bar.getAttribute('data-selected-count')).toBe('1')

    // 「重试该 repo」按钮出现
    expect(screen.getByTestId('drafting-banner-retry-failed')).toBeInTheDocument()
  })

  it('全失败:2 ok=false → banner error + errorMessage 含 repoId', async () => {
    const data = {
      ...emptyDrafting('req-all-fail'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'r1' },
        { id: 'r2', name: 'r2' },
      ],
      selectedRepoIds: [],
    }
    mockAttachReposFetch({
      requirementId: 'req-all-fail',
      branchName: 'feat/x',
      succeeded: 0,
      failed: 2,
      results: [
        { ok: false, repoId: 'r1', code: 'E_REPO_NOT_FOUND', message: 'r1 not found' },
        { ok: false, repoId: 'r2', code: 'E_REPO_NOT_FOUND', message: 'r2 not found' },
      ],
    })

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/x')
    const checkboxes = screen.getAllByTestId('attach-repos-dialog-repo-checkbox')
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('drafting-banner')).toHaveAttribute('data-banner-state', 'error')
    })
    const banner = screen.getByTestId('drafting-banner')
    // 全失败 banner 只显示首个失败 repo(避免文案过长;详细看 failedRepoIds state)
    expect(banner.textContent).toContain('r1')
    // error 态无 partial retry 按钮
    expect(screen.queryByTestId('drafting-banner-retry-failed')).toBeNull()
  })

  it('鉴权 401 → banner error + errorMessage = "鉴权失败"(中文文案)', async () => {
    const data = {
      ...emptyDrafting('req-401'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [{ id: 'r1', name: 'r1' }],
      selectedRepoIds: [],
    }
    mockFetch.mockReset()
    // 用 mockImplementation 每次返回新 Response(issue 06 useEffect 触发的 GET 也走同一 mock)
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeErrorResponse(401, { error: 'unauthorized' })),
    )
    // @ts-ignore - mock fetch
    globalThis.fetch = mockFetch

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/x')
    await user.click(screen.getAllByTestId('attach-repos-dialog-repo-checkbox')[0])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    await waitFor(() => {
      const banner = screen.getByTestId('drafting-banner')
      expect(banner).toHaveAttribute('data-banner-state', 'error')
      expect(banner.textContent).toContain('鉴权失败')
      // 不应含 AgentError 的 JSON
      expect(banner.textContent).not.toContain('"error":"unauthorized"')
    })
  })

  it('网络错:fetch reject → banner error', async () => {
    const data = {
      ...emptyDrafting('req-network'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [{ id: 'r1', name: 'r1' }],
      selectedRepoIds: [],
    }
    mockFetch.mockReset()
    mockFetch.mockRejectedValue(new Error('Failed to fetch'))
    // @ts-ignore - mock fetch
    globalThis.fetch = mockFetch

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/x')
    await user.click(screen.getAllByTestId('attach-repos-dialog-repo-checkbox')[0])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    await waitFor(() => {
      const banner = screen.getByTestId('drafting-banner')
      expect(banner).toHaveAttribute('data-banner-state', 'error')
      expect(banner.textContent).toContain('Failed to fetch')
    })
  })

  // ticket 02 验收 #8:部分成功 → 失败 repo 标红(data-failed=true)
  it('P3:部分成功 → RepoBar 失败 chip 显示 data-failed="true" + ✕ 图标', async () => {
    const data = {
      ...emptyDrafting('req-red'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'refund-svc' },
        { id: 'r2', name: 'order-svc' },
      ],
      selectedRepoIds: [],
    }
    mockFetch.mockReset()
    // 用 mockImplementation 每次返回新 Response(issue 06 useEffect 触发的 GET 也走同一 mock)
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeSuccessResponse({
          requirementId: 'req-red',
          branchName: 'feat/red',
          succeeded: 1,
          failed: 1,
          results: [
            { ok: true, repoId: 'r1', branch: 'feat/red', worktreePath: '/x/r1', base: 'main' },
            { ok: false, repoId: 'r2', code: 'E_DISK_FULL', message: 'No space left' },
          ],
        }),
      ),
    )
    // @ts-ignore - mock fetch
    globalThis.fetch = mockFetch

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/red')
    const cbs = screen.getAllByTestId('attach-repos-dialog-repo-checkbox')
    await user.click(cbs[0])
    await user.click(cbs[1])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // 等 banner 切到 partial
    await waitFor(() => {
      expect(screen.getByTestId('drafting-banner')).toHaveAttribute(
        'data-banner-state',
        'partial',
      )
    })

    // r1 (成功) chip: data-failed=false,data-selected=true
    const r1 = screen
      .getAllByTestId('drafting-repo-chip')
      .find((c) => c.getAttribute('data-repo-id') === 'r1') as HTMLElement
    expect(r1.getAttribute('data-failed')).toBe('false')
    expect(r1.getAttribute('data-selected')).toBe('true')

    // r2 (失败) chip: data-failed=true,文案含 ✕
    const r2 = screen
      .getAllByTestId('drafting-repo-chip')
      .find((c) => c.getAttribute('data-repo-id') === 'r2') as HTMLElement
    expect(r2.getAttribute('data-failed')).toBe('true')
    expect(r2.textContent).toContain('✕')
  })

  // ticket 02 验收 #9:已关联 + 锁定分支名 → chip 显示 🟢 + 分支名
  it('P4:成功关联后 chip 显示绿色小圆点 🟢 + 分支名(attachedBranchName prop)', async () => {
    const data = {
      ...emptyDrafting('req-green'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [{ id: 'r1', name: 'refund-svc' }],
      selectedRepoIds: [],
    }
    mockFetch.mockReset()
    // 用 mockImplementation 每次返回新 Response(issue 06 useEffect 触发的 GET 也走同一 mock)
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeSuccessResponse({
          requirementId: 'req-green',
          branchName: 'feat/green',
          succeeded: 1,
          failed: 0,
          results: [
            { ok: true, repoId: 'r1', branch: 'feat/green', worktreePath: '/x/r1', base: 'main' },
          ],
        }),
      ),
    )
    // @ts-ignore - mock fetch
    globalThis.fetch = mockFetch

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/green')
    await user.click(screen.getAllByTestId('attach-repos-dialog-repo-checkbox')[0])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    // 等 banner 消失(全成功)
    await waitFor(() => {
      expect(screen.queryByTestId('drafting-banner')).toBeNull()
    })

    const r1 = screen.getByTestId('drafting-repo-chip')
    expect(r1.textContent).toContain('🟢')
    // 分支名 span 存在
    expect(screen.getByTestId('drafting-repo-chip-branch')).toHaveTextContent('feat/green')
  })

  // ticket 02 验收 #8:重试该 repo → 弹层打开时 failedRepoIds 默认勾选
  it('P5:点 [重试该 repo] → 弹层打开时 failed repo 默认勾选(pickedRepoIds)', async () => {
    const data = {
      ...emptyDrafting('req-retry-failed'),
      title: '退款',
      prdMarkdown: generatePrdSkeleton('退款'),
      empty: false,
      repos: [
        { id: 'r1', name: 'r1' },
        { id: 'r2', name: 'r2' },
      ],
      selectedRepoIds: [],
    }
    mockFetch.mockReset()
    // 用 mockImplementation 每次返回新 Response(issue 06 useEffect 触发的 GET 也走同一 mock)
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        makeSuccessResponse({
          requirementId: 'req-retry-failed',
          branchName: 'feat/retry',
          succeeded: 1,
          failed: 1,
          results: [
            { ok: true, repoId: 'r1', branch: 'feat/retry', worktreePath: '/x/r1', base: 'main' },
            { ok: false, repoId: 'r2', code: 'E_DISK_FULL', message: 'No space left' },
          ],
        }),
      ),
    )
    // @ts-ignore - mock fetch
    globalThis.fetch = mockFetch

    render(<DraftingZone data={data} />)
    const user = userEvent.setup()

    // 首次提交 → 部分成功
    await user.click(screen.getByTestId('repo-bar-add'))
    await user.type(screen.getByTestId('attach-repos-dialog-branch'), 'feat/retry')
    const cbs = screen.getAllByTestId('attach-repos-dialog-repo-checkbox')
    await user.click(cbs[0])
    await user.click(cbs[1])
    await user.click(screen.getByTestId('attach-repos-dialog-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('drafting-banner')).toHaveAttribute(
        'data-banner-state',
        'partial',
      )
    })

    // 点 [重试该 repo] 按钮
    await user.click(screen.getByTestId('drafting-banner-retry-failed'))

    // 弹层打开,pickedRepoIds 应默认勾选失败的 r2(r1 是成功已勾)
    const dialogCheckboxes = screen.getAllByTestId(
      'attach-repos-dialog-repo-checkbox',
    ) as HTMLInputElement[]
    const r1cb = dialogCheckboxes.find(
      (c) => (c as HTMLElement).getAttribute('data-repo-id') === 'r1',
    ) as HTMLInputElement
    const r2cb = dialogCheckboxes.find(
      (c) => (c as HTMLElement).getAttribute('data-repo-id') === 'r2',
    ) as HTMLInputElement
    expect(r1cb.checked).toBe(true)
    expect(r2cb.checked).toBe(true)
  })
})
