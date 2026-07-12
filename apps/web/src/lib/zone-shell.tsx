import type { ReactNode } from 'react'
import { ResourceTree } from '@/components/resource-tree'
import { InlineRail } from '@/components/inline-rail'
import type { DraftingSkill, PrdSection } from '@/lib/drafting'
import type { WrapupTreeSummary } from '@/lib/wrapup'
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
 *
 * 关于 client 函数 prop:本组件是 Server Component,不能直接接收函数 prop。
 * 凡是 zone 需要函数回调(issue 18 Skill 点击),调用方(page.tsx)需通过
 * inlineRailSlot 注入 client wrapper 组件。
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
   * 注意:Skill 点击的函数回调必须由 client wrapper 注入,不能从 page.tsx 直接传。
   */
  draftingSkills?: DraftingSkill[]
  /**
   * WRAP-UP 工位专用:产物 / PR / 决策摘要(issue 22)。
   * 传入时,资源树切换到 WRAP-UP 摘要视图(产物清单 + PR/Commit + 决策回顾)。
   * 其它工位不传,资源树维持默认静态结构或 DRAFTING 的 PRD 大纲视图。
   */
  wrapupSummary?: WrapupTreeSummary
  /**
   * 替换默认 InlineRail 的 client 组件 slot。
   * 提供时,ZoneShell 不再渲染默认 InlineRail,而是用此 slot 替代。
   * 适用于需要 client 交互(如 onSkillTrigger)的 zone。
   */
  inlineRailSlot?: ReactNode
}

// ADR-0012 §3 + ADR-0007 继承:workspace shell 层 1 = StatusBar(28px) + ZoneBar(44px) = 72px
const WORKSPACE_SHELL_OFFSET_PX = 72

export function ZoneShell({
  id,
  zone,
  children,
  prdSections,
  draftingSkills,
  wrapupSummary,
  inlineRailSlot,
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
        <ResourceTree
          requirementId={id}
          prdSections={prdSections}
          wrapupSummary={wrapupSummary}
        />
      )}
      {children}
      {zone.has_inline_rail &&
        (inlineRailSlot ?? (
          <InlineRail
            requirementId={id}
            draftingSkills={draftingSkills}
          />
        ))}
    </div>
  )
}