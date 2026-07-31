/**
 * admission 模块入口 —— ADR-0021
 *
 * 子模块:
 *   - algorithmInterpreter:jq-simplified 表达式解释器(10 个语法元素)
 *   - algorithmValidator:V-3 语义校验(规则 id 唯一性 + 表达式 syntax)
 *   - packLoader:V-3 装载校验(结构 fail-fast + 语义降级)
 *   - baselineGenerator:workspace 首启自动生成 baseline-5dim
 *
 * 设计:本 ticket (01) 只让 infra 存在 + 可独立测试,**不**与 caller
 * (SystemPromptAssembler / analysis route / SessionRecorder 等) 接线 —— 接线
 * 在 ticket 02 / 03。
 */

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