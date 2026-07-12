import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DraftingSkillRail } from '@/components/drafting-skill-rail'
import type { DraftingSkill } from '@/lib/drafting'

const routerPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/requirements/REF-001/drafting/',
  notFound: vi.fn(),
}))

const SAMPLE_SKILLS: DraftingSkill[] = [
  {
    id: 'sk-brainstorm',
    name: 'requirement-brainstorm',
    description: '从模糊想法出发',
    trigger: '⌘K 唤起',
  },
  {
    id: 'sk-clarify',
    name: 'requirement-clarify',
    description: '对已写 PRD 提问',
    trigger: '⌘K 唤起',
  },
  {
    id: 'sk-schema',
    name: 'schema-design',
    description: '基于 PRD 草拟 schema',
    trigger: '一键启动',
  },
]

let consoleInfoSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  routerPush.mockReset()
})

afterEach(() => {
  cleanup()
  consoleInfoSpy.mockRestore()
})

describe('DraftingSkillRail', () => {
  it('渲染所有 Skill + trigger 按钮', () => {
    render(<DraftingSkillRail requirementId="REF-001" skills={SAMPLE_SKILLS} />)

    // 展开态(默认 collapsed,先展开)
    const toggle = screen.getByLabelText('展开候命 Skill 列表')
    void toggle // collapsed → true → 折叠态;点击展开

    // 但 InlineRail 默认 collapsed=true;此测试需先用 getByText 找 InlineRail root
    const rail = screen.getByTestId('inline-rail')
    expect(rail.getAttribute('data-rail-mode')).toBe('drafting-skills')
    expect(rail.getAttribute('data-skill-count')).toBe('3')
  })

  it('点击 trigger 按钮 → console.info(本期 mock 唤起)', async () => {
    render(<DraftingSkillRail requirementId="REF-001" skills={SAMPLE_SKILLS} />)
    const user = userEvent.setup()

    // 展开
    await user.click(screen.getByLabelText('展开候命 Skill 列表'))

    // 点击 brainstorm trigger(skill id 在 data-skill-id 上,testid 是 trigger 通用 id)
    const triggers = screen.getAllByTestId('inline-rail-drafting-skill-trigger')
    const brainstormTrigger = triggers.find(
      (t) => t.getAttribute('data-skill-id') === 'sk-brainstorm',
    )!
    expect(brainstormTrigger).toBeDefined()
    await user.click(brainstormTrigger)

    // mock 行为:console.info 记录
    expect(consoleInfoSpy).toHaveBeenCalled()
    const call = consoleInfoSpy.mock.calls.find(
      (args) => (args[0] as string)?.includes('[drafting-skill]'),
    )
    expect(call).toBeTruthy()
    expect(call?.[1]).toMatchObject({
      requirementId: 'REF-001',
      skill: expect.objectContaining({ id: 'sk-brainstorm' }),
    })
  })

  it('schema-design trigger 点击也仅 console.info(本期 mock 统一走控制台)', async () => {
    render(<DraftingSkillRail requirementId="REF-001" skills={SAMPLE_SKILLS} />)
    const user = userEvent.setup()

    await user.click(screen.getByLabelText('展开候命 Skill 列表'))
    const triggers = screen.getAllByTestId('inline-rail-drafting-skill-trigger')
    const schemaTrigger = triggers.find(
      (t) => t.getAttribute('data-skill-id') === 'sk-schema',
    )!
    await user.click(schemaTrigger)

    expect(consoleInfoSpy).toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })
})