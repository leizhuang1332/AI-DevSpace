/**
 * SkillLoader —— ADR-0010 Q5.4 + ADR-0008
 *
 * 解析 Skill SKILL.md frontmatter + 正文,提供「按目录扫」+「按名查」两个核心能力。
 *
 * frontmatter 字段(摘自 ADR-0008 + CONTEXT 决策 38-43,46-48):
 *   - name            Skill 名
 *   - description     1 句描述(进 On-arming system prompt)
 *   - arming          'always' | 'on-arming' | 'dormant'   (ADR-0008 装填深度三档)
 *   - triggers        声明式规则(本期不解析,仅读出)
 *   - hint            UI 提示(本期不解析,仅读出)
 *   - artifacts       产物种类
 *   - context         Skill 自报家门的依赖文件(glob 列表);Q5.4
 *   - bad_feedback    决策 48 👎 沉淀;Q5 dynamic 装配时由调用方追加到 system prompt
 *
 * 设计要点:
 *  - **不解析 shell / 不展开 glob** —— context: 是 Skill 自己声明的依赖,
 *    实际加载由 SystemPromptAssembler 调用 readFileSkillContext() 完成(本期先按
 *    "原样返回声明列表" 的方式实现,Q5.4 路径去重求并集放在 Assembler)
 *  - **YAML 容错** —— parseYamlSafe 返回 null 时本文件视为不可用,不影响其他 Skill
 *  - **空目录 / 缺文件 → 空数组**,不 throw(供装配阶段按需报错)
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/** 装填深度 —— ADR-0008 决策 40 */
export type ArmingLevel = 'always' | 'on-arming' | 'dormant'

/** Skill frontmatter 元信息(本体形态) */
export interface SkillFrontmatter {
  name?: string
  description?: string
  /** ADR-0008 决策 40:三档之一 */
  arming?: ArmingLevel
  /** 触发规则声明;本期不解析结构,仅保留原文 */
  triggers?: unknown
  /** UI 提示;本期不解析结构 */
  hint?: unknown
  /** 产物种类列表 */
  artifacts?: unknown
  /** Skill 自报家门的依赖文件路径(glob);Q5.4 */
  context?: unknown
  /** 决策 48:👎 反馈历史 */
  bad_feedback?: unknown
}

/** 一个解析后的 Skill 完整形态 */
export interface Skill {
  /** Skill 名(取 frontmatter.name,缺省用目录名) */
  name: string
  /** Skill 目录绝对路径 */
  path: string
  /** frontmatter 元信息 */
  frontmatter: SkillFrontmatter
  /** SKILL.md 正文(去掉 frontmatter 后的 markdown body) */
  body: string
}

/** SkillLoader 公共接口 */
export interface SkillLoader {
  /** 扫描目录(顶层子目录 + _built-in / user 平铺),解析 SKILL.md */
  loadAll(rootDir: string): Promise<Skill[]>
  /** 按名取 Skill;找不到 → undefined */
  findByName(rootDir: string, name: string): Promise<Skill | undefined>
}

/**
 * 解析单个 SKILL.md 文本,得到 {frontmatter, body}。
 *
 * frontmatter 形态 = `---` 包围的 YAML 块;后跟 markdown body。
 * - 文件无 frontmatter → frontmatter = {},body = 原文
 * - YAML 解析失败 → 返回 null(调用方决定 skip / 抛错)
 */
export function parseSkillMarkdown(
  text: string,
): { frontmatter: SkillFrontmatter; body: string } | null {
  // 容错 BOM
  // eslint-disable-next-line no-irregular-whitespace
  const trimmed = text.replace(/^﻿/, '')
  // frontmatter 必须以 --- 开头,跟一行换行
  if (!trimmed.startsWith('---\n') && trimmed !== '---') {
    return { frontmatter: {}, body: trimmed }
  }
  // 必须找第二个 --- 行作为 frontmatter 结束
  const rest = trimmed.slice(4)
  // \n---\n 或 \n--- 结束
  const endIdx = rest.search(/\n---\s*(?:\n|$)/)
  if (endIdx < 0) {
    // 没找到结束标记,整篇视为 body(无 frontmatter)
    return { frontmatter: {}, body: trimmed }
  }
  const yamlText = rest.slice(0, endIdx)
  let parsed: unknown
  try {
    parsed = parseYaml(yamlText)
  } catch {
    return null
  }
  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body: trimmed }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const body = rest.slice(endIdx).replace(/^\n---\s*/, '').replace(/^\n+/, '')
  return { frontmatter: parsed as SkillFrontmatter, body }
}

/**
 * 把 frontmatter.context 字段(可能是 string / string[] / undefined)归一化
 * 为字符串数组;供 SystemPromptAssembler 做去重求并集(Q5.4 严格按 Skill 自报家门)。
 *
 * 不做 glob 展开 —— SkillLoader 只读出声明,具体怎么解析由 Assembler 决定。
 */
export function extractContextPaths(fm: SkillFrontmatter): string[] {
  const ctx = fm.context
  if (typeof ctx === 'string' && ctx.length > 0) return [ctx]
  if (Array.isArray(ctx)) {
    const out: string[] = []
    for (const item of ctx) {
      if (typeof item === 'string' && item.length > 0) out.push(item)
    }
    return out
  }
  return []
}

/**
 * 把 frontmatter.bad_feedback 字段归一化为字符串列表(每条 = 一行反馈记录)。
 *
 * 形态约定(决策 48):
 *   bad_feedback:
 *     - category: 内容错误
 *       date: 2026-07-10
 *       note: 退款金额写成了负数
 *     - category: 违反规范
 *       note: 字段命名应该 snake_case
 *
 * 容错:允许任意形态,尽力抽 category + note 拼成一行;
 * 实在抽不出 → 用 JSON.stringify 兜底。
 */
export function extractBadFeedback(fm: SkillFrontmatter): string[] {
  const bf = fm.bad_feedback
  if (!Array.isArray(bf)) return []
  const out: string[] = []
  for (const item of bf) {
    if (typeof item === 'string') {
      out.push(item)
      continue
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      const category = typeof obj['category'] === 'string' ? obj['category'] : null
      const note = typeof obj['note'] === 'string' ? obj['note'] : null
      if (category && note) {
        out.push(`- [${category}] ${note}`)
      } else if (note) {
        out.push(`- ${note}`)
      } else {
        // 实在抽不出结构 → 整段 JSON
        try {
          out.push(`- ${JSON.stringify(obj)}`)
        } catch {
          /* skip */
        }
      }
    }
  }
  return out
}

export function createSkillLoader(): SkillLoader {
  async function loadAll(rootDir: string): Promise<Skill[]> {
    let entries: Array<{ name: string; isDir: boolean }>
    try {
      const list = await readdir(rootDir, { withFileTypes: true })
      entries = list
        .filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, isDir: true }))
    } catch {
      return []
    }

    const out: Skill[] = []
    for (const entry of entries) {
      const dirPath = join(rootDir, entry.name)
      const skill = await loadOne(dirPath, entry.name)
      if (skill) out.push(skill)
    }
    return out
  }

  async function findByName(rootDir: string, name: string): Promise<Skill | undefined> {
    if (!name) return undefined
    const dirPath = join(rootDir, name)
    return (await loadOne(dirPath, name)) ?? undefined
  }

  return { loadAll, findByName }
}

/** 读一个 Skill 目录下的 SKILL.md,解析为 Skill;解析失败 → null */
async function loadOne(dirPath: string, dirName: string): Promise<Skill | null> {
  const filePath = join(dirPath, 'SKILL.md')
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return null
  }
  const parsed = parseSkillMarkdown(raw)
  if (!parsed) return null
  const name = parsed.frontmatter.name ?? dirName
  return {
    name,
    path: dirPath,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  }
}