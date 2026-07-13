/**
 * SystemPromptAssembler —— ADR-0010 Q5 (System prompt 装配)
 *
 * 两段装配:
 *   assembleBase(session, deps)
 *     per-session base:平台哲学 + Always-on Skills 全文 + On-arming Skills 元数据
 *     不变,放 per-session 缓存
 *
 *   assembleDynamic(query, session, req, deps)
 *     per-query dynamic:当前 focus + 99-summary + relevant Skill 反馈
 *     每次 send() 重算
 *
 * markdown 分节(ADR-0010 Q5.3):
 *   ## Platform Philosophy
 *   ## Active Skills (Always-on)
 *   ## On-arming Skills
 *   ## Current Context
 *   ## Skill Feedback
 *
 * 文件依赖(Q5.4 严格按 Skill 自报家门):
 *   - Skill frontmatter.context: 声明依赖文件路径
 *   - Assembler 去重求并集 + 按 Skill 分组渲染(不是平铺成一段)
 *
 * 设计取舍:
 *  - **不解析 shell / glob**:Q5.4 路径就当成相对于 requirement root 的相对路径直接拼,
 *    调 fs.readFile 读不到 → 跳过该条,不阻断装配
 *  - **Always-on Skill 全文进 prompt** —— 决策 40 / ADR-0008
 *  - **On-arming Skill 仅 name + description** —— 决策 40
 *  - **失败容错**:context 文件读不到 / Skill 解析失败 → 装配跳过,不让整个 send() 失败
 *  - **decision 48 反馈通道**:relevant Skill = 命中当前 query 关键词的 Skill;
 *    本期用最朴素的「Skill name 在 query 文本里出现」匹配,后续可换 fuzzy
 */
import { readFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import {
  createSkillLoader,
  extractBadFeedback,
  extractContextPaths,
  type ArmingLevel,
  type Skill,
  type SkillFrontmatter,
  type SkillLoader,
} from './SkillLoader.js'

/** session 元信息(Assembler 关心的最小集) */
export interface AssemblerSession {
  id: string
  reqId: string
  kind: 'chat' | 'task'
  topic: string
}

/** requirement 元信息(Assembler 关心的最小集) */
export interface AssemblerRequirement {
  reqId: string
  /** meta.yaml.current_focus(决策 52 / ADR-0011) */
  currentFocus?: string
  /** req 根目录绝对路径;读 context 文件时拼绝对路径 */
  rootPath: string
}

/** Assembler 依赖注入 */
export interface AssemblerDeps {
  /** Skill 根目录;默认 ~/.aidevspace/skills/ */
  skillsRoot: string
  /** 文件系统读取(默认 node:fs/promises.readFile);测试时可注入 */
  readFile?: (path: string) => Promise<string>
  /** 平台哲学原文;默认用内置常量 PLATFORM_PHILOSOPHY(避免依赖外部资源) */
  platformPhilosophy?: string
}

/**
 * 平台哲学 —— 摘自 CONTEXT.md「AI 协作哲学」章节。
 * 默认值,可被 deps.platformPhilosophy 覆盖(便于运行时配置 / 测试)。
 */
export const PLATFORM_PHILOSOPHY = `You are an AI partner in AI-DevSpace.

Core tenets (per CONTEXT.md decisions 24, 38-43):
- "不打扰，但陪伴；克制，在场" — you are present but not pushy; you never decide the user's next step.
- User is the lead; AI is the safety net.
- Every AI action (watching, asking, pushing, writing) must be auditable.

Workflow rules:
- No state machine, no forced sequence. The user may skip, reorder, or repeat any step.
- Skills are prompt fragments, not "running skills". Don't claim a skill is "executing" — just see the prompt and apply it.
- Never auto-load a skill's full body from inference alone. Only the system (skill loader) decides what's in your prompt.
- When uncertain: ask via the pending adjudication channel; do not push unsolicited suggestions.

Output rules:
- Be concise. No filler.
- Show facts, paths, options. Don't perform remorse on errors.
`

export interface SystemPromptAssembler {
  /** per-session base: 平台哲学 + Always-on Skills 全文 + On-arming Skills 元数据 */
  assembleBase(session: AssemblerSession): Promise<string>
  /** per-query dynamic: focus + 99-summary + relevant Skill 反馈 + Skill context 文件 */
  assembleDynamic(input: {
    query: string
    session: AssemblerSession
    req: AssemblerRequirement
    /** 99-summary 文件绝对路径(可选);读不到 → 跳过本节 */
    summaryPath?: string
  }): Promise<string>
  /**
   * 清掉 per-session base 缓存(Skill 文件变更后调用,下次 assembleBase 重算)。
   * 测试 + 维护入口。
   */
  resetBaseCache(): void
}

export function createSystemPromptAssembler(deps: AssemblerDeps): SystemPromptAssembler {
  const skillLoader: SkillLoader = createSkillLoader()
  const readFileFn = deps.readFile ?? defaultReadFile
  const platformPhilosophy = deps.platformPhilosophy ?? PLATFORM_PHILOSOPHY

  /** per-session base 缓存: session.id → 拼好的 base 字符串 */
  const baseCache = new Map<string, string>()

  async function assembleBase(session: AssemblerSession): Promise<string> {
    const cached = baseCache.get(session.id)
    if (cached !== undefined) return cached

    const skills = await skillLoader.loadAll(deps.skillsRoot)
    const always = skills.filter((s) => getArming(s.frontmatter) === 'always')
    const onArming = skills.filter((s) => getArming(s.frontmatter) === 'on-arming')

    const sections: string[] = []
    sections.push('## Platform Philosophy')
    sections.push(platformPhilosophy)

    sections.push('## Active Skills (Always-on)')
    if (always.length === 0) {
      sections.push('(no always-on skills configured)')
    } else {
      for (const s of always) {
        sections.push(`### ${s.name}`)
        sections.push(s.body.length > 0 ? s.body : '(empty skill body)')
      }
    }

    sections.push('## On-arming Skills')
    if (onArming.length === 0) {
      sections.push('(no on-arming skills)')
    } else {
      for (const s of onArming) {
        const desc = s.frontmatter.description ?? '(no description)'
        sections.push(`- **${s.name}** — ${desc}`)
      }
    }

    const result = sections.join('\n\n')
    baseCache.set(session.id, result)
    return result
  }

  async function assembleDynamic(input: {
    query: string
    session: AssemblerSession
    req: AssemblerRequirement
    summaryPath?: string
  }): Promise<string> {
    const { query, session, req, summaryPath } = input

    const allSkills = await skillLoader.loadAll(deps.skillsRoot)
    // relevant = 当前 query 命中的 Skill(朴素的子串匹配)
    const relevant = pickRelevantSkills(allSkills, query)

    const sections: string[] = []

    sections.push('## Current Context')
    const ctxLines: string[] = []
    if (req.currentFocus) {
      ctxLines.push(`- **Current focus**: ${req.currentFocus}`)
    } else {
      ctxLines.push('- **Current focus**: (not set)')
    }
    ctxLines.push(`- **Session topic**: ${session.topic}`)
    ctxLines.push(`- **Session kind**: ${session.kind}`)
    sections.push(ctxLines.join('\n'))

    if (summaryPath) {
      const summary = await safeReadFile(readFileFn, summaryPath)
      if (summary) {
        sections.push('### 99-summary')
        sections.push(summary)
      }
    }

    // Skill context 文件(严格按 Skill 自报家门)—— 去重求并集,按 Skill 分组渲染
    const ctxBySkill = await collectSkillContext(relevant, req.rootPath, readFileFn)
    if (ctxBySkill.size > 0) {
      sections.push('### Skill context files')
      for (const [skillName, blocks] of ctxBySkill.entries()) {
        sections.push(`#### ${skillName}`)
        for (const block of blocks) sections.push(block)
      }
    }

    // Skill 反馈(决策 48 👎 通道)
    const feedbackLines: string[] = []
    for (const s of relevant) {
      const lines = extractBadFeedback(s.frontmatter)
      if (lines.length > 0) {
        feedbackLines.push(`#### ${s.name}`)
        for (const l of lines) feedbackLines.push(l)
      }
    }
    if (feedbackLines.length > 0) {
      sections.push('## Skill Feedback')
      sections.push(feedbackLines.join('\n'))
    }

    return sections.join('\n\n')
  }

  /** 清 base 缓存(测试 / Skill 变更时使用) */
  function resetBaseCache(): void {
    baseCache.clear()
  }

  return {
    assembleBase,
    assembleDynamic,
    resetBaseCache,
  }
}

function getArming(fm: SkillFrontmatter): ArmingLevel {
  const a = fm.arming
  if (a === 'always' || a === 'on-arming' || a === 'dormant') return a
  // 缺省按 ADR-0008 默认 = on-arming
  return 'on-arming'
}

/** 朴素的 relevant 匹配 —— Skill name 在 query 文本里出现(忽略大小写) */
function pickRelevantSkills(skills: Skill[], query: string): Skill[] {
  if (!query) return []
  const q = query.toLowerCase()
  const hits: Skill[] = []
  for (const s of skills) {
    const name = s.name.toLowerCase()
    if (name.length === 0) continue
    if (q.includes(name)) hits.push(s)
  }
  return hits
}

/** 读 relevant Skill 的 context: 字段声明的文件 → 按 Skill 分组,返回渲染好的 markdown blocks */
async function collectSkillContext(
  skills: Skill[],
  reqRoot: string,
  readFileFn: (path: string) => Promise<string>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  // 去重:(skillName, absPath) → Set
  const seen = new Set<string>()
  for (const s of skills) {
    const paths = extractContextPaths(s.frontmatter)
    if (paths.length === 0) continue
    const blocks: string[] = []
    for (const p of paths) {
      const absPath = isAbsolute(p) ? p : join(reqRoot, p)
      const key = `${s.name}:${absPath}`
      if (seen.has(key)) continue
      seen.add(key)
      const content = await safeReadFile(readFileFn, absPath)
      if (!content) continue
      blocks.push(`- **${p}**:\n\n\`\`\`\n${content}\n\`\`\``)
    }
    if (blocks.length > 0) out.set(s.name, blocks)
  }
  return out
}

async function safeReadFile(
  fn: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    const text = await fn(path)
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

async function defaultReadFile(path: string): Promise<string> {
  return readFile(path, 'utf8')
}