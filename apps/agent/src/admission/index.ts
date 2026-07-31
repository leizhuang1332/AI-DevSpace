/**
 * admission 模块入口 —— ADR-0021
 *
 * 子模块:
 *   - algorithmInterpreter:jq-simplified 表达式解释器(10 个语法元素)
 *   - algorithmValidator:V-3 语义校验(规则 id 唯一性 + 表达式 syntax)
 *   - packLoader:V-3 装载校验(结构 fail-fast + 语义降级)
 *   - baselineGenerator:workspace 首启自动生成 baseline-5dim
 *
 * 设计:
 *   - ticket 01:infra 存在 + 可独立测试,**不**与 caller 接线
 *   - ticket 02:`AdmissionLoader` 类型 + SystemPromptAssembler 接线(分段标号渲染)
 *     + dual-turn helper 不再附加 admission-check Skill body
 *   - ticket 03:start handler body 收紧为 `{ pack_id }` + enabled_packs 校验
 *     + verdict 迁 service + verdict_finalized SSE
 */

import type { AdmissionPack } from '@ai-devspace/shared'

export {
  evaluateExpression,
  runAlgorithm,
  isVerdict,
  ExpressionSyntaxError,
  type EvaluateContext,
  type RunAlgorithmOptions,
} from './algorithmInterpreter.js'

export {
  validateAlgorithm,
  AlgorithmValidationError,
  type AlgorithmValidationResult,
  type AlgorithmValidationErrorCode,
} from './algorithmValidator.js'

export {
  loadAdmissionPack,
  PackStructureError,
  type LoadResult,
  type LoadOptions,
  type PackStructureErrorCode,
} from './packLoader.js'

export {
  ensureBaselinePack,
  BASELINE_PACK_ID,
  BASELINE_ALGORITHM_ID,
  type EnsureResult,
} from './baselineGenerator.js'

/**
 * Admission Loader —— 供 SystemPromptAssembler 在 base prompt 装配阶段
 * 取出"本次会话要评估的 AdmissionPack"。
 *
 * 返回 null = 该 session 不渲染 admission section(deps 注入 loader 但本 session
 * 无可用 pack —— 例如结构错 fail-fast / 未配置 pack)。Assembler 把 null 当作
 * "降级 + 跳过该节",**不**抛错,不阻断 turn-1。
 *
 * ticket 02:start handler 注入 closure → `ensureBaselinePack(workspaceRoot)`.
 * pack(workspace 范围内单包;多 pack 共享 v1.1 再讨论)。
 *
 * ticket 03 会基于 `pack_id` + `enabled_packs` 校验后挑 pack —— 此时 loader
 * 内部改成读 pack_id 而非固定 baseline。
 */
export type AdmissionLoader = (input: {
  /** AISession / AssemblerSession 上下文 —— ticket 03 可用于 pack_id 解析 */
  session: { id: string; reqId: string }
}) => Promise<AdmissionPack | null>