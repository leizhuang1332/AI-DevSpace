'use client'

import { InlineRail } from '@/components/inline-rail'
import type { DraftingSkill } from '@/lib/drafting'

/**
 * DRAFTING 工位专用 Inline 栏 client 包装(issue 18 验收 #5 "点击可唤起 Skill")。
 *
 * 之所以独立组件:InlineRail 是 client component 但 Skill 点击回调需要
 * 使用 client-only API(useRouter / Cmd+K overlay / 后续 agent API);
 * Server Component(page.tsx)不能直接传函数 prop,故把回调封装到本 client 包装中。
 *
 * 本期 mock 实现:console.info 记录 trigger(后续接 Cmd+K overlay / agent API
 * 真正唤起 Skill)。
 */
export function DraftingSkillRail({
  requirementId,
  skills,
}: {
  requirementId: string
  skills: DraftingSkill[]
}) {
  const handleSkillTrigger = (skill: DraftingSkill) => {
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.info('[drafting-skill] trigger', { requirementId, skill })
    }
  }

  return (
    <InlineRail
      requirementId={requirementId}
      draftingSkills={skills}
      onSkillTrigger={handleSkillTrigger}
    />
  )
}