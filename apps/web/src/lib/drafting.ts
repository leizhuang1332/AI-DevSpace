/**
 * DRAFTING 工位数据层(issue 02 — PRD 顶置 + 骨架 + 进入 ANALYZING)
 *
 * 工位布局(issue 02):
 * - 主区:单个 PRD 顶置卡片(title input + PRD Markdown 编辑器 + 自动保存指示)
 * - 右栏(Inline 栏):候命 Skill 列表(由 ZoneShell 注入)
 * - 底部单一动作:[▶ 进入 ANALYZING](title + PRD 均有内容才可点)
 *
 * 本期(issue 02)不渲染的旧字段(后续 ticket 重新引入时再加回):
 * - acceptanceCriteria(AC 结构化 checklist)→ 03/04 期 PRD Markdown 自然承载
 * - repos(关联仓库多选 chips)→ 08 期 仓库底部软警告
 * - save action(💾 保存草稿)→ 自动保存已统一处理
 * - 旧"创建并启动 AI 分析"action → 新"▶ 进入 ANALYZING" 纯导航
 *
 * 设计原则:
 * - 纯函数 + 类型化;骨架生成 / 启动校验由 `packages/shared` 统一提供
 *   (跨 web/agent 复用,见 packages/shared/src/drafting.ts)
 * - 数据由 server 注入;组件纯渲染或纯客户端交互
 * - 空数据(empty=true)时,prdMarkdown 由上游组件调用 generatePrdSkeleton 填充
 *   —— 本层不预先填充,以保留"作者从空白开始"的语义
 */

import {
  generatePrdSkeleton,
  validateLaunch,
  type PrdAnchor,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 候命 Skill(Inline 栏) */
export interface DraftingSkill {
  id: string
  name: string
  description: string
  /** 触发入口文案,例如 "⌘K 唤起" / "一键启动" */
  trigger: string
}

/** 顶部 toolbar 面包屑条目 */
export interface DraftingToolbarCrumb {
  label: string
  current?: boolean
}

/** 顶部 toolbar */
export interface DraftingToolbar {
  crumb: DraftingToolbarCrumb[]
  /** 形如 "草稿 · 尚未创建";UI 顶部展示 */
  statusText: string
}

/**
 * DRAFTING 工位顶层数据(issue 02 形态)
 *
 * 与 issue 18 形态的差异:
 * - 删除 acceptanceCriteria / repos / actions
 * - 增加 skills(Inline 栏候命 Skill 列表)
 * - 自动保存周期由 autosaveIntervalMs 控制;lastSavedAt 渲染"已保存 x 秒前"
 */
export interface DraftingData {
  requirementId: string
  /** 顶部 toolbar(面包屑 + 状态文本) */
  toolbar: DraftingToolbar
  /** 标题 input 值(独立字段,与 PRD Markdown H1 解耦) */
  title: string
  /** PRD Markdown 源文;空数据(empty=true)时由组件侧 generatePrdSkeleton 填充 */
  prdMarkdown: string
  /** 候命 Skill(Inline 栏) */
  skills: DraftingSkill[]
  /** 自动保存间隔(毫秒);UI 用 setInterval 触发保存 */
  autosaveIntervalMs: number
  /** 最后保存时间(ISO 字符串;空 = 从未保存);UI 显示 "已保存 x 秒前" */
  lastSavedAt: string | null
  /** 空数据(新建需求 / 未知 id);UI 渲染空白草稿态并自动填充骨架 */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 重新导出:让 web 层只 import 这一个模块就能拿到所有 drafting 域类型/函数
// ---------------------------------------------------------------------------

export { generatePrdSkeleton, validateLaunch }
export type { PrdAnchor }

// ---------------------------------------------------------------------------
// 纯函数:PRD Markdown 章节大纲(锚点栏后续 issue 03 用,本文件先保留)
// ---------------------------------------------------------------------------

const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/**
 * 从 PRD Markdown 中解析章节大纲(只取 H1~H3)。
 *
 * 历史 API,issue 03 锚点栏会切到 shared 包的 `extractPrdAnchors`(只 H1/H2);
 * 本期保留以便兼容既有调用方。
 */
export function extractPrdOutline(
  markdown: string,
  options: { maxLevel?: number } = {},
): { level: number; title: string; line: number }[] {
  const maxLevel = options.maxLevel ?? 3
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const sections: { level: number; title: string; line: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKDOWN_HEADING_RE)
    if (!m) continue
    const level = m[1].length
    if (level > maxLevel) continue
    const title = m[2].trim()
    if (!title) continue
    sections.push({ level, title, line: i })
  }
  return sections
}

// ---------------------------------------------------------------------------
// 兜底数据(新建需求 / 未知 id)
// ---------------------------------------------------------------------------

const EMPTY_TOOLBAR: DraftingToolbar = {
  crumb: [],
  statusText: '',
}

/**
 * 空状态 DRAFTING 工位数据(全新草稿)。
 *
 * - title / prdMarkdown 均为空 —— 组件侧通过 `data.empty === true && !prdMarkdown`
 *   触发 generatePrdSkeleton 骨架填充
 * - skills 暂留空数组(后续可注入,本期不渲染)
 */
export function emptyDrafting(requirementId: string): DraftingData {
  return {
    requirementId,
    toolbar: { ...EMPTY_TOOLBAR, crumb: [] },
    title: '',
    prdMarkdown: '',
    skills: [],
    autosaveIntervalMs: 30_000,
    lastSavedAt: null,
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 [19-final-drafting.html] 的"退款功能优化"样例
// ---------------------------------------------------------------------------

const REFUND_DRAFTING: Omit<DraftingData, 'requirementId'> = {
  empty: false,
  toolbar: {
    crumb: [
      { label: '需求' },
      { label: '/' },
      { label: '退款功能优化' },
      { label: '/' },
      { label: '草稿', current: true },
    ],
    // issue 02:DRAFTING 工位无状态机(决策 15);toolbar.statusText 仅占位,
    // 不再显示"草稿 · 尚未创建"等阶段文本 —— 后续如需可由组件按需注入。
    statusText: '',
  },
  title: '退款功能优化',
  prdMarkdown: generatePrdSkeleton('退款功能优化'),
  skills: [
    {
      id: 'sk-brainstorm',
      name: 'requirement-brainstorm',
      description: '从模糊想法出发,引导你产出结构化 PRD。',
      trigger: '⌘K 唤起',
    },
    {
      id: 'sk-clarify',
      name: 'requirement-clarify',
      description: '对已写 PRD 提问 / 反问,补足模糊点。',
      trigger: '⌘K 唤起',
    },
    {
      id: 'sk-schema',
      name: 'schema-design',
      description: '基于 PRD 草拟数据库 schema 与 API 草案。',
      trigger: '一键启动',
    },
  ],
  autosaveIntervalMs: 30_000,
  lastSavedAt: null,
}

/**
 * 拉取 DRAFTING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001) → REFUND_DRAFTING 样例数据(空 PRD 字段已存,组件不填充)
 * - 未知 id / 新建需求 → emptyDrafting(id)(组件侧 detect 后调用 generatePrdSkeleton)
 *
 * 显式标注为 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getDraftingData(
  requirementId: string,
): Promise<DraftingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_DRAFTING, requirementId }
  }
  return emptyDrafting(requirementId)
}