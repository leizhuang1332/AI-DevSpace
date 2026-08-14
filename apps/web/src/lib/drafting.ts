/**
 * DRAFTING 工位数据层(issue 02 — PRD 顶置 + 骨架 + 进入 ANALYZING;
 * 后续 issue 04 — 辅助文件卡片 + 拖拽分割扩展;
 * issue 08 — 仓库底部条 + 软警告 + 启动按钮迁入底部条;
 * issue 06 (ADR-0030) — 仓库注册表化,字段从 `id`/`repoIds` 改为 `name`/`repoNames`,
 *                       `repos` 列表由 SSR 通过 `~/.aidevspace/repos.yaml` 派生,
 *                       删除全局仓库池 mock(`GLOBAL_REPO_POOL`))
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
 *   UI 仅负责在 selectedRepoNames 变化时调一次拿到 boolean
 *
 * issue 06 (ADR-0030) 形态调整:
 * - `DraftingRepo` 直接复用 `@ai-devspace/shared` 的 `RepoRegistryEntry`
 *   (字段最小集:`name` + `gitUrl` + `description`)。name 是全局唯一标识,
 *   与 `requirements/<req-id>/codebase/<name>/` 目录名同源。
 * - `selectedRepoIds` → `selectedRepoNames`;`failedRepoIds` → `failedRepoNames`
 * - 删除 `GLOBAL_REPO_POOL` mock —— yaml 是真相源,失败时沿用 SSR 已注入
 *   的 `data.repos`(没有 fallback 到写死的列表)。
 * - `emptyDrafting` 不再注入 mock 仓库池 —— 空草稿态下 `repos = []`,
  //   由 SSR 注入后用真实仓库列表覆盖(`getDraftingDataFromFs` 负责)。
  // - `getDraftingData` 仅保留 `req-001` demo 用例;非 req-001 走 emptyDrafting;
  //   不再调 `fetchRepoRegistry` 做覆盖(SSR 已经注入了仓库池)。
 */

import {
  generatePrdSkeleton,
  validateLaunch,
  type AuxFile,
  type PrdAnchor,
  type RepoRegistryEntry,
  type UsageTag,
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

/**
 * 关联仓库选项(issue 06 · ADR-0030 D3)
 *
 * 直接复用 `@ai-devspace/shared` 的 `RepoRegistryEntry`(name 全局唯一即
 * 标识,gitUrl + description 是注册表元数据),避免 web 端在 DraftingRepo
 * 与 RepoRegistryEntry 间再做一次窄化/展宽。
 *
 * 与旧 id-based 形态的差异(决策 105):
 * - 删除 `id` 字段(name 即标识,React key / chip data attr / 选中态都用 name)
 * - 新增 `gitUrl` / `description`(注册表元数据,用于 chip tooltip / 列表渲染)
 */
export type DraftingRepo = RepoRegistryEntry

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
 * DRAFTING 工位顶层数据(issue 04 形态 + issue 06 跟改)
 *
 * 与 issue 18 形态的差异:
 * - 删除 acceptanceCriteria / repos / actions
 * - 增加 skills(Inline 栏候命 Skill 列表)
 * - 自动保存周期由 autosaveIntervalMs 控制;lastSavedAt 渲染"已保存 x 秒前"
 * - **issue 04** 新增 `auxFiles`:Requirement 的辅助文件列表(卡片网格渲染);
 *   空数据 / 新建需求 时为 [] → 走 EmptyAuxPlaceholder 占位
 * - **issue 06** selectedRepoIds → selectedRepoNames;repos 由 SSR 注入真实注册表
 * - **issue 06** lockedBranchName 仍存在,作为 append 模式 + 软警告 + chip 绿点的依据
 */
export interface DraftingData {
  requirementId: string
  /** 顶部 toolbar(面包屑 + 状态文本) */
  toolbar: DraftingToolbar
  /** 标题 input 值(独立字段,与 PRD 摘要 H1 解耦) */
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
   * 关联仓库选项(issue 06 · ADR-0030 D3)。
   *
   * 所有可选仓库(chips 渲染源);与 `selectedRepoNames` 配合:
   * 已选中 = chip "on"(蓝色),未选中 = chip "off"(灰底)。
   *
   * 数据流(issue 06):SSR 期由 `getDraftingDataFromFs` 从
   * `<root>/repos.yaml` 派生;弹层打开时由 `drafting-zone` useEffect refetch
   * `fetchRepoRegistry` 兜底覆盖。失败时静默保留当前列表(决策 24 不打扰)。
   */
  repos: DraftingRepo[]
  /**
   * 已选中的仓库 name 列表(issue 06 · 决策 105)。
   *
   * - `length < 2` → 软警告 ⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文
   * - `length >= 2` → 软警告隐藏
   * - **不影响** launch validity(validity 只看 title + PRD,见 `validateLaunch`)
   */
  selectedRepoNames: string[]
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
 * - pane head:`flex items-center align-between`(标题 + actions slot)≈ 28px
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
 * 纯函数:同一 selectedRepoNames → 同一 boolean;可单测;副作用为 0。
 */
export function shouldShowRepoSoftWarning(selectedRepoNames: readonly string[]): boolean {
  return selectedRepoNames.length < 2
}

// ---------------------------------------------------------------------------
// issue 01 · 顶部"未关联仓库"banner 可见性(纯函数)
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
export function shouldShowAttachBanner(selectedRepoNames: readonly string[]): boolean {
  return selectedRepoNames.length === 0
}

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
 * - **issue 08** repos = [] / selectedRepoNames = [] → RepoBar 渲染空态;
 *   软警告 `shouldShowRepoSoftWarning([]) === true`(0 个仓库触发警告)
 * - **issue 06 (ADR-0030)** 不再注入写死的 mock 仓库池:
 *   repos 起点是 [];SSR 路径由 `getDraftingDataFromFs` 读 `<root>/repos.yaml`
 *   覆盖;空草稿态若 yaml 为空也合法(决策 24 不打扰 + 「去仓库页添加 →」引导)。
 */
export function emptyDrafting(requirementId: string): DraftingData {
  return {
    requirementId,
    toolbar: { ...EMPTY_TOOLBAR, crumb: [] },
    title: '',
    prdMarkdown: '',
    skills: [],
    auxFiles: [],
    // issue 06 (ADR-0030):repos 不再注入写死 mock,改由 SSR `getDraftingDataFromFs`
    // 读 `<root>/repos.yaml` 后覆盖;空草稿态允许 repos = [] 触发「去仓库页添加 →」引导。
    repos: [],
    selectedRepoNames: [],
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
  // issue 06 (ADR-0030):5 个示例仓库 —— 字段最小集 name/gitUrl/description,
  // 对应设计稿 `19-final-drafting.html` 的样例(2 个仓库触发软警告文案
  // "⚠ 仅 2 个仓库…";本仓库条的可视化刚好命中"软警告阈值边界",验收测试用)。
  repos: [
    {
      name: 'refund-service',
      gitUrl: 'https://example.com/refund-service.git',
      description: '退款主服务',
    },
    {
      name: 'order-service',
      gitUrl: 'https://example.com/order-service.git',
      description: '订单服务',
    },
    {
      name: 'coupon-service',
      gitUrl: 'https://example.com/coupon-service.git',
      description: '优惠券服务',
    },
    {
      name: 'payment-gateway',
      gitUrl: 'https://example.com/payment-gateway.git',
      description: '支付网关',
    },
  ],
  selectedRepoNames: ['refund-service', 'order-service'],
  autosaveIntervalMs: 30_000,
  lastSavedAt: null,
}

/**
 * 拉取 DRAFTING 工位数据(issue 06 跟改 — 同步 mock,无 fallback)。
 *
 * 数据流:
 * 1. 已知 id(req-001)→ REFUND_DRAFTING 样例数据(空 PRD 字段已存,组件不填充)
 * 2. 未知 id / 新建需求 → `emptyDrafting(id)` 路径
 * 3. **不再**走 `fetchRepoRegistry` 覆盖:仓库池由 SSR `getDraftingDataFromFs`
 *    从 `<root>/repos.yaml` 派生后注入 `data.repos`(`page.tsx` 调用链);
 *    mock 路径只用于组件 / 库单测,不调真实 HTTP。
 *
 * 签名仍为 async —— 与旧版兼容,后续接入其他 server 数据(autosave /
 * lastSavedAt 等)时调用方不用切换。
 */
export async function getDraftingData(
  requirementId: string,
): Promise<DraftingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_DRAFTING, requirementId }
  }
  return emptyDrafting(requirementId)
}