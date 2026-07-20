/**
 * DRAFTING 工位数据层(issue 02 — PRD 顶置 + 骨架 + 进入 ANALYZING;
 * 后续 issue 04 — 辅助文件卡片 + 拖拽分割扩展;
 * issue 08 — 仓库底部条 + 软警告 + 启动按钮迁入底部条;
 * issue 06 — 注入真实仓库池 via GET /api/repos)
 *
 * 工位布局(issue 08 形态):
 * - 主区:上下两块 — PRD 顶置卡片 + 拖拽分割条 + 辅助文件卡片网格
 * - 右栏(Inline 栏):候命 Skill 列表(由 ZoneShell 注入)
 * - **底部 sticky 条**:仓库多选 chips + 软警告 + [▶ 进入 ANALYZING]
 *   (启动按钮已从 PRD 卡片脚迁到此处;validity 仍只取决于 title + PRD)
 *
 * 设计原则:
 * - 纯函数 + 类型化;骨架生成 / 启动校验由 `packages/shared` 统一提供
 *   (跨 web/agent 复用,见 packages/shared/src/drafting.ts)
 * - 数据由 server 注入;组件纯渲染或纯客户端交互
 * - 空数据(empty=true)时,prdMarkdown 由上游组件调用 generatePrdSkeleton 填充
 *   —— 本层不预先填充,以保留"作者从空白开始"的语义
 * - 分割比例(issue 04)以 ratio 数值形式暴露给 UI 层;clamp 由 `clampSplitRatio`
 *   纯函数集中负责,UI 仅负责把 mouse drag / 键盘事件映射成 ratio delta
 * - 软警告阈值(issue 08)以纯函数 `shouldShowRepoSoftWarning` 暴露;
 *   UI 仅负责在 selectedRepoIds 变化时调一次拿到 boolean
 *
 * issue 06 注入(ADR-0016):
 * - `emptyDrafting(id)` 保留同步形态,repos 用 GLOBAL_REPO_POOL 作 fixture。
 *   它是单测 / 离线 fallback 的"快照式"工厂 —— 30+ 调用点期望同步返回值,
 *   改异步会触发全量测试 / 调用方重写,违背"最小破坏"原则。
 * - `getDraftingData(id)` 改成 async:调用 `fetchRepoPool()` 拿真实仓库池;
 *   成功 → 用真实数据;失败 → fallback 到 `emptyDrafting(id)`(其内部 repos
 *   仍是 GLOBAL_REPO_POOL),开发环境断网时仍能演示完整 UI。
 * - 真实数据流:`getDraftingData` → 注入 DraftingData.repos → 组件 props
 *   → 弹层打开时由 `drafting-zone` useEffect 再 refetch 一次覆盖,保证
 *   用户主动开弹层时拿到的是最新池(决策 76 / ADR-0016 D4)。
 */

import {
  generatePrdSkeleton,
  validateLaunch,
  type AuxFile,
  type PrdAnchor,
  type UsageTag,
} from '@ai-devspace/shared'
import { fetchRepoPool } from './repo-attach'

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

/**
 * 关联仓库选项(issue 08 — 仓库底部条 + 软警告)
 *
 * UI 用 `id` 做 React key / 受控选中的标识;`name` 是渲染在 chip 上的展示名
 * (如 "refund-service")。本期不做仓库元数据(语言 / 默认分支 / 工作树路径等),
 * 那些留给后续接入 agent API 时再补。
 */
export interface DraftingRepo {
  id: string
  name: string
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
 * DRAFTING 工位顶层数据(issue 04 形态)
 *
 * 与 issue 18 形态的差异:
 * - 删除 acceptanceCriteria / repos / actions
 * - 增加 skills(Inline 栏候命 Skill 列表)
 * - 自动保存周期由 autosaveIntervalMs 控制;lastSavedAt 渲染"已保存 x 秒前"
 * - **issue 04** 新增 `auxFiles`:Requirement 的辅助文件列表(卡片网格渲染);
 *   空数据 / 新建需求 时为 [] → 走 EmptyAuxPlaceholder 占位
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
  /**
   * 辅助文件列表(issue 04)。
   * - `length === 0` → 走 EmptyAuxPlaceholder(虚线 "+ 新建/上传" 卡片)
   * - 非空 → 渲染 AuxFilesPane 的卡片网格(180px minmax + 12px gap)
   *
   * 数据来自 packages/shared/src/drafting.ts 的 `AuxFile` 类型 —— web 层只
   * 关心展示,不再二次加工。
   */
  auxFiles: AuxFile[]
  /**
   * 关联仓库选项(issue 08 + 06)。所有可选仓库(chips 渲染源);与 `selectedRepoIds`
   * 配合:已选中 = chip "on"(蓝色),未选中 = chip "off"(灰底)。
   *
   * 数据流(issue 06):SSR 期由 `getDraftingData` 从 Agent `GET /api/repos`
   * 拉取;弹层打开时由 `drafting-zone` useEffect refetch 兜底覆盖。
   */
  repos: DraftingRepo[]
  /**
   * 已选中的仓库 id 列表(issue 08)。
   *
   * - `length < 2` → 软警告 ⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文
   * - `length >= 2` → 软警告隐藏
   * - **不影响** launch validity(validity 只看 title + PRD,见 `validateLaunch`)
   */
  selectedRepoIds: string[]
  /**
   * 已锁定的统一分支名(issue 02 ticket + issue 06 ticket 06 SSR 持久化):
   * 首次 attach 后由后端写入 `meta.yaml.branchName`,SSR 读取后注入此处,
   * `DraftingZone` 把它作为 `lockedBranchName` state 的初值。
   *
   * 空字符串 / undefined = 未锁定(全新需求 / attach 前的中间态)。
   * 决定弹层 mode 切换(`first` / `append`)与 RepoBar chip 的 🟢 + 分支名。
   */
  lockedBranchName?: string
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
export type { AuxFile, PrdAnchor, UsageTag }

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
// issue 04 · 上下分割比例(PRD 卡片 + 拖拽条 + 辅助文件卡片网格)
// ---------------------------------------------------------------------------

/**
 * 默认 PRD 占比 = 0.6(对应设计稿 `19-final-drafting.html` 的 flex:3.5/2 ≈ 64%,
 * 但需求要求"约 60%"故取整 0.6;视觉差异 < 4% 可忽略)。
 */
export const DEFAULT_PRD_RATIO = 0.6

/**
 * 辅助文件面板的最小可视高度(像素)—— 至少保留一行辅助文件卡片可见。
 *
 * 拆解:
 * - pane head:`flex items-center justify-between`(标题 + actions slot)≈ 28px
 * - 卡片单行最小高度:`minmax(180px, 1fr)` 单元宽 + `.fcard { min-height: 90px }`
 *   ≈ 90px 卡片内容(单行)
 * - 安全 buffer:约 12px(行间间距 / 视觉呼吸)+ 卡片自身的 padding 12px
 *
 * 总和 ≈ 180px。issue 04 验收 #6 要求"至少一行卡片始终可见",所以 PRD 可压缩
 * 的下限 = aux 至少要 180px 才能保证不裁剪到卡片本身。
 *
 * 注意:此常量必须 ≥ `180px`(网格 minmax + 卡片 min-height 合计);调小会导致
 * clamp 后 aux 面板存在但内部卡片被压扁。
 */
export const AUX_PANE_MIN_HEIGHT_PX = 180

/** 拖拽分割条的固定高度(像素),与设计 `.split-resizer { height: 6px }` 一致 */
export const SPLIT_RESIZER_HEIGHT_PX = 6

/**
 * 把"作者想要的 PRD 占比"裁剪到合法区间 —— 保证辅助文件面板始终 ≥
 * `AUX_PANE_MIN_HEIGHT_PX`(issue 04 验收 #6 行卡片 floor),且 PRD 不被压到 0。
 *
 * 公式:
 *   ratio_max = 1 - (AUX_PANE_MIN_HEIGHT_PX / usable_height)
 *   ratio_min = SPLIT_RESIZER_HEIGHT_PX / usable_height(防止 PRD 消失)
 *
 * 其中 `usable_height = max(0, containerHeight - SPLIT_RESIZER_HEIGHT_PX)`。
 * 若 containerHeight 太小(已被全部分配给 PRD + 分割条),退化为 1(全部给 PRD)。
 *
 * 纯函数;同一 (ratio, containerHeight) → 同一输出,可在单元测试中无副作用
 * 验证。
 */
export function clampSplitRatio(
  ratio: number,
  containerHeight: number,
): number {
  const usable = Math.max(0, containerHeight - SPLIT_RESIZER_HEIGHT_PX)
  if (usable <= 0) {
    // 容器太矮,无法同时放 PRD + 分割 + aux:全部给 PRD
    return 1
  }
  const minPrdRatio = SPLIT_RESIZER_HEIGHT_PX / usable
  const maxPrdRatio = 1 - AUX_PANE_MIN_HEIGHT_PX / usable
  // 容器装不下最小 aux → 把 maxPrdRatio 钉到 minPrdRatio(把 aux 压到最小,
  // 由 overflow-auto 让用户能看到滚动条)
  const upperBound = Math.max(minPrdRatio, Math.min(maxPrdRatio, 1))
  return Math.min(Math.max(ratio, minPrdRatio), upperBound)
}

// ---------------------------------------------------------------------------
// issue 08 · 仓库软警告阈值(纯函数)
// ---------------------------------------------------------------------------

/**
 * 软警告阈值:已选仓库数 < 2 时返回 true(issue 08 验收 #4 #5)。
 *
 * - 0 个仓库 → true(警告:⚠ 仅 0 个仓库 · …)
 * - 1 个仓库 → true(警告:⚠ 仅 1 个仓库 · …)
 * - ≥ 2 个仓库 → false(警告隐藏)
 *
 * 故意写成"严格小于 2",不要写成"小于等于 1":前者让边界数字读起来更直观
 * (2 个仓库"刚好不警告");后者混用 ≤ 会增加读代码时的歧义。
 *
 * 纯函数:同一 selectedRepoIds → 同一 boolean;可单测;副作用为 0。
 */
export function shouldShowRepoSoftWarning(selectedRepoIds: readonly string[]): boolean {
  return selectedRepoIds.length < 2
}

// ---------------------------------------------------------------------------
// issue 01 · 顶部"未关联仓库"banner 可见性 + 全局仓库池(issue 01 ticket)
// ---------------------------------------------------------------------------

/**
 * 顶部"未关联仓库"banner 在已选仓库数 = 0 时可见(issue 01 ticket 1 + 决策 E10)。
 *
 * - 已选 ≥ 1 → false(banner 隐藏,含「首次勾选第一个 repo 后自动消失」场景)
 * - 已选 = 0 → true(banner 显示,提示用户添加仓库)
 *
 * 注意:banner 还有"用户主动 ✕ 关闭"与"错误态"两种受控隐藏,
 * 此函数只表达"是否应该展示"——具体 UI 隐藏由父组件持有额外状态决定。
 */
export function shouldShowAttachBanner(selectedRepoIds: readonly string[]): boolean {
  return selectedRepoIds.length === 0
}

/**
 * 全局仓库池 —— 当前 mock 用,后续接入 agent API 后由 server 注入。
 *
 * 设计要点:
 * - 全局池 ≠ 需求私有已选集合;前者是「可选仓库源」,后者是「已选仓库集合」
 * - 故意不包含「＋ 更多仓库…」占位 chip —— 那是 issue 08 RepoBar 的
 *   视觉引导,不属于真实仓库;UI 层遇到 name 以「＋」开头的应跳过
 */
export const GLOBAL_REPO_POOL: readonly DraftingRepo[] = [
  { id: 'repo-refund-service', name: 'refund-service' },
  { id: 'repo-order-service', name: 'order-service' },
  { id: 'repo-coupon-service', name: 'coupon-service' },
  { id: 'repo-payment-gateway', name: 'payment-gateway' },
  { id: 'repo-notification-service', name: 'notification-service' },
]

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
 * - **issue 04** auxFiles = [] → AuxFilesPane 走 EmptyAuxPlaceholder 占位
 * - **issue 08** repos = [] / selectedRepoIds = [] → RepoBar 渲染空态;
 *   软警告 `shouldShowRepoSoftWarning([]) === true`(0 个仓库触发警告)
 * - **issue 01 ticket** empty 态注入全局仓库池,使得 banner 可见 + RepoBar
 *   N=0 占位 chip 可点;但 selectedRepoIds 仍为空,触发 banner 显示
 */
export function emptyDrafting(requirementId: string): DraftingData {
  return {
    requirementId,
    toolbar: { ...EMPTY_TOOLBAR, crumb: [] },
    title: '',
    prdMarkdown: '',
    skills: [],
    auxFiles: [],
    // issue 01 ticket:空草稿注入全局仓库池(供 banner / RepoBar / 关联弹层使用);
    // 但 selectedRepoIds 仍为空 → banner 可见 + RepoBar N=0 占位 chip 显示
    repos: [...GLOBAL_REPO_POOL],
    selectedRepoIds: [],
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
  // issue 04:4 个示例辅助文件,对应设计稿 `19-final-drafting.html` 的样例
  // (api-draft / data-model / existing-flow / competitor-analysis)。
  // 故意覆盖 6 种 UsageTag 中的 4 种 + 3 种 SourceFormat 中的 2 种,以便
  // 验收 #2 测试各 tag 颜色 + converted_to_md 标签都至少能命中一次。
  auxFiles: [
    {
      id: 'aux-api-draft',
      filename: 'api-draft.md',
      body: '# 退款 API 草案 (Draft)\n\n## POST /refunds\n\n退款发起接口',
      usage_tag: 'api',
      source_format: 'md',
      converted_to_md: false,
    },
    {
      id: 'aux-data-model',
      filename: 'data-model.md',
      body: '# 退款单表结构\n\n字段:id / order_id / amount / reason',
      usage_tag: 'data',
      source_format: 'md',
      converted_to_md: false,
    },
    {
      id: 'aux-existing-flow',
      filename: 'existing-flow.md',
      body: '# 客服退款流程 SOP\n\n原 docx 已转 md',
      usage_tag: 'sop',
      source_format: 'docx',
      converted_to_md: true,
    },
    {
      id: 'aux-competitor',
      filename: 'competitor-analysis.md',
      body: '# 友商退款体验对比\n\n4 家友商调研',
      usage_tag: 'research',
      source_format: 'pdf',
      converted_to_md: true,
    },
  ],
  // issue 08:5 个可选仓库 + 默认勾选前 2 个(refund-service / order-service),
  // 对应设计稿 `19-final-drafting.html` 的样例(2 个仓库触发软警告文案 "⚠ 仅 2 个仓库…";
  // 本仓库条的可视化刚好命中"软警告阈值边界",验收测试用)。
  // 故意包含一个 "＋ 更多仓库…" 占位 chip —— 但 id 与现有 repo 不同,
  // mock 期它是 no-op(不会触发 addRepo 之类的副作用),留给后续接 agent API 时
  // 扩展。
  repos: [
    { id: 'repo-refund-service', name: 'refund-service' },
    { id: 'repo-order-service', name: 'order-service' },
    { id: 'repo-coupon-service', name: 'coupon-service' },
    { id: 'repo-payment-gateway', name: 'payment-gateway' },
    { id: 'repo-more', name: '＋ 更多仓库…' },
  ],
  selectedRepoIds: ['repo-refund-service', 'repo-order-service'],
  autosaveIntervalMs: 30_000,
  lastSavedAt: null,
}

/**
 * 拉取 DRAFTING 工位数据(issue 06 — 注入真实仓库池)。
 *
 * 数据流:
 * 1. 已知 id(req-001)→ REFUND_DRAFTING 样例数据(空 PRD 字段已存,组件不填充)
 * 2. 未知 id / 新建需求 → `emptyDrafting(id)` 路径
 * 3. **任意路径**都会尝试 `fetchRepoPool()` 拿真实仓库池:
 *    - 成功 → 覆盖样例 / 空草稿中的 `repos` 字段(决策 76 / ADR-0016 D4 SSR 初始)
 *    - 失败(网络错 / Agent 鉴权错 / Zod 校验错 / AbortError)→ 静默 fallback
 *      到原样例的 `repos` 字段(REFUND_DRAFTING.repos 或 GLOBAL_REPO_POOL);
 *      **不**抛错 —— 仓库池是次要数据,失败时不应阻塞整个工位渲染
 *      (符合决策 24:不打扰,但陪伴)
 *
 * 签名仍为 async —— 后续若需再注入其他 server 数据(autosave / lastSavedAt 等)
 * 调用方不用切换。
 */
export async function getDraftingData(
  requirementId: string,
): Promise<DraftingData> {
  const baseData: DraftingData =
    requirementId === 'req-001'
      ? { ...REFUND_DRAFTING, requirementId }
      : emptyDrafting(requirementId)

  // 注入真实仓库池(issue 06 · 决策 76)
  try {
    const pool = await fetchRepoPool()
    return { ...baseData, repos: pool.repos }
  } catch {
    // 静默 fallback —— 保留 baseData.repos(REFUND_DRAFTING.repos 或 GLOBAL_REPO_POOL)
    return baseData
  }
}