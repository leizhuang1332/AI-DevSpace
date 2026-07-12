import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { ClarifyingZone } from '@/components/clarifying-zone'
import {
  emptyClarifying,
  getClarifyingData,
  type ClarifyingData,
} from '@/lib/clarifying'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// ============================================================================
// 满数据渲染 — Q&A 主区(主区全宽,对应原型 11b)
// ============================================================================

describe('ClarifyingZone · 满数据渲染', () => {
  it('根节点 + stage strip + toolbar + Q&A 三段全部存在', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const root = screen.getByTestId('clarifying-zone')
    expect(root.getAttribute('data-empty')).toBe('false')
    expect(root.getAttribute('data-requirement-id')).toBe('req-001')

    // Stage strip:③ 澄清 + CLARIFYING · Q&A 形态
    expect(screen.getByTestId('clarifying-stage-strip')).toBeInTheDocument()
    expect(screen.getByTestId('clarifying-stage-badge').textContent).toBe(
      '③ 澄清',
    )
    expect(
      screen.getByTestId('clarifying-stage-title').textContent,
    ).toContain('CLARIFYING')
    expect(
      screen.getByTestId('clarifying-stage-title').textContent,
    ).toContain('Q&A')

    // Toolbar:面包屑 + 形态标签
    expect(screen.getByTestId('clarifying-toolbar')).toBeInTheDocument()
    const current = screen.getByTestId('clarifying-crumb-current')
    expect(current.textContent).toBe('澄清对话')
    expect(current.getAttribute('data-current')).toBe('true')

    // Q&A 主区:进度 + 焦点 + 历史
    expect(screen.getByTestId('clarifying-progress')).toBeInTheDocument()
    expect(screen.getByTestId('clarifying-focus')).toBeInTheDocument()
    expect(screen.getByTestId('clarifying-history')).toBeInTheDocument()
  })

  it('进度条显示当前 Q / 总数 与 百分比', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const progress = screen.getByTestId('clarifying-progress')
    expect(progress.getAttribute('data-current')).toBe('4')
    expect(progress.getAttribute('data-total')).toBe('5')
    // 4/5 → 80%
    const bar = progress.querySelector('[data-testid="clarifying-progress-bar"]')
    expect(bar).not.toBeNull()
    expect(bar!.getAttribute('data-pct')).toBe('80')
  })

  it('当前提问焦点卡显示 AI 问题正文 + 上下文链接', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const focus = screen.getByTestId('clarifying-focus')
    expect(focus.getAttribute('data-question-id')).toBe('q-4')
    expect(screen.getByTestId('clarifying-focus-kicker').textContent).toContain(
      '当前提问',
    )

    // 问题正文
    expect(screen.getByTestId('clarifying-focus-question').textContent).toContain(
      '退款失败时,是否要回滚已扣减的优惠券额度?',
    )

    // 上下文链接(指向 ANALYZING 工位的产物):
    // 链接的渲染文案包含文件路径,href 跳转到 ANALYZING 工位对应 chunk 锚点
    const ctxLinks = within(focus).getAllByTestId('clarifying-focus-ctx-link')
    expect(ctxLinks.length).toBeGreaterThanOrEqual(1)
    expect(ctxLinks[0].textContent).toContain('design/02-api.md')
    expect(ctxLinks[0].getAttribute('href')).toContain('/analyzing')
  })

  it('候选答案按钮渲染 2-4 个(主区基于 requirement-clarify Skill 生成)', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const opts = screen.getAllByTestId('clarifying-candidate-option')
    expect(opts.length).toBeGreaterThanOrEqual(2)
    expect(opts.length).toBeLessThanOrEqual(4)
    // 三个候选按钮文案必须包含
    expect(opts[0].textContent).toContain('是')
    expect(opts[1].textContent).toContain('否')
  })

  it('自定义回答输入框(✏️)渲染,可输入自由文本', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const custom = screen.getByTestId('clarifying-custom-answer')
    fireEvent.change(custom, { target: { value: '我的自由回答:只回滚未使用的券' } })
    expect((custom as HTMLInputElement).value).toBe(
      '我的自由回答:只回滚未使用的券',
    )
  })

  it('历史澄清记录按时间倒序(最新在最上),默认展开', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const history = screen.getByTestId('clarifying-history')
    expect(history.getAttribute('data-collapsed')).toBe('false')

    const items = screen.getAllByTestId('clarifying-history-item')
    // Q1~Q5 共 5 条
    expect(items.length).toBe(5)

    // 第一条是 Q5(最新),最后一条是 Q1(最早)
    const firstQid = items[0].getAttribute('data-question-id')
    const lastQid = items[items.length - 1].getAttribute('data-question-id')
    expect(firstQid).toBe('q-5')
    expect(lastQid).toBe('q-1')
  })

  it('历史每条显示 状态符号 + 问题标题 + 答案 + "回到那一步"链接', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const items = screen.getAllByTestId('clarifying-history-item')
    // q-1 已答(done)
    const done = items.find((it) => it.getAttribute('data-question-id') === 'q-1')
    expect(done).toBeDefined()
    expect(done!.getAttribute('data-status')).toBe('done')
    expect(done!.textContent).toContain('退款单 ID 生成规则')
    expect(done!.textContent).toContain('雪花算法')

    // 每条都有 "回到那一步" 按钮(注:q-5 status=blocked 时不渲染 → 4 个)
    const backLinks = screen.getAllByTestId('clarifying-history-back')
    expect(backLinks.length).toBe(4)
  })
})

// ============================================================================
// 交互:候选答案提交 / 自定义回答提交 / 历史折叠
// ============================================================================

describe('ClarifyingZone · Q&A 交互', () => {
  it('点击候选答案按钮 → 触发 onAnswer 回调,载荷含 questionId + label', async () => {
    const data = await getClarifyingData('req-001')
    const onAnswer = vi.fn()
    render(<ClarifyingZone data={data} onAnswer={onAnswer} />)

    const opts = screen.getAllByTestId('clarifying-candidate-option')
    fireEvent.click(opts[0])

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        questionId: 'q-4',
        kind: 'candidate',
        label: expect.stringContaining('是'),
      }),
    )
  })

  it('点击候选答案按钮 → 视觉反馈"✓ 已提交" + 其他候选 disabled(spec 验收:AI 继续)', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const opts = screen.getAllByTestId('clarifying-candidate-option')
    fireEvent.click(opts[0])

    // 被点击的候选:data-submitted="true" + 文案变 "✓ 已提交 · ..."
    expect(opts[0].getAttribute('data-submitted')).toBe('true')
    expect(opts[0].textContent).toContain('已提交')

    // 其他候选:disabled(避免重复提交)
    for (let i = 1; i < opts.length; i++) {
      expect(opts[i]).toBeDisabled()
    }
  })

  it('自定义回答输入后点提交 → 触发 onAnswer 回调', async () => {
    const data = await getClarifyingData('req-001')
    const onAnswer = vi.fn()
    render(<ClarifyingZone data={data} onAnswer={onAnswer} />)

    const custom = screen.getByTestId('clarifying-custom-answer')
    fireEvent.change(custom, { target: { value: '我的自由回答' } })

    const submit = screen.getByTestId('clarifying-custom-submit')
    fireEvent.click(submit)

    expect(onAnswer).toHaveBeenCalledTimes(1)
    expect(onAnswer.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        questionId: 'q-4',
        kind: 'custom',
        text: '我的自由回答',
      }),
    )
  })

  it('自定义回答空文本时,提交按钮 disabled', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const submit = screen.getByTestId('clarifying-custom-submit')
    expect(submit.hasAttribute('disabled')).toBe(true)
  })

  it('点击历史记录"回到那一步" → 触发 onBack 回调,载荷含 questionId', async () => {
    const data = await getClarifyingData('req-001')
    const onBack = vi.fn()
    render(<ClarifyingZone data={data} onBack={onBack} />)

    const items = screen.getAllByTestId('clarifying-history-item')
    const q3 = items.find((it) => it.getAttribute('data-question-id') === 'q-3')
    const back = within(q3!).getByTestId('clarifying-history-back')
    fireEvent.click(back)

    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onBack.mock.calls[0][0]).toEqual(
      expect.objectContaining({ questionId: 'q-3' }),
    )
  })

  it('点历史标题切换折叠态', async () => {
    const data = await getClarifyingData('req-001')
    render(<ClarifyingZone data={data} />)

    const history = screen.getByTestId('clarifying-history')
    expect(history.getAttribute('data-collapsed')).toBe('false')

    const toggle = screen.getByTestId('clarifying-history-toggle')
    fireEvent.click(toggle)
    expect(history.getAttribute('data-collapsed')).toBe('true')

    fireEvent.click(toggle)
    expect(history.getAttribute('data-collapsed')).toBe('false')
  })

  it('blocked 历史项文案使用 blockedReason.dependsOn(不硬编码 q-5)', async () => {
    // 注入自定义历史:q-7 blocked by q-2(非 q-5),证明 UI 从数据派生而非字符串比对
    const data: ClarifyingData = {
      ...emptyClarifying('DEP'),
      empty: false,
      history: [
        {
          id: 'h-x',
          questionId: 'q-2',
          question: 'Q2',
          answer: 'A2',
          status: 'done',
          ts: '',
        },
        {
          id: 'h-y',
          questionId: 'q-7',
          question: 'Q7',
          answer: '',
          status: 'blocked',
          ts: '',
          blockedReason: { dependsOn: 'q-2' },
        },
      ],
    }
    render(<ClarifyingZone data={data} />)
    const q7 = screen
      .getAllByTestId('clarifying-history-item')
      .find((it) => it.getAttribute('data-question-id') === 'q-7')
    expect(q7).toBeDefined()
    expect(q7!.textContent).toContain('Q-2')
  })
})

// ============================================================================
// 决策 22 交叉验证 — ZoneBar CLARIFYING 紫点带红圈
// (主测试在 zone-bar.test.tsx;此处绑定到 issue 20 验收)
// ============================================================================

describe('ClarifyingZone · ZoneBar 决策 22 联动', () => {
  it('ZONE_STATUS_COLOR_CLASS[purple-warn] = "bg-purple-500 ring-2 ring-red-500"(紫点 + 红圈)', () => {
    // 不渲染组件,直接验证 zones.ts 的派生映射 —— 因为 ZoneBar 通过该 className 应用 ring
    // 这里作为 spec acceptance 的快速可追溯断言
    return import('@/lib/zones').then(({ ZONE_STATUS_COLOR_CLASS }) => {
      expect(ZONE_STATUS_COLOR_CLASS['purple-warn']).toContain('bg-purple-500')
      expect(ZONE_STATUS_COLOR_CLASS['purple-warn']).toContain('ring-')
      expect(ZONE_STATUS_COLOR_CLASS['purple-warn']).toContain('ring-red-500')
    })
  })

  it('CLARIFYING 工位的 status_color 在元数据中标记为 purple-warn', () => {
    return import('@/lib/zones').then(({ ZONE_META }) => {
      const clarifying = ZONE_META.find((z) => z.id === 'clarifying')
      expect(clarifying).toBeDefined()
      expect(clarifying!.status_color).toBe('purple-warn')
    })
  })
})

// ============================================================================
// 空态 — 引导去 DRAFTING 或 ANALYZING(issue 19 同模式)
// ============================================================================

describe('ClarifyingZone · 空数据', () => {
  it('empty=true 渲染空态引导,焦点 / 历史都不渲染', () => {
    const data = emptyClarifying('NEW-REQ')
    render(<ClarifyingZone data={data} />)

    const root = screen.getByTestId('clarifying-zone')
    expect(root.getAttribute('data-empty')).toBe('true')
    expect(root.getAttribute('data-requirement-id')).toBe('NEW-REQ')

    expect(screen.getByText('CLARIFYING 工位暂无问题')).toBeInTheDocument()
    const cta = screen.getByText('→ 进入 DRAFTING 工位')
    expect(cta.getAttribute('href')).toBe('/requirements/NEW-REQ/drafting')

    expect(screen.queryByTestId('clarifying-focus')).toBeNull()
    expect(screen.queryByTestId('clarifying-history')).toBeNull()
  })
})

// ============================================================================
// 边界 — 所有问题已答完 / 历史为空
// ============================================================================

describe('ClarifyingZone · 边界', () => {
  it('所有问题已答完 → 焦点卡显示"全部已答"占位,历史全部 done', () => {
    const data: ClarifyingData = {
      ...emptyClarifying('ALL-DONE'),
      empty: false,
      currentQuestion: null,
      history: [
        { id: 'h-1', questionId: 'q-1', question: 'Q1', status: 'done', answer: 'A1', ts: '14:23' },
        { id: 'h-2', questionId: 'q-2', question: 'Q2', status: 'done', answer: 'A2', ts: '14:24' },
      ],
      progress: { current: 2, total: 2, pct: 100 },
    }
    render(<ClarifyingZone data={data} />)
    expect(screen.getByTestId('clarifying-focus-done')).toBeInTheDocument()
    const items = screen.getAllByTestId('clarifying-history-item')
    expect(items.every((it) => it.getAttribute('data-status') === 'done')).toBe(
      true,
    )
  })

  it('历史为空(首问) → 历史区渲染"暂无历史"占位', () => {
    const data: ClarifyingData = {
      ...emptyClarifying('FRESH'),
      empty: false,
      history: [],
    }
    render(<ClarifyingZone data={data} />)
    expect(screen.getByTestId('clarifying-history-empty')).toBeInTheDocument()
  })

  it('顶层不崩(空对象 mount 即返回)', () => {
    expect(() =>
      render(<ClarifyingZone data={emptyClarifying('X')} />),
    ).not.toThrow()
  })
})
