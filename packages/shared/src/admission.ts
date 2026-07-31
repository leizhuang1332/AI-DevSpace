/**
 * Admission Pack Framework —— ADR-0021 数据契约
 *
 * 三层抽象(用户面):
 * - AdmissionUnit:单个评估视角(传感器)
 * - AdmissionAlgorithm:verdict 规则集(报警规则)
 * - AdmissionPack:用户操作单位(units + algorithm + UI 提示)
 *
 * 与现有 5-dimension 共享类型(AdmissionDimensionIdSchema / DEFAULT_ADMISSION_DIMENSIONS
 * / AdmissionDimensionMeta / ADMISSION_DIMENSION_META)并行:
 * - 老类型代表硬编码 5 维度的元数据(SSR UI 渲染用)
 * - 本文件代表运行时包模型的 schema(YAML 解析 + verdict 计算用)
 *
 * 约束:
 * - verdict 字符 `'✅' | '⚠️' | '❌'` —— 与 admission-check Skill body / 现有 SSE
 *   chunks.jsonl 单行 schema 保持一致
 * - 单元内 verdict 取值 `'pass' | 'warn' | 'fail'` —— 与 chunk parser 单测契约一致
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Verdict(包总体结论)
// ---------------------------------------------------------------------------

/** 三个 emoji 字符 —— 准入最终结论,挂在 AdmissionDashboard verdict 徽章 */
export const VERDICT_VALUES = ['✅', '⚠️', '❌'] as const
export const VerdictSchema = z.enum(VERDICT_VALUES)
export type Verdict = z.infer<typeof VerdictSchema>

/** 单元级 verdict 取值 —— pass / warn / fail,与 SDK chunks.jsonl 中 verdict 字段一致 */
export const UNIT_VERDICT_VALUES = ['pass', 'warn', 'fail'] as const
export const UnitVerdictSchema = z.enum(UNIT_VERDICT_VALUES)
export type UnitVerdict = z.infer<typeof UnitVerdictSchema>

// ---------------------------------------------------------------------------
// AdmissionUnit
// ---------------------------------------------------------------------------

/**
 * 评估单元的输出 schema —— 单元的 admissionPrompt 注入后,SDK 按此 schema 输出
 * `[DIM xxx]` 块的字段。详见 ADR-0021 D11 + D6。
 */
export const UnitOutputSchema = z.object({
  verdict: z.object({
    type: z.literal('enum'),
    options: z.array(UnitVerdictSchema),
  }),
  evidence: z.object({
    type: z.literal('string'),
    maxChars: z.number().int().positive(),
  }),
  pending: z.object({
    type: z.literal('string?'),
    optional: z.literal(true),
  }),
  quote: z.object({
    type: z.literal('string?'),
    optional: z.literal(true),
  }),
})
export type UnitOutput = z.infer<typeof UnitOutputSchema>

/** 评估单元 —— 物理文件 `units/<id>.yaml` 的反序列化形态 */
export const AdmissionUnitSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  /** 严重度图标 emoji —— 🔴 / 🟠 / 🟡 / 🟢 / 💬 等 */
  severityIcon: z.string().min(1),
  /** parser 识别的输出标记 —— `[DIM loss_prevention]` 等 */
  outputMarker: z.string().min(1),
  /** 注入到 system prompt 的评估 prompt(单元核心字段) */
  admissionPrompt: z.string().min(1),
  /** 单元输出 schema —— SDK 输出格式契约 */
  outputSchema: UnitOutputSchema,
})
export type AdmissionUnit = z.infer<typeof AdmissionUnitSchema>

// ---------------------------------------------------------------------------
// AdmissionAlgorithm
// ---------------------------------------------------------------------------

/**
 * 单条规则:`when` 表达式命中 → `result` + `reason`。
 *
 * 表达式语法是 jq-simplified 子集,具体元素见
 * `apps/agent/src/admission/algorithmInterpreter.ts`。
 *
 * `else` 分支作为最后一条"规则",没有 `when` 字段 —— 任意之前的规则未命中时取它。
 */
export const AlgorithmRuleSchema = z.object({
  id: z.string().min(1),
  when: z.string(),
  result: VerdictSchema,
  reason: z.string().min(1),
})
export type AlgorithmRule = z.infer<typeof AlgorithmRuleSchema>

/** else 分支(算法最后兜底) */
export const AlgorithmElseSchema = z.object({
  result: VerdictSchema,
  reason: z.string().min(1),
})
export type AlgorithmElse = z.infer<typeof AlgorithmElseSchema>

/** 算法 id / displayName 是 schema 校验(必须) */
export const AdmissionAlgorithmIdSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
})

export const AdmissionAlgorithmSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  rules: z.array(AlgorithmRuleSchema),
  /** else 兜底分支(必须存在 —— 否则算法在所有规则都不命中时无 verdict) */
  else: AlgorithmElseSchema,
})
export type AdmissionAlgorithm = z.infer<typeof AdmissionAlgorithmSchema>

// ---------------------------------------------------------------------------
// AdmissionPackManifest
// ---------------------------------------------------------------------------

/** manifest 中的 unit 引用 —— 物理文件 `units/<id>.yaml` 由 file 字段指向 */
export const ManifestUnitEntrySchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
})
export type ManifestUnitEntry = z.infer<typeof ManifestUnitEntrySchema>

/**
 * Manifest UI 提示(可选)—— 挂在 AdmissionDashboard dropdown / 详情区。
 * 字段均 optional:旧 pack 缺这些字段不会破坏 loader。
 */
export const PackDisplayHintsSchema = z
  .object({
    primaryBlockers: z.array(z.string()).optional(),
    recommendedAngle: z.array(z.string()).optional(),
  })
  .optional()

export const AdmissionPackManifestSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  version: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  units: z.array(ManifestUnitEntrySchema),
  algorithm: z.string().min(1),
  displayHints: PackDisplayHintsSchema,
})
export type AdmissionPackManifest = z.infer<typeof AdmissionPackManifestSchema>

// ---------------------------------------------------------------------------
// AdmissionPack(运行时合并形态)
// ---------------------------------------------------------------------------

/**
 * 装载成功的 Admission Pack —— 合并 manifest + units + algorithm 后的内存对象。
 * loader 负责把 units[].file 引用展开为完整 AdmissionUnit。
 */
export interface AdmissionPack {
  /** 包 id —— 与 manifest.id / 物理目录名一致 */
  id: string
  /** UI 显示名 */
  displayName: string
  /** 版本字符串(可选) */
  version?: string
  /** 包描述(可选) */
  description?: string
  /** 标签(可选) */
  tags?: readonly string[]
  /** 装载好的所有单元(顺序与 manifest.units 一致) */
  units: readonly AdmissionUnit[]
  /** 装载好的算法 */
  algorithm: AdmissionAlgorithm
  /** UI 提示(可选) */
  displayHints?: {
    primaryBlockers?: readonly string[]
    recommendedAngle?: readonly string[]
  }
  /** 装载源目录的绝对路径 —— 调试 / reload 用 */
  sourcePath: string
}

// ---------------------------------------------------------------------------
// UnitJudgment / PackVerdict(verdict 计算结果)
// ---------------------------------------------------------------------------

/**
 * 单元级判决 —— 解析 `[DIM xxx]` 块后填入字段,作为 algorithm 解释器的输入。
 * 与 AdmissionChunkPayload.admission.dim/verdict 字段同源,但 AdmissionUnit
 * 元数据(displayName / severityIcon)挂上去了,让 UI / algorithm 都自包含。
 */
export interface UnitJudgment {
  /** 单元 id(对应 AdmissionUnit.id) */
  id: string
  /** UI 显示名 */
  displayName: string
  /** 严重度 emoji 字符串 */
  severity: string
  /** pass / warn / fail */
  verdict: UnitVerdict
  /** 单元产出证据文本 */
  evidence: string
  /** 待裁决文本(可选) */
  pending?: string
  /** 引用文本(可选) */
  quote?: string
}

/**
 * 包总体 verdict —— algorithm 解释器跑完 rules + else 后产出。
 * SSE `verdict_finalized` 事件 + chunks.jsonl 末尾 verdict 摘要 + AdmissionDashboard
 * verdict 徽章三处共享同一形态。
 */
export interface PackVerdict {
  /** 包 id */
  packId: string
  /** 总体结论 emoji */
  verdict: Verdict
  /** 命中的算法规则 reason(给 UI 显示) */
  reason: string
  /** 命中的规则 id(给 UI 解释用,可选 —— else 命中时无 ruleId) */
  hitRuleId?: string
  /** ISO 8601 时间戳 */
  computedAt: string
}

// ---------------------------------------------------------------------------
// 装载警告(语义降级)
// ---------------------------------------------------------------------------

/**
 * V-3 装载校验产生的语义警告 —— 调用方收到 AdmissionPack 同时拿到这份清单,
 * 用于在 session 启动前 log + 提示用户。
 *
 * 语义警告不会阻断 session 启动,仅信息降级。
 */
export interface AdmissionPackWarning {
  /** 警告类别 —— 用于 log 过滤 */
  category: 'algorithm_syntax' | 'rule_id_collision' | 'unit_id_collision'
  /** 警告详情 —— 包内定位(规则 id / unit id) */
  target: string
  /** 人类可读描述 */
  message: string
}