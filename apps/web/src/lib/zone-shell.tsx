import type { ReactNode } from 'react'
import { ResourceTree } from '@/components/resource-tree'
import { InlineRail } from '@/components/inline-rail'
import type { DraftingSkill, PrdSection } from '@/lib/drafting'
import type { ZoneMeta } from './zones'

/**
 * 根据 zone 的 has_resource_tree / has_inline_rail 决定 grid 列数。
 *
 * - 资源树(左 240px) + Inline 栏(右 120px):grid-cols-[240px_1fr_120px]
 * - 仅资源树:grid-cols-[240px_1fr]
 * - 仅 Inline 栏:grid-cols-[1fr_120px]
 * - 都没有(主区全宽):grid-cols-1
 *
 * 暴露为纯函数以便测试;ZoneShell 直接复用。
 */
export function zoneShellGridClass(zone: ZoneMeta): string {
  const tree = zone.has_resource_tree
  const rail = zone.has_inline_rail
  if (tree && rail) return 'grid-cols-[240px_1fr_120px]'
  if (tree) return 'grid-cols-[240px_1fr]'
  if (rail) return 'grid-cols-[1fr_120px]'
  return 'grid-cols-1'
}

/**
 * 工位专属 shell 的可视部分(不负责解析 / 404 判定)。
 *
 * 提取为纯组件便于测试;[id]/[zone]/layout.tsx 负责解析 + notFound 后调用它。
 */
export interface ZoneShellProps {
  id: string
  zone: ZoneMeta
  children: ReactNode
  /**
   * DRAFTING 工位专用:PRD 章节大纲。
   * 传入时,资源树切换到 PRD 大纲视图(issue 18)。
   * 其它工位不传,资源树维持默认静态结构。
   */
  prdSections?: PrdSection[]
  /**
   * DRAFTING 工位专用:候命 Skill 列表(issue 18)。
   * 传入时,Inline 栏切换到 Skill 列表视图。
   */
  draftingSkills?: DraftingSkill[]
  /**
   * DRAFTING 工位专用:Skill trigger 点击回调。
   * 实际唤起动作由 page.tsx 注入(本期 mock:打开 Cmd+K / 弹提示)。
   */
  onSkillTrigger?: (skill: DraftingSkill) => void
}

// ADR-0012 §3 + ADR-0007 继承:workspace shell 层 1 = StatusBar(28px) + ZoneBar(44px) = 72px
const WORKSPACE_SHELL_OFFSET_PX = 72

export function ZoneShell({
  id,
  zone,
  children,
  prdSections,
  draftingSkills,
  onSkillTrigger,
}: ZoneShellProps) {
  return (
    <div
      data-testid="zone-shell"
      data-zone-id={zone.id}
      data-has-resource-tree={String(zone.has_resource_tree)}
      data-has-inline-rail={String(zone.has_inline_rail)}
      className={`grid min-h-[calc(100vh-${WORKSPACE_SHELL_OFFSET_PX}px)] bg-bg ${zoneShellGridClass(zone)}`}
    >
      {zone.has_resource_tree && (
        <ResourceTree requirementId={id} prdSections={prdSections} />
      )}
      {children}
      {zone.has_inline_rail && (
        <InlineRail
          requirementId={id}
          draftingSkills={draftingSkills}
          onSkillTrigger={onSkillTrigger}
        />
      )}
    </div>
  )
}