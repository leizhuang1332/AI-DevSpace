/**
 * Analysis Run 测试用 PRD fixture(PR-5 / ticket 10)
 *
 * 多个分析 Run 测试文件的 `seedRequirement` / `seedPrd` 默认 PRD
 * 字符串原本散落在四处,字节级重复;提到此处统一提供,便于:
 * - 一处更新 → 所有测试同步生效
 * - 新增分析 Run 测试时直接复用,不必再写 PRD 占位
 * - 通过常量值反映"PRD 长度 ≥ 50 字符才不被新契约 empty_prd 拒绝"
 *
 * 长度刻意保持在 80 字符上下,远高于 PR-5 阈值 50。
 *
 * 不做的事:
 * - 不在 fixture 里加 route 层调用 —— route 由具体测试文件装配
 * - 不提供"短 PRD"或"空 PRD"等负面用例 —— 那是测试 PR-5 边界用的,
 *   仍由测试文件就地手写以保持"测试自包含"的可读性
 */

export const DEFAULT_PRD_CONTENT = `# 测试 PRD\n\n## 业务背景\n\n本需求为单元测试默认值,描述核心问题与目标用户,用于支撑 Analysis Run。\n`

/** 长度断言:PR-5 阈值 + 50,远高于阈值 */
export const DEFAULT_PRD_LENGTH = DEFAULT_PRD_CONTENT.trim().length