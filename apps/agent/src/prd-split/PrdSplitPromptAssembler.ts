/**
 * PRD 拆解 Run System Prompt 装配器 — issue 05 / ADR-0027 D4
 *
 * 镜像 `analysis-run/AnalysisPromptAssembler.ts:75` 纯函数模式,但比 Analysis
 * 的九层简 —— PRD 拆解是**生成式**(产候选卡片),不是识别式(找问题),
 * 不需要 Skill 层 / 已答复上下文层 / 完成协议门禁(无 complete_analysis)。
 *
 * 四层结构:
 *   1. 身份与任务(BOARD 工位 PRD 拆解助手)
 *   2. 能力边界(Read/Glob/Grep + propose_card;禁 Bash/Write/Edit)
 *   3. 卡片提交协议(单卡单调;suggested_status 固定 backlog;title/content/priority)
 *   4. 上下文(父 analyzing transcript tail K=10 + PRD 全文 + granularity +
 *      expected_count + use_context)
 *
 * 完全替换 Claude Code 默认 system prompt(沿用 ADR-0021 决策 16 思路)。
 * 不可变纯函数(输入变化 → 重算);测试用直读字符串即可。
 */

import type { TranscriptMessage } from '@ai-devspace/shared'
import type { PrdSplitGranularityT } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 层 1-3:平台外壳(固定常量)
// ---------------------------------------------------------------------------

const L1_IDENTITY = `## 身份与任务

你是 AI-DevSpace 平台 BOARD 工位的 PRD 拆解助手。

你的任务:读取当前 Requirement 的 PRD 与父 analyzing transcript 上下文,
把需求拆为若干张**候选 TaskCard 草稿**,供用户在 board 上勾选 / 编辑 / 载入。
每识别出一张候选卡片就**立即**通过 \`propose_card\` 工具逐条提交。

**Claude Code 默认 system prompt 已被平台完全替换**。你不得沿用任何
Claude Code 默认行为(包括但不限于:主动修改文件、执行 Bash、子 Agent、
网络搜索、未声明 MCP、Skill 自动注册)。所有行为以本 system prompt 为准。`

const L2_CAPABILITY_BOUNDARY = `## 能力边界

你**只能**使用以下工具:

- **只读宿主能力**:
  - \`Read\` —— 读文件(只读;限定当前 Requirement 逻辑根内)
  - \`Glob\` —— 列举文件
  - \`Grep\` —— 文本搜索
- **受控业务工具**:
  - \`propose_card\` —— 提交一张候选 TaskCard(协议见第 3 层)

**显式禁止**(即便"为了完成任务需要"也不可调用):

- \`Bash\` / \`Write\` / \`Edit\` / \`MultiEdit\` —— 不得修改任何文件或执行副作用命令
- 未声明的 MCP 工具、子 Agent、网络搜索、网页获取 —— 全部不可用
- Claude Code 默认 Skill 自动注册、\`Skill\` / \`SlashCommand\` 工具

非交互拒绝模式生效:任何尝试调用禁止工具的请求立即被宿主层拒绝。
不得绕过或重试该类调用。`

const L3_CARD_PROTOCOL = `## 卡片提交协议

发现一张候选卡片就**立即**调用 \`propose_card\` 提交。**不要**把多条
卡片拼成大 JSON 一次提交,也不要只在普通文本里描述卡片。

工具参数契约(平台严格校验,任何字段缺失或类型错误 → 工具调用失败):

- \`title\`:**非空字符串**;一句概括这张卡要做什么(≤ 40 字)
- \`content\`:Markdown 文本;首段给一句话目标,其后给验收点 bullet 列表
- \`suggested_priority\`(可选):\`low\` / \`medium\` / \`high\` / \`urgent\` 之一,
  或 \`null\`(不指定)。缺省视为 \`medium\`。
- \`labels\`(可选):字符串数组,便于 board 端过滤。

**不要传 \`suggested_status\`** —— 平台固定为 \`backlog\`;用户在 board
确认载入时再推进状态,不在拆解阶段预判。

工具调用失败 = 该卡片**没有形成**;修复参数后重试同一调用,不要把失败
信息写到普通文本里。

拆解粒度与数量目标见第 4 层;可在 \`expected_count\` 上下浮动,但每张卡
必须有可独立推进的边界 —— 不要把整个 PRD 塞进一张卡,也不要拆得过细
到单行任务。卡片间若有明显依赖顺序,按依赖从早到晚依次提交。`

// ---------------------------------------------------------------------------
// 装配入口
// ---------------------------------------------------------------------------

export interface PrdSplitPromptInput {
  requirement_id: string
  /** PRD Markdown 全文(已 trim;非空 —— 路由层已门禁 ≥ 50 字符) */
  prd_markdown: string
  granularity: PrdSplitGranularityT
  expected_count: number
  /** 上下文勾选项(本期透传,不解读语义) */
  use_context: ReadonlyArray<string>
  /**
   * 父 analyzing transcript 末尾 K 条消息(来自
   * `readParentAnalyzingTranscript`)。空 → 渲染"无父对话上下文"占位。
   */
  parent_transcript_messages: ReadonlyArray<TranscriptMessage>
}

/**
 * 装配 PRD 拆解 Run 的 systemPrompt(四层)。
 *
 * 不可变纯函数;不读文件(父 transcript 由 caller 传入),便于单测。
 */
export function assemblePrdSplitSystemPrompt(input: PrdSplitPromptInput): string {
  const sections: string[] = []
  sections.push(L1_IDENTITY)
  sections.push(L2_CAPABILITY_BOUNDARY)
  sections.push(L3_CARD_PROTOCOL)
  sections.push(assembleL4Context(input))
  return sections.join('\n\n---\n\n')
}

/**
 * 第 4 层:当前运行范围 + 父对话上下文。
 *
 * 镜像 `AnalysisPromptAssembler` 第 9 层(PRD 全文)+ 第 8 层(已答复上下文)
 * 的拼装风格,但把"已答复 Issue Response"换成"父 transcript tail"。
 */
function assembleL4Context(input: PrdSplitPromptInput): string {
  const {
    requirement_id,
    prd_markdown,
    granularity,
    expected_count,
    use_context,
    parent_transcript_messages,
  } = input

  const lines: string[] = []
  lines.push('## 当前拆解范围')
  lines.push('')
  lines.push(`- Requirement id:**${requirement_id}**`)
  lines.push(`- 拆分粒度:**${granularity}**`)
  lines.push(`- 期望卡片数:约 **${expected_count}** 张(可上下浮动)`)
  if (use_context.length > 0) {
    lines.push(
      `- 用户勾选上下文:${use_context.map((c) => `\`${c}\``).join(', ')}`,
    )
  } else {
    lines.push('- 用户勾选上下文:(无)')
  }
  lines.push('')
  lines.push('### PRD Markdown')
  lines.push('')
  lines.push('```markdown')
  lines.push(prd_markdown)
  lines.push('```')
  lines.push('')
  lines.push('### 父 analyzing transcript 上下文(末尾 K 条)')
  lines.push('')
  if (parent_transcript_messages.length === 0) {
    lines.push('(无父对话上下文 —— 直接基于 PRD 拆解即可)')
  } else {
    lines.push('```')
    for (const m of parent_transcript_messages) {
      const role = m.role
      const content = m.content.replace(/\n/g, '\n  ')
      lines.push(`[${m.ts}] ${role}: ${content}`)
    }
    lines.push('```')
  }
  return lines.join('\n')
}

/**
 * 构造 SDK query 的用户输入。
 *
 * 镜像 `AnalysisAgentRunner.buildRunQueryPrompt:366` 风格:systemPrompt 已
 * 含全部上下文(第 4 层),user prompt 只负责明确动作 + 收尾约定。
 */
export function buildPrdSplitUserPrompt(input: {
  granularity: PrdSplitGranularityT
  expected_count: number
}): string {
  const { granularity, expected_count } = input
  return [
    `请按**${granularity}**粒度把以上 PRD 拆为约 **${expected_count}** 张候选 TaskCard,`,
    '通过 `propose_card` 逐条提交(每张卡片立刻调一次,不要拼大 JSON)。',
    '',
    'PRD 全文与父对话上下文已在 system prompt 第 4 层给出;如需进一步核对',
    '代码或文档,使用 `Read` / `Glob` / `Grep` 工具读取。',
    '',
    '提交完所有候选卡片后**正常结束本轮 turn** 即可;**不要**调用任何',
    '"完成"工具 —— 平台以 SDK turn 结束为完成信号。',
  ].join('\n')
}
