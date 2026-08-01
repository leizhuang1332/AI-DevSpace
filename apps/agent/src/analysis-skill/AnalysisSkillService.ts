/**
 * Analysis Skill 服务(issue 01 · ADR-0021)
 *
 * 职责:
 * 1. 启动时初始化 + 升级覆盖:确保 `<workspaceRoot>/analysis-skills/`
 *    存在,reserved 名称的 SKILL.md 用系统版本强制覆盖,其他名称保留
 * 2. 列出 Analysis Skill:扫描独立集合,按 frontmatter 校验,跳过非法项,
 *    按 name 字典序排序
 * 3. Per-Requirement 已选择 Skill 持久化:读 / 写
 *    `<root>/requirements/<reqId>/analysis/selected-skill.yaml`
 *
 * 集合隔离(issue 01 acceptance 3):
 * - 只扫描 `<workspaceRoot>/analysis-skills/`
 * - **不**扫描 `~/.aidevspace/skills/`(user Skill)
 * - **不**扫描 agent 内置 `apps/agent/skills/built-in/`(regular Skill)
 * - **不**扫描项目根目录或 .claude 目录(项目 Skill)
 *
 * 非法 Skill 处理(issue 01 acceptance 8 + 验收 4):
 * - frontmatter 缺字段(name / description / version)→ 跳过
 * - description 为空字符串 → 跳过
 * - body 为空(trim 后 0 字符)→ 跳过
 * - version 不是 semver → 跳过
 * - 跳过但**不**删除盘上文件(避免数据损失)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import yaml from 'yaml'
import {
  AnalysisSkillMetaSchema,
  RESERVED_ANALYSIS_SKILL_NAMES,
  isReservedAnalysisSkillName,
  parseMinimalFrontmatter,
  splitSkillMarkdown,
  type AnalysisSkillMeta,
} from '@ai-devspace/shared'
import {
  BUILTIN_DEFAULT_ANALYSIS_SKILLS,
  parseBuiltinAnalysisSkillMarkdown,
} from './builtin-defaults.js'

/** `<root>/analysis-skills/` 单点真相 —— service + route 共享。 */
export function analysisSkillsDirFor(workspaceRoot: string): string {
  return join(workspaceRoot, 'analysis-skills')
}

export interface LoadSkillResult {
  meta: AnalysisSkillMeta
  body: string
}

export interface InitAnalysisSkillsResult {
  /** 启动时强制覆盖的 reserved Skill 名称(便于日志 / 测试断言) */
  upgradedReserved: string[]
  /** 启动时新建(首次安装)reserved Skill 名称 */
  seededReserved: string[]
  /** 启动时删除的旧 reserved 目录(目前保留 → 永远空;为未来清理预留) */
  prunedReserved: string[]
  /** 初始化结束时的 Skill 数量(只含合法 Skill) */
  finalCount: number
}

export interface PerRequirementSelection {
  selectedSkillName: string
  /** selection 文件存在且可解析;不存在 / 解析失败 / 已记住名不可用 → false */
  available: boolean
}

export class AnalysisSkillService {
  constructor(public readonly workspaceRoot: string) {}

  /** 物理目录绝对路径 */
  get skillsDir(): string {
    return analysisSkillsDirFor(this.workspaceRoot)
  }

  /**
   * 启动时初始化 + 升级覆盖(issue 01 acceptance 1 + 2):
   *
   * - 确保 `<root>/analysis-skills/` 存在
   * - 对每个 reserved 名称:
   *   - 目录不存在 → 用内置默认 SKILL.md 写盘
   *   - 目录已存在 → 强制覆盖 SKILL.md 为最新内置默认(其他字段保持空)
   *     (issue 01 acceptance 2:应用升级用系统版本强制覆盖同名默认)
   * - 其他名称(用户上传的)→ **不**触碰
   */
  init(): InitAnalysisSkillsResult {
    const dir = this.skillsDir
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    const upgraded: string[] = []
    const seeded: string[] = []
    for (const reservedName of RESERVED_ANALYSIS_SKILL_NAMES) {
      const defaultMd = BUILTIN_DEFAULT_ANALYSIS_SKILLS[reservedName]
      if (!defaultMd) continue
      const reservedDir = join(dir, reservedName)
      const targetPath = join(reservedDir, 'SKILL.md')
      if (!existsSync(reservedDir)) {
        // 首次安装 → 建目录 + 写默认
        mkdirSync(reservedDir, { recursive: true })
        writeFileSync(targetPath, defaultMd, 'utf8')
        seeded.push(reservedName)
      } else {
        // 升级覆盖:用最新内置 SKILL.md 强制覆盖(其他文件保留)
        // issue 01 acceptance 2:同 reserved 名称 → 系统版本覆盖;其他名称不动
        const current = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : ''
        if (current !== defaultMd) {
          writeFileSync(targetPath, defaultMd, 'utf8')
          upgraded.push(reservedName)
        }
      }
    }
    return {
      upgradedReserved: upgraded,
      seededReserved: seeded,
      prunedReserved: [],
      finalCount: this.listAllSkills().length,
    }
  }

  /**
   * 列出当前所有合法 Analysis Skill(只读,每次实时 readdir)。
   *
   * 容错策略:
   * - 目录不存在 → []
   * - 子目录无 SKILL.md → 跳过
   * - SKILL.md frontmatter 缺字段 / 类型错 → 跳过
   * - body 为空 → 跳过
   * - version 非 semver → 跳过
   * - 跳过的文件不删除(只读)
   *
   * 排序:按 name 字典序(展示稳定,issue 01 acceptance 7"稳定选择第一项"前提)
   */
  listAllSkills(): LoadSkillResult[] {
    const dir = this.skillsDir
    if (!existsSync(dir)) return []
    let entries: { name: string; isDir: boolean }[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, isDir: true }))
    } catch {
      return []
    }
    const out: LoadSkillResult[] = []
    for (const entry of entries) {
      const loaded = this.loadOne(entry.name)
      if (loaded) out.push(loaded)
    }
    // 稳定排序:name 字典序
    out.sort((a, b) => a.meta.name.localeCompare(b.meta.name))
    return out
  }

  /** 把 LoadSkillResult[] 拍成不带 body 的 list 形态(暴露给 HTTP API)。 */
  toMetaList(skills: readonly LoadSkillResult[]): AnalysisSkillMeta[] {
    return skills.map((s) => s.meta)
  }

  /**
   * 读单个 Skill。失败 / 非法 → null。
   *
   * 注意:本方法只读不修改;非法 Skill 不会被自动删除(避免数据损失)。
   * 删除工作交给用户手动操作(本期不开放上传 / 删除 UI)。
   */
  loadOne(name: string): LoadSkillResult | null {
    if (!name) return null
    const dir = join(this.skillsDir, name)
    if (!existsSync(dir)) return null
    const filePath = join(dir, 'SKILL.md')
    if (!existsSync(filePath)) return null
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch {
      return null
    }
    const split = splitSkillMarkdown(raw)
    if (!split) return null
    const fm = parseMinimalFrontmatter(split.frontmatterText)
    // 构造候选对象,丢给 shared schema 做总校验
    const candidate = {
      name: fm.name ?? name,
      description: fm.description ?? '',
      version: fm.version ?? '',
      is_reserved: isReservedAnalysisSkillName(fm.name ?? name),
    }
    const parsed = AnalysisSkillMetaSchema.safeParse(candidate)
    if (!parsed.success) return null
    if (split.body.trim().length === 0) return null
    return { meta: parsed.data, body: split.body }
  }

  // =========================================================================
  // Per-Requirement 已选择 Skill 持久化
  // =========================================================================

  /** `<root>/requirements/<reqId>/analysis/selected-skill.yaml` 路径 */
  selectionPathFor(requirementId: string): string {
    if (!requirementId) {
      throw new Error('requirementId is required')
    }
    return join(
      this.workspaceRoot,
      'requirements',
      requirementId,
      'analysis',
      'selected-skill.yaml',
    )
  }

  /**
   * 读出该 Requirement 上次选择的 Skill 名称。
   *
   * - 文件不存在 / 解析失败 → `selectedSkillName = ''`(调用方回退到首项)
   * - 已记住名 → 返该名(由调用方再校验是否仍在 available_skills 中)
   */
  readSelection(requirementId: string): PerRequirementSelection {
    const filePath = this.selectionPathFor(requirementId)
    if (!existsSync(filePath)) {
      return { selectedSkillName: '', available: false }
    }
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = yaml.parse(raw) as unknown
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { skill_name?: unknown }).skill_name === 'string'
      ) {
        const name = (parsed as { skill_name: string }).skill_name.trim()
        if (name.length > 0) {
          return { selectedSkillName: name, available: true }
        }
      }
    } catch {
      /* 解析失败 → 当作无 selection,不影响后续 */
    }
    return { selectedSkillName: '', available: false }
  }

  /**
   * 写入已选择 Skill。
   *
   * - 文件缺失父目录时自动 mkdir(与 tickets 01/02 同款"宽容落盘")
   * - 用 yaml 序列化(decision 2"纯文件系统")写入
   * - 写盘失败抛错(由 caller 决定 500 vs 静默)
   */
  writeSelection(requirementId: string, skillName: string): void {
    const filePath = this.selectionPathFor(requirementId)
    mkdirSync(dirname(filePath), { recursive: true })
    const payload = {
      skill_name: skillName,
      updated_at: new Date().toISOString(),
    }
    // atomic write(tmp + rename)避免 PUT 写到一半进程被杀时 YAML 撕裂
    // 与 `WorkspaceService.writeFileAtomic` 同款(decision 47 一致)
    writeFileAtomic(filePath, yaml.stringify(payload))
  }

  /**
   * 计算最终生效的 selected_skill_name —— 决策 7 / 8 落点:
   * - 有 selection 且对应 Skill 仍在 available_skills → 沿用
   * - 无 selection(从未记住)→ 回退到首项,reason='fresh_first_use'
   * - 已记住名不存在(Skill 被删)→ 回退到首项,reason='remembered_name_missing'
   *   (issue 01 acceptance 7"安全回退";UI 借此给用户提示,避免静默吞掉选择)
   * - 完全无可用 Skill → 空字符串,reason='no_skills'
   */
  resolveSelection(
    requirementId: string,
    availableSkills: readonly AnalysisSkillMeta[],
  ): {
    selectedSkillName: string
    available: boolean
    fallbackReason: 'fresh_first_use' | 'remembered_name_missing' | 'no_skills' | null
  } {
    const persisted = this.readSelection(requirementId)
    if (
      persisted.available &&
      availableSkills.some((s) => s.name === persisted.selectedSkillName)
    ) {
      // 沿用已记住的选择
      return {
        selectedSkillName: persisted.selectedSkillName,
        available: true,
        fallbackReason: null,
      }
    }
    if (availableSkills.length === 0) {
      return { selectedSkillName: '', available: false, fallbackReason: 'no_skills' }
    }
    // 区分"首次使用"(无 selection)vs"已记住名丢失"(selection 存在但 Skill 没了)
    return {
      selectedSkillName: availableSkills[0].name,
      available: false,
      fallbackReason: persisted.available
        ? 'remembered_name_missing'
        : 'fresh_first_use',
    }
  }
}

/**
 * 调试 / 强制重置辅助:删除 `<root>/analysis-skills/<name>/`(本 ticket 内
 * 不挂路由,仅供测试 setup 制造"残留状态"使用)。
 *
 * 公开它便于 e2e 测试写"用户手工改坏了 reserved Skill"的场景。
 */
export function purgeAnalysisSkillDir(workspaceRoot: string): void {
  const dir = analysisSkillsDirFor(workspaceRoot)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

/**
 * 原子写文件 —— tmp + rename 模式。
 * 与 `WorkspaceService.writeFileAtomic` 同款(避免 PUT 写到一半进程被杀
 * 时 YAML 撕裂);不在 service 里 import WorkspaceService 是为了避免
 * service ↔ service 互相耦合。代价:20 行复制(比抽象更易读)。
 */
function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(tmp, content, 'utf8')
  renameSync(tmp, target)
}
