/**
 * DRAFTING 工位数据层(ADR-0011 §6 DRAFTING 布局 · issue 18)
 *
 * Form 居中形态(对应原型 11a-stage-adaptive-draft.html):
 * - 顶部表单字段:标题 / PRD Markdown 富文本 / AC 结构化 checklist / 关联仓库多选
 * - 底部操作:[💾 保存草稿] [🚀 创建并启动 AI 分析]
 * - 资源树(左 240px):PRD 章节大纲(基于 PRD Markdown 自动生成)
 * - Inline 栏(右 120px):候命 Skill 列表(requirement-brainstorm / requirement-clarify / schema-design)
 * - 自动保存:每 30 秒写入 meta.yaml + PRD 文件草稿(本期 mock,后续接 agent API)
 *
 * 设计原则:
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:新建需求时返回 empty=true,UI 渲染空白草稿态引导
 * - 数据由 server 注入,组件本身纯渲染或纯客户端交互
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 关联仓库(只读 name;后续接 agent 时扩展 branch / latestCommit) */
export interface DraftingRepo {
  name: string
  /** 是否已被该需求关联(用于 chips 渲染:on/off 视觉) */
  selected: boolean
  /** 仓库图标(emoji);UI 增强(无逻辑依赖) */
  icon?: string
}

/** 验收标准条目 */
export interface AcceptanceCriterion {
  id: string
  /** AC 文本 */
  text: string
  /** UI 是否勾选(structural:与 checkbox 同步;本期 mock 默认 false) */
  checked: boolean
}

/** 候命 Skill(Inline 栏) */
export interface DraftingSkill {
  id: string
  name: string
  description: string
  /** 触发入口文案,例如 "⌘K 唤起" / "一键启动" */
  trigger: string
}

/** 资源树节点(PRD 章节大纲) */
export interface PrdSection {
  /** heading level(1 / 2 / 3);UI 决定缩进 */
  level: number
  /** heading 文本(去除 # 号) */
  title: string
  /** heading 行号(0-based);UI 可点击定位(本期 mock) */
  line: number
}

/** 表单顶部状态条 */
export interface DraftingToolbarCrumb {
  label: string
  current?: boolean
}

/** 表单顶部状态条 */
export interface DraftingToolbar {
  crumb: DraftingToolbarCrumb[]
  /** 形如 "草稿 · 尚未创建" / "已保存 · 12 秒前";UI 顶部展示 */
  statusText: string
}

/** 表单底部动作 */
export interface DraftingAction {
  id: 'save' | 'launch'
  label: string
  variant: 'secondary' | 'primary'
  /** data-testid 命名 hook */
  testId: string
}

/** DRAFTING 工位顶层数据 */
export interface DraftingData {
  requirementId: string
  /** 顶部 toolbar(面包屑 + 状态文本) */
  toolbar: DraftingToolbar
  /** 标题 input 值 */
  title: string
  /** PRD Markdown 源文 */
  prdMarkdown: string
  /** AC 结构化 checklist */
  acceptanceCriteria: AcceptanceCriterion[]
  /** 关联仓库候选(包含已选状态) */
  repos: DraftingRepo[]
  /** 候命 Skill(Inline 栏) */
  skills: DraftingSkill[]
  /** 底部操作 */
  actions: DraftingAction[]
  /** 自动保存间隔(毫秒);UI 用 setInterval 触发保存 */
  autosaveIntervalMs: number
  /** 最后保存时间(ISO 字符串;空 = 从未保存);UI 顶部 "已保存 x 秒前" */
  lastSavedAt: string | null
  /** 空数据(新建需求 / 未知 id);UI 渲染空白表单(初始空值) */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 纯函数:PRD Markdown 解析 / 表单校验 / 数据派生
// ---------------------------------------------------------------------------

const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/

/**
 * 从 PRD Markdown 中解析章节大纲(只取 H1~H3,过滤空标题)。
 *
 * 用于资源树章节大纲的实时同步。返回的 line 是源 Markdown 中的 0-based 行号。
 */
export function extractPrdOutline(
  markdown: string,
  options: { maxLevel?: number } = {},
): PrdSection[] {
  const maxLevel = options.maxLevel ?? 3
  if (!markdown) return []
  const lines = markdown.split(/\r?\n/)
  const sections: PrdSection[] = []
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

/**
 * 表单完备度校验(issue 18 验收 #2:填写标题/PRD/AC 后可点保存草稿):
 * - title 必填(spec 要求"填写标题/PRD/AC 后...")
 * - PRD Markdown 必填
 *
 * 注意:spec 没要求 launch 必须 AC ≥ 1 条 —— 此处只校验"可以保存"。
 * launch 的额外约束(后续 spec 决定)由调用方叠加。
 *
 * 返回:
 * - canSubmit: 是否可点 [🚀 创建并启动 AI 分析]
 * - canSave: 是否可点 [💾 保存草稿](草稿任何时候都能存,但空表单没必要)
 * - missing: 缺失字段名列表(用于 Inline 栏"⛔ 标题不能为空"类提示)
 */
export interface DraftingFormValidity {
  canSubmit: boolean
  canSave: boolean
  missing: string[]
}

export function validateDraftingForm(input: {
  title: string
  prdMarkdown: string
  acceptanceCriteria: AcceptanceCriterion[]
}): DraftingFormValidity {
  const missing: string[] = []
  if (!input.title.trim()) missing.push('title')
  if (!input.prdMarkdown.trim()) missing.push('prd')
  // 注意:spec 没要求 launch 必须 AC ≥ 1 条 —— launch 额外约束(若有)由调用方叠加
  return {
    canSubmit: missing.length === 0,
    canSave: true,
    missing,
  }
}

// ---------------------------------------------------------------------------
// 兜底数据(新建需求 / 未知 id)
// ---------------------------------------------------------------------------

const EMPTY_TOOLBAR: DraftingToolbar = {
  crumb: [],
  statusText: '',
}

/**
 * 默认底部动作(空草稿也要展示两个按钮 —— disabled 状态由
 * 组件根据表单完备度决定,而不是数据缺失)。
 */
const DEFAULT_ACTIONS: DraftingAction[] = [
  {
    id: 'save',
    label: '💾 保存草稿',
    variant: 'secondary',
    testId: 'drafting-action-save',
  },
  {
    id: 'launch',
    label: '🚀 创建并启动 AI 分析',
    variant: 'primary',
    testId: 'drafting-action-launch',
  },
]

/**
 * 空状态 DRAFTING 工位数据(全新草稿)。
 * 组件渲染时若 data.empty === true → 渲染空白表单(标题/PRD/AC/仓库全空,等用户填写)。
 */
export function emptyDrafting(requirementId: string): DraftingData {
  return {
    requirementId,
    toolbar: { ...EMPTY_TOOLBAR, crumb: [] },
    title: '',
    prdMarkdown: '',
    acceptanceCriteria: [],
    repos: [],
    skills: [],
    actions: DEFAULT_ACTIONS,
    autosaveIntervalMs: 30000,
    lastSavedAt: null,
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 [11a-stage-adaptive-draft.html] 的"退款功能优化"样例
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
    statusText: '草稿 · 尚未创建',
  },
  title: '退款功能优化',
  prdMarkdown: `# 退款功能优化

## 背景

用户发起退款申请后,当前需人工审核,平均耗时约 2 天,投诉率高。

## 目标

- 退款流程自动化,减少人工介入
- 提升退款到账速度与成功率

## 验收标准

- [ ] 退款成功率 ≥ 99%
- [ ] 平均退款时长 ≤ 30s
- [ ] 失败自动重试并通知用户

## 非目标

- 不覆盖跨境退款
- 不修改支付链路本身
`,
  acceptanceCriteria: [
    { id: 'ac-1', text: '退款成功率 ≥ 99%', checked: false },
    { id: 'ac-2', text: '平均退款时长 ≤ 30s', checked: false },
    { id: 'ac-3', text: '失败自动重试并通知用户', checked: false },
  ],
  repos: [
    { name: 'refund-service', selected: true, icon: '📦' },
    { name: 'order-service', selected: true, icon: '📦' },
    { name: 'coupon-service', selected: false, icon: '📦' },
    { name: 'payment-gateway', selected: false, icon: '📦' },
  ],
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
  actions: DEFAULT_ACTIONS,
  autosaveIntervalMs: 30000,
  lastSavedAt: null,
}

/**
 * 拉取 DRAFTING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001) → REFUND_DRAFTING 样例数据
 * - 未知 id / 新建需求 → emptyDrafting(id)
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