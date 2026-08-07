/**
 * @deprecated ADR-0026 — zones 声明式注册表已整体退役(`ZONE_META` 数组 +
 * `~/.aidevspace/zones/*.yaml` + agent 端 `ZoneRegistry.ts` + 本 schema)。
 * 请勿新增引用。web 端 section 元数据改用 `apps/web/src/lib/sections.ts`
 * (`SECTION_META` / `REQUIREMENT_SECTIONS` hardcode 4 section)。
 *
 * 本文件按 issue 06 checklist 第 3 项**保留一周**(不立即删除),供过渡期
 * 观测;agent 删除 `ZoneRegistry.ts` 后,本 schema 已无运行时消费方。
 * 一周后物理删除 + 同步移除 `packages/shared/src/index.ts` 的 `export * from './zones'`。
 */
import { z } from 'zod'

/** 工位状态色(对应 ADR-0011 决策 22) */
export const ZoneStatusColorSchema = z.enum([
  'gray',
  'blue',
  'purple',
  'yellow',
  'green',
  'red',
  'purple-warn',
])
export type ZoneStatusColor = z.infer<typeof ZoneStatusColorSchema>

/**
 * 工位配置 schema —— 对应 ADR-0012 §9 的 12(实际 14)字段集:
 * 身份 5 + 环境 5 + 装备 1 + 触发器 2 + 备注 1
 *
 * 默认值兜底:
 * - status_pulse: false
 * - entry_triggers / exit_triggers: []
 *
 * 备注 description 可选(可缺省)。
 *
 * 历史字段(已下线 · 见 issue 16 wontfix):
 * - thinking_bar: AI 思考条全局 UI 字段。2026-07 经产品决定下线(无实际作用、挡视线),
 *   schema / yaml / web zones.ts 同步移除,不再保留。
 */
export const ZoneSchema = z.object({
  // ── 身份(必填 · 5 字段) ──
  id: z.string().min(1),
  name: z.string().min(1),
  display_name: z.string().min(1),
  icon: z.string().min(1),
  route_segment: z.string().min(1),

  // ── 环境(必填 · 5 字段) ──
  has_resource_tree: z.boolean(),
  has_inline_rail: z.boolean(),
  main_layout: z.string().min(1),
  status_color: ZoneStatusColorSchema,
  status_pulse: z.boolean().default(false),

  // ── 装备(必填 · 1 字段) ──
  default_arming: z.array(z.string()),

  // ── 触发器(可选 · 2 字段 · 默认 []) ──
  entry_triggers: z.array(z.string()).default([]),
  exit_triggers: z.array(z.string()).default([]),

  // ── 备注(可选 · 1 字段) ──
  description: z.string().optional(),
})

export type ZoneConfig = z.infer<typeof ZoneSchema>