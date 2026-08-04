/**
 * 内置 Analysis Skill 默认内容(issue 01 · ADR-0021)
 *
 * 这两个 Skill 是 ANALYZING 工位的**平台保留**默认项:
 * - 应用启动时,WorkspaceService.initWorkspace 之后由 AnalysisSkillService
 *   检查 `<workspaceRoot>/analysis-skills/<reserved-name>/SKILL.md` 是否存在,
 *   缺失则用本模块的 `BUILTIN_DEFAULT_SKILLS[reservedName]` 写盘
 * - 应用升级时,reserved 名称对应的 SKILL.md 会被**强制覆盖**为最新内置
 *   版本(其他名称保留 Workspace 内容)
 * - 内容不存数据库,只与代码版本绑定;版本号写在 frontmatter `version:`
 *
 * 设计要点:
 * - frontmatter 字段契约:`name` / `description` / `version`,三者均必填
 * - body 描述识别目标、判断规则与领域边界,不涉及工具权限 / 协议
 * - 这两个 Skill 的内容只作为**默认占位**;用户可在 Workspace 内编辑 body
 *   (本 ticket 不暴露上传/编辑 UI,纯占位 + 升级覆盖)
 */

import {
  AnalysisSkillFrontmatterSchema,
  parseMinimalFrontmatter,
  splitSkillMarkdown,
  type AnalysisSkillFrontmatter,
} from '@ai-devspace/shared'

/** SKILL.md frontmatter 最小契约(对应 packages/shared/src/analysis-skill.ts) */

/** 单条内置默认 Skill 的"frontmatter + body"打包形式 */
export interface BuiltinDefaultSkill {
  name: string
  frontmatter: AnalysisSkillFrontmatter
  body: string
}

// ---------------------------------------------------------------------------
// 实际默认内容 —— 用源码字符串字面写,避免打包时依赖外置文件路径
// ---------------------------------------------------------------------------

const PRD_COMPLETENESS_SKILL_MD = `---
name: prd-completeness
description: 检查 PRD 的完整性与清晰度,识别缺字段、含糊措辞、隐含假设和验收标准缺失
version: 1.0.0
---

# prd-completeness

你的任务是对用户提交的 PRD 做**完整性与清晰度**维度的检查,识别所有可能
妨碍开发、测试与验收的不完整、模糊或缺字段的描述。

## 检查目标

围绕以下 6 个子维度逐条检查(每条可独立产出 1 个 Analysis Issue):

1. **目标与背景**:PRD 是否清晰陈述要解决的问题、用户角色与成功指标
2. **范围与边界**:是否说明本期不做的事情(in-scope / out-of-scope)
3. **核心流程**:关键业务路径是否用 step-by-step 描述,每步的前置 / 后置条件是否明确
4. **数据模型**:涉及的核心实体、字段、状态是否被定义(名称 / 类型 / 必填 / 默认值)
5. **异常与边界**:异常分支、空值、超长、并发、超时等情况是否被显式说明
6. **验收标准**:每条需求是否有可测试的 AC(给定 / 当 / 那么 或 等价形式),且粒度不粗于单个改动点

## 判断规则

- 一处缺失 = 一条 Issue;不要把多个缺字段合并成一条
- 措辞含糊("可能"、"或许"、"大概")如果影响实现选择 → 一条 Issue
- 隐含假设(默认行为未写明)如果影响实现 → 一条 Issue
- 仅指"建议补充"而 PRD 已经写得清晰 → 不产出 Issue
- 验收标准缺失 / 不可测试 → 一条 Issue,严重度标注为 warn

## 输出约束

- 识别结果以正式问题形式通过 \`report_analysis_issue\` 提交
- 标题必须指明缺什么,描述必须给到具体段落引用
- 覆盖优先:边界问题也应报告,严重度与置信度可作为可选元数据
- 不提出解决方案,只报告问题
`

const IMPLEMENTATION_READINESS_SKILL_MD = `---
name: implementation-readiness
description: 检查 PRD 的实施准备度,识别技术风险、外部依赖、可行性盲点和验收前置条件缺失
version: 1.0.0
---

# implementation-readiness

你的任务是对用户提交的 PRD 做**实施准备度**维度的检查,识别所有可能
阻塞实现、引入风险或要求额外前置条件的事项。

## 检查目标

围绕以下 5 个子维度逐条检查(每条可独立产出 1 个 Analysis Issue):

1. **技术风险**:涉及未知技术栈、性能敏感路径、安全合规要求时是否被识别
2. **外部依赖**:是否依赖未说明的下游服务 / 第三方接口 / 内部组件,且未指明联调方式
3. **数据迁移 / 兼容性**:存量数据兼容、回滚方案、灰度策略是否缺失
4. **可观测性**:关键路径是否提及日志 / 指标 / 告警,否则实施上线后无法观察
5. **验收前置条件**:是否依赖 PRD 之外的条件(配置 / 权限 / 上游排期),且未标注获取方式

## 判断规则

- 一项风险 = 一条 Issue;不要把多个独立风险合并成一条
- 仅当风险**会阻塞**实施或上线 → 产出 Issue;不阻塞但需要关注 → 不产出
- 隐含依赖必须显式标注,否则 → 一条 Issue
- 仅"建议补充"而 PRD 已经写得清晰 → 不产出 Issue
- 与"prd-completeness"维度不重复;此处只关心实施 / 上线 / 风险,内容完整性问题留给 prd-completeness

## 输出约束

- 识别结果以正式问题形式通过 \`report_analysis_issue\` 提交
- 标题必须指明风险类型,描述必须给到具体段落引用 + 风险后果
- 覆盖优先:边界风险也应报告,严重度与置信度可作为可选元数据
- 不提出解决方案,只报告问题
`

/**
 * 内置默认 Skill 名称 → 文本的静态映射。
 *
 * 新增默认 Skill 时:
 * 1) 在 packages/shared/src/analysis-skill.ts 的
 *    `RESERVED_ANALYSIS_SKILL_NAMES` 数组追加名称
 * 2) 在本表追加同名 key,写好 SKILL.md 字面字符串
 * 3) 升级时 Agent 会强制覆盖该名称
 */
export const BUILTIN_DEFAULT_ANALYSIS_SKILLS: Readonly<Record<string, string>> = {
  'prd-completeness': PRD_COMPLETENESS_SKILL_MD,
  'implementation-readiness': IMPLEMENTATION_READINESS_SKILL_MD,
}

/**
 * 解析一段 Skill 文本,返回 frontmatter + body。
 *
 * 解析失败 → 返回 null(由 caller 决定:不覆盖,保留 Workspace 原内容)。
 * 解析成功但 frontmatter 字段不完整 → 返回 null 同理(不覆盖)。
 */
export function parseBuiltinAnalysisSkillMarkdown(
  text: string,
): { frontmatter: AnalysisSkillFrontmatter; body: string } | null {
  const split = splitSkillMarkdown(text)
  if (!split) return null
  const parsed = parseMinimalFrontmatter(split.frontmatterText)
  const r = AnalysisSkillFrontmatterSchema.safeParse(parsed)
  if (!r.success) return null
  if (split.body.trim().length === 0) return null
  return { frontmatter: r.data, body: split.body }
}
