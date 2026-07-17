/**
 * Overview 概览页数据聚合层(ADR-0011 §1 + §4 · ADR-0012 §5)
 *
 * 数据来源:
 * - 需求元数据(标题 / 状态 / 仓库 / 负责人 / 创建 / 更新):从 meta.yaml / mock 读
 * - 完成进度 / 工位状态 / 里程碑 / AI 活动:从各工位产物汇总(本期 mock,后续接 agent API)
 *
 * 设计原则:
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:新建需求时返回 empty=true,UI 渲染空状态引导
 * - 永不基于 status 推断工位(决策 15 反对状态机)—— currentZone 由调用方传入
 */
import type { RequirementStatusT } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 单工位在概览页的"卡片态"(右上:工位地图) */
export type ZoneCardState = 'todo' | 'done' | 'in_progress' | 'cur'

export interface OverviewZoneCard {
  /** 工位 id,与 ZONE_LIFECYCLE_ORDER 对齐 */
  zoneId: string
  /** 卡片文案,例如 "PRD 已写" */
  caption: string
  /** 卡片右侧元数据,例如 "3 节" */
  meta: string
  /** 卡片状态:决定状态色 + 是否高亮(当前 zone) */
  state: ZoneCardState
}

/** 里程碑时间线节点(左下) */
export type MilestoneState = 'done' | 'cur' | 'todo'

export interface OverviewMilestone {
  /** 节点 id(工位 id 或 'planning') */
  id: string
  /** 节点标题,例如 "DRAFTING · 写 PRD" */
  name: string
  /** 时间戳(已完成 / 进行中节点显示;待办节点为 null) */
  ts: string | null
  /** 节点描述 */
  sub: string
  /** 节点状态 */
  state: MilestoneState
}

/** 完成进度(左上) */
export interface OverviewProgress {
  percent: number
  total: number
  done: number
  inProgress: number
  waiting: number
  todo: number
  codeLinesAdded: number
  codeLinesRemoved: number
  artifactCount: number
  /** 形如 "PR #234 等待 review";无 PR 时为 null */
  prStatus: string | null
}

/** AI 活动概览(右下) */
export interface OverviewZoneActivity {
  zoneId: string
  /** 0-100 */
  percent: number
}

export interface OverviewAIActivity {
  totalActiveMinutes: number
  totalLinesWritten: number
  skillCalls: number
  snapshotCount: number
  /** 6 个工位活跃度(按 lifecycle 顺序) */
  zones: OverviewZoneActivity[]
}

/** 顶部 banner 元数据 */
export interface OverviewMeta {
  title: string
  /** 类似 "REF-2024-089" 的展示 ID;与 path id 解耦 */
  reqIdLabel: string
  status: RequirementStatusT
  repos: string[]
  owner: string
  /** 形如 "2026-07-08 · 4 天前" */
  createdAt: string
  /** 形如 "12 分钟前" */
  updatedAt: string
}

/** 概览页总数据 */
export interface OverviewData {
  requirementId: string
  meta: OverviewMeta
  progress: OverviewProgress
  zoneCards: OverviewZoneCard[]
  milestones: OverviewMilestone[]
  aiActivity: OverviewAIActivity
  /** 空数据(无产物 / 新建需求);UI 渲染空状态引导 */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 兜底数据(新建需求 / 不存在 id)
// ---------------------------------------------------------------------------

const EMPTY_META: OverviewMeta = {
  title: '',
  reqIdLabel: '',
  status: 'draft',
  repos: [],
  owner: '',
  createdAt: '',
  updatedAt: '',
}

const EMPTY_PROGRESS: OverviewProgress = {
  percent: 0,
  total: 0,
  done: 0,
  inProgress: 0,
  waiting: 0,
  todo: 0,
  codeLinesAdded: 0,
  codeLinesRemoved: 0,
  artifactCount: 0,
  prStatus: null,
}

const EMPTY_AI: OverviewAIActivity = {
  totalActiveMinutes: 0,
  totalLinesWritten: 0,
  skillCalls: 0,
  snapshotCount: 0,
  zones: [],
}

/**
 * 空状态 overview(无产物的新建需求)。
 * zoneCards / milestones 都为空数组,UI 渲染"暂无数据,先去 DRAFTING 工位写 PRD"。
 */
export function emptyOverview(requirementId: string): OverviewData {
  return {
    requirementId,
    meta: { ...EMPTY_META },
    progress: { ...EMPTY_PROGRESS },
    zoneCards: [],
    milestones: [],
    aiActivity: { ...EMPTY_AI, zones: [] },
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 后续接入 agent API 时只需替换此函数
// ---------------------------------------------------------------------------

/**
 * 真实数据 mock —— 对应原型 [12-requirement-overview.html](docs/design/pages/12-requirement-overview.html)
 * 中的 "退款功能优化 REF-2024-089"。
 *
 * 之所以放在 lib/mock 中而不是 data/mock.ts:Overview 是跨"工位 + 元数据"的聚合,
 * data/mock.ts 只承载基础类型与列表数据(避免它成为上帝文件)。
 */
const REFUND_OVERVIEW: Omit<OverviewData, 'requirementId'> = {
  empty: false,
  meta: {
    title: '退款功能优化',
    reqIdLabel: 'REF-2024-089',
    status: 'implementing',
    repos: ['refund-service', 'order-core', 'payment-gateway'],
    owner: '@ray',
    createdAt: '2026-07-08 · 4 天前',
    updatedAt: '12 分钟前',
  },
  progress: {
    percent: 72,
    total: 12,
    done: 7,
    inProgress: 1,
    waiting: 1,
    todo: 3,
    codeLinesAdded: 110,
    codeLinesRemoved: 20,
    artifactCount: 5,
    prStatus: 'PR #234 等待 review',
  },
  zoneCards: [
    { zoneId: 'drafting', caption: 'PRD 已写', meta: '3 节', state: 'done' },
    { zoneId: 'analyzing', caption: '已完成', meta: '5 子问题', state: 'done' },
    { zoneId: 'clarifying', caption: '已澄清', meta: '3 轮', state: 'done' },
    { zoneId: 'designing', caption: '方案 A 已选', meta: '3 候选', state: 'done' },
    { zoneId: 'executing', caption: '当前进度', meta: '1/4 任务', state: 'cur' },
    { zoneId: 'wrapup', caption: '待归档', meta: '—', state: 'todo' },
  ],
  milestones: [
    {
      id: 'drafting',
      name: 'DRAFTING · 写 PRD',
      ts: '2026-07-08',
      sub: '完成需求文档 + AC 5 条 · 关联 3 仓库',
      state: 'done',
    },
    {
      id: 'analyzing',
      name: 'ANALYZING · AI 分析',
      ts: '2026-07-09',
      sub: '识别子问题 5 个 / 风险点 3 个 / 候选方案 3 个',
      state: 'done',
    },
    {
      id: 'clarifying',
      name: 'CLARIFYING · 澄清',
      ts: '2026-07-09 → 07-10',
      sub: '3 轮问答 · 解决了幂等键冲突问题',
      state: 'done',
    },
    {
      id: 'designing',
      name: 'DESIGNING · 选方案',
      ts: '2026-07-10',
      sub: '选择方案 A · 异步退款 · 接受 2 个取舍点',
      state: 'done',
    },
    {
      id: 'planning',
      name: 'PLANNING · 任务拆分',
      ts: '2026-07-11',
      sub: '12 个任务 · 关键路径 7 个 · 估算 3 天',
      state: 'done',
    },
    {
      id: 'executing',
      name: 'EXECUTING · 实施中',
      ts: '2026-07-11 → 进行中',
      sub: '已完成 7/12 任务 · PR #234 等待 review',
      state: 'cur',
    },
    {
      id: 'wrapup',
      name: 'WRAP-UP · 归档',
      ts: null,
      sub: '待 EXECUTING 完成后归档',
      state: 'todo',
    },
  ],
  aiActivity: {
    totalActiveMinutes: 83, // 1h 23min
    totalLinesWritten: 124,
    skillCalls: 23,
    snapshotCount: 7,
    zones: [
      { zoneId: 'executing', percent: 78 },
      { zoneId: 'designing', percent: 42 },
      { zoneId: 'clarifying', percent: 28 },
      { zoneId: 'analyzing', percent: 18 },
      { zoneId: 'drafting', percent: 12 },
    ],
  },
}

/**
 * 拉取需求 overview 数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001 等) → 返回 REFUND_OVERVIEW 样例数据
 * - 未知 id / 新建需求 → 返回 emptyOverview(id)
 *
 * 显式标注为 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getRequirementOverview(
  requirementId: string,
): Promise<OverviewData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_OVERVIEW, requirementId }
  }
  return emptyOverview(requirementId)
}