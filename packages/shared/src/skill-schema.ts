/**
 * Skill frontmatter schema —— ADR-0013 D10
 *
 * Skill `SKILL.md` frontmatter 可声明准入维度配置:
 * - `admission_dimensions`: Skill 主动声明它关心的默认维度列表
 * - `admission_override`: 在默认维度集合上 add 新维度 / skip 默认维度
 *
 * 默认维度集合(5 个)固定,与 ADR-0013 D4 "严重度分级" 对齐:
 *   loss_prevention → 🔴 资损
 *   performance     → 🟠 性能
 *   arch_conflict   → 🟡 架构冲突
 *   business_reasonable → 🟢 业务合理性
 *   context_query   → 💬 上下文确认
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// AdmissionDimensionId
// ---------------------------------------------------------------------------

/** 准入维度枚举 —— 5 个默认维度(ADR-0013 D4) */
export const AdmissionDimensionIdSchema = z.enum([
  'loss_prevention',
  'performance',
  'arch_conflict',
  'business_reasonable',
  'context_query',
])
export type AdmissionDimensionId = z.infer<typeof AdmissionDimensionIdSchema>

/** 默认 5 维度顺序(固定,作为装配起点) */
export const DEFAULT_ADMISSION_DIMENSIONS: readonly AdmissionDimensionId[] = [
  'loss_prevention',
  'performance',
  'arch_conflict',
  'business_reasonable',
  'context_query',
] as const

// ---------------------------------------------------------------------------
// 维度元数据(中文 label + emoji icon + severity)
// ---------------------------------------------------------------------------

export type AdmissionDimensionSeverity = 'red' | 'orange' | 'yellow' | 'green' | 'blue'

export interface AdmissionDimensionMeta {
  id: AdmissionDimensionId
  label: string
  icon: string
  severity: AdmissionDimensionSeverity
}

/**
 * 5 个默认维度的元数据(SSR 端固定;Skill 可在 frontmatter add 新维度,
 * 那些 add 维度的元数据由 Skill 自带,不在此常量里)。
 */
export const ADMISSION_DIMENSION_META: Record<AdmissionDimensionId, AdmissionDimensionMeta> = {
  loss_prevention: { id: 'loss_prevention', label: '资损安全', icon: '🔴', severity: 'red' },
  performance:     { id: 'performance',     label: '性能',     icon: '🟠', severity: 'orange' },
  arch_conflict:   { id: 'arch_conflict',   label: '架构冲突', icon: '🟡', severity: 'yellow' },
  business_reasonable: { id: 'business_reasonable', label: '业务合理性', icon: '🟢', severity: 'green' },
  context_query:   { id: 'context_query',   label: '上下文确认', icon: '💬', severity: 'blue' },
}

// ---------------------------------------------------------------------------
// AdmissionOverride —— Skill frontmatter 维度调整
// ---------------------------------------------------------------------------

/**
 * Skill 可在默认维度集合上 add / skip:
 * - `add`: 在默认维度之后追加的新维度(顺序 = add 数组顺序)
 * - `skip`: 从默认维度中移除的维度
 *
 * Skill frontmatter `admission_override:` 段。
 */
export const AdmissionOverrideSchema = z.object({
  add: z.array(z.string()).default([]),
  skip: z.array(z.string()).default([]),
})
export type AdmissionOverride = z.infer<typeof AdmissionOverrideSchema>