/**
 * WRAP-UP 工位数据层(ADR-0011 §6 WRAP-UP 布局 · issue 22)
 *
 * Archive 形态(对应原型 11f-stage-adaptive-archive.html)。
 *
 * 设计原则(沿用 ANALYZING/CLARIFYING/DESIGNING/DRAFTING/EXECUTING):
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:未知 id → empty=true,UI 渲染引导去 EXECUTING
 * - 数据由 server 注入,组件本身只关心渲染 + 客户端交互
 * - archive.archived 状态由组件 useState 维护(也允许 server 预置作 SSR 兜底)
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * AC 验收项。
 * - passed: true → ✓ 绿;false → ✗ 红(只读时仍展示失败项)
 * - measured: 关键实测值(如 "99.4%" / "18.4s")
 * - metrics: 补充指标(压测 / P99 / 异常注入次数 等)
 */
export interface WrapupAc {
  id: string
  title: string
  passed: boolean
  measured: string
  metrics: { label: string; value: string; tone?: 'good' | 'bad' | 'normal' }[]
}

/** 产物类型变体 —— 决定卡片左上角 icon 颜色 + typeLabel */
export type WrapupArtifactKind =
  | 'sql'
  | 'api'
  | 'config'
  | 'doc'
  | 'sequence'
  | 'markdown'

/** 产物清单卡片 */
export interface WrapupArtifact {
  id: string
  kind: WrapupArtifactKind
  /** 卡片左上角 typeLabel(如 "SQL" / "API" / "CFG" / "SEQ" / "MD") */
  typeLabel: string
  name: string
  /** 路径链接 href(点击跳文件) */
  href: string
  preview: string
  /** 已采纳 / 已审 —— 决定右下 status dot 颜色 */
  status: 'ok' | 'warn'
  date: string
  /** 关联 commit sha(可选) */
  prSha?: string
}

/** 关联 PR/Commit */
export interface WrapupPr {
  id: string
  sha: string
  title: string
  repo: string
  added: number
  removed: number
  tests: number
  reviews: number
  href?: string
  diffHref?: string
}

/** 关键决策回顾(用户在 CLARIFYING 工位的回答 + DESIGNING 的选择) */
export interface WrapupDecision {
  id: string
  question: string
  answer: string
  duration: string
}

/** 底部变更统计 —— 累计 +N / -N 行 + 文件数 + 仓库数 */
export interface WrapupChangeStats {
  added: number
  removed: number
  files: number
  repos: number
}

/** AI 活动统计(从 EXECUTING 工位的 AI 行为流 + Skill 调用日志聚合) */
export interface WrapupAIActivity {
  totalWrites: number
  thinkingTimeMinutes: number
  snapshotCount: number
  skillInvocations: number
}

/** 顶部回顾报告 hero */
export interface WrapupHero {
  title: string
  startDate: string
  endDate: string
  /** "3 天 7 小时" */
  duration: string
  /** "3/3 通过" */
  acPassRate: string
  /** AI 自动完成比例(0-100) */
  aiPercent: number
  /** 人工介入次数 */
  manualInterventions: number
}

/** 顶部 Stage 条 */
export interface WrapupStage {
  badge: string
  title: string
  meta: string
}

/** Toolbar(面包屑) */
export interface WrapupToolbarCrumb {
  label: string
  current?: boolean
}


export interface WrapupToolbar {
  crumb: WrapupToolbarCrumb[]
}

/** 归档载荷 —— page 层接 API 触发 */
export interface WrapupArchivePayload {
  /** 是否同时触发知识沉淀(可选,默认 false) */
  withKnowledge?: boolean
}

/** 重新打开载荷 —— 从 ARCHIVED → EXECUTING */
export interface WrapupReopenPayload {
  /** 回退到哪个工位(默认 'executing') */
  toZone?: 'executing' | 'designing'
}

/** 归档状态 */
export interface WrapupArchive {
  /** 已归档 → 只读 + UI 锁按钮;待归档 → 可点 [📦 归档] */
  archived: boolean
}

/** 顶部回顾报告右上 4 个数字 */
export interface WrapupReportStat {
  label: string
  value: string
}

/** WRAP-UP 工位顶层数据 */
export interface WrapupData {
  requirementId: string
  empty: boolean
  stage: WrapupStage
  toolbar: WrapupToolbar
  hero: WrapupHero
  acs: WrapupAc[]
  artifacts: WrapupArtifact[]
  prs: WrapupPr[]
  decisions: WrapupDecision[]
  changes: WrapupChangeStats
  ai: WrapupAIActivity
  archive: WrapupArchive
  reportStats: WrapupReportStat[]
}

// ---------------------------------------------------------------------------
// 资源树摘要(由 WrapupZone → ResourceTree 透传,用于按工位渲染)
// ---------------------------------------------------------------------------

/**
 * 资源树摘要(WRAP-UP 工位资源树渲染用)。
 *
 * 由 WrapupZone 派生,直接传给 ResourceTree 的 wrapupSummary slot,
 * 避免 ResourceTree 内部再调一遍 getWrapupData(避免 server 重复拉数据)。
 */
export interface WrapupTreeSummary {
  artifactCount: number
  prCount: number
  decisionCount: number
  artifacts: { id: string; name: string; status: WrapupArtifact['status'] }[]
  prs: { sha: string; title: string }[]
  decisions: { id: string; question: string }[]
}

/**
 * 从 WrapupData 派生资源树摘要(纯函数,便于单元测试)。
 */
export function extractWrapupTreeSummary(data: WrapupData): WrapupTreeSummary {
  return {
    artifactCount: data.artifacts.length,
    prCount: data.prs.length,
    decisionCount: data.decisions.length,
    artifacts: data.artifacts.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
    })),
    prs: data.prs.map((p) => ({ sha: p.sha, title: p.title })),
    decisions: data.decisions.map((d) => ({ id: d.id, question: d.question })),
  }
}

// ---------------------------------------------------------------------------
// 空数据(未知 id / 尚未到 EXECUTING 阶段)
// ---------------------------------------------------------------------------

/**
 * 空状态 WRAP-UP 工位数据。UI 渲染时若 data.empty === true → 走空态引导
 * (去 EXECUTING 让 AI 先实施,完成才能进入归档复盘)。
 */
export function emptyWrapup(requirementId: string): WrapupData {
  return {
    requirementId,
    empty: true,
    stage: { badge: '⑥ 完成', title: '', meta: '' },
    toolbar: { crumb: [] },
    hero: {
      title: '',
      startDate: '',
      endDate: '',
      duration: '',
      acPassRate: '',
      aiPercent: 0,
      manualInterventions: 0,
    },
    acs: [],
    artifacts: [],
    prs: [],
    decisions: [],
    changes: { added: 0, removed: 0, files: 0, repos: 0 },
    ai: {
      totalWrites: 0,
      thinkingTimeMinutes: 0,
      snapshotCount: 0,
      skillInvocations: 0,
    },
    archive: { archived: false },
    reportStats: [],
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 11f Archive(退款功能优化 · 已完成)
// 与 EXECUTING 工位 mock 同 req-001,模拟"完成 → 归档"过渡
// ---------------------------------------------------------------------------

const REFUND_HERO: WrapupHero = {
  title: '退款功能优化 已完成',
  startDate: '2026-07-08',
  endDate: '2026-07-11',
  duration: '3 天 7 小时',
  acPassRate: '3/3 通过',
  aiPercent: 89,
  manualInterventions: 11,
}

const REFUND_REPORT_STATS: WrapupReportStat[] = [
  { label: '代码行', value: '+847' },
  { label: '删除', value: '-213' },
  { label: '任务', value: '14' },
  { label: '测试用例', value: '38' },
]

const REFUND_ACS: WrapupAc[] = [
  {
    id: 'AC1',
    title: '退款成功率 ≥ 99%',
    passed: true,
    measured: '99.4%',
    metrics: [
      { label: '压测', value: '1000 QPS', tone: 'good' },
      { label: '采样', value: '1 万次', tone: 'normal' },
    ],
  },
  {
    id: 'AC2',
    title: '平均退款时长 ≤ 30s',
    passed: true,
    measured: '18.4s',
    metrics: [
      { label: 'P99', value: '28s', tone: 'good' },
      { label: '超时', value: '自动重试 1 次', tone: 'normal' },
    ],
  },
  {
    id: 'AC3',
    title: '退款失败时优惠券/积分回滚 100%',
    passed: true,
    measured: '100%',
    metrics: [
      { label: '异常注入', value: '500 次', tone: 'good' },
      { label: '关联', value: 'bug #312 已修复', tone: 'normal' },
    ],
  },
]

const REFUND_ARTIFACTS: WrapupArtifact[] = [
  {
    id: 'art-1',
    kind: 'sql',
    typeLabel: 'SQL',
    name: 'refund.sql',
    href: '/files/refund.sql',
    preview:
      'CREATE TABLE refund_order (\n  id BIGINT PRIMARY KEY,\n  order_id BIGINT NOT NULL...',
    status: 'ok',
    date: '2026-07-08',
    prSha: 'a3f5b2c',
  },
  {
    id: 'art-2',
    kind: 'api',
    typeLabel: 'API',
    name: 'refund-api.yaml',
    href: '/files/refund-api.yaml',
    preview:
      'openapi: 3.0.0\ninfo:\n  title: 退款 API\n  version: 1.0.0\npaths:\n  /api/refunds...',
    status: 'ok',
    date: '2026-07-09',
    prSha: 'a3f5b2c',
  },
  {
    id: 'art-3',
    kind: 'config',
    typeLabel: 'CFG',
    name: 'apollo.yaml',
    href: '/files/apollo.yaml',
    preview:
      'refund:\n  max_amount: 5000\n  auto_audit_timeout: 5s\n  retry_count: 3...',
    status: 'warn',
    date: '2026-07-09',
    prSha: 'b7c4d9e',
  },
  {
    id: 'art-4',
    kind: 'sequence',    typeLabel: 'SEQ',
    name: '退款流程图.svg',
    href: '/files/退款流程图.svg',
    preview:
      '[退款申请] → [自动审核] → [调用订单] → [调用库存] → [调用优惠券] → ...',
    status: 'ok',
    date: '2026-07-09',
  },
  {
    id: 'art-5',
    kind: 'markdown',
    typeLabel: 'MD',
    name: 'state-machine.md',
    href: '/files/state-machine.md',
    preview:
      '# 退款状态机\nPENDING → AUDITING → APPROVED → REFUNDING → SUCCESS\n                  ↓\n                FAILED (with rollback)...',
    status: 'ok',
    date: '2026-07-09',
    prSha: 'c8e2a1f',
  },
  {
    id: 'art-6',
    kind: 'markdown',
    typeLabel: 'MD',
    name: 'rollback-plan.md',
    href: '/files/rollback-plan.md',
    preview:
      '# 回滚方案\n1. 退款失败 → 优惠券回滚\n2. 退款失败 → 积分回滚\n3. 退款失败 → 库存回补...',
    status: 'ok',
    date: '2026-07-10',
    prSha: 'd4b3e7a',
  },
]

const REFUND_PRS: WrapupPr[] = [
  {
    id: 'pr-1',
    sha: 'a3f5b2c',
    title: 'refund-service: 实现退款查询接口 (Task #7-#9)',
    repo: 'refund-service',
    added: 342,
    removed: 98,
    tests: 14,
    reviews: 2,
    href: '/pr/refund-service/a3f5b2c',
    diffHref: '/diff/refund-service/a3f5b2c',
  },
  {
    id: 'pr-2',
    sha: 'b7c4d9e',
    title: 'refund-service: 添加幂等与重试 (Task #10-#12)',
    repo: 'refund-service',
    added: 218,
    removed: 45,
    tests: 12,
    reviews: 1,
    href: '/pr/refund-service/b7c4d9e',
    diffHref: '/diff/refund-service/b7c4d9e',
  },
  {
    id: 'pr-3',
    sha: 'c8e2a1f',
    title: 'refund-service: 集成测试 + 异常注入',
    repo: 'refund-service',
    added: 187,
    removed: 12,
    tests: 8,
    reviews: 0,
    href: '/pr/refund-service/c8e2a1f',
    diffHref: '/diff/refund-service/c8e2a1f',
  },
  {
    id: 'pr-4',
    sha: 'd4b3e7a',
    title: 'order-service: 适配退款回调',
    repo: 'order-service',
    added: 100,
    removed: 58,
    tests: 4,
    reviews: 1,
    href: '/pr/order-service/d4b3e7a',
    diffHref: '/diff/order-service/d4b3e7a',
  },
]

const REFUND_DECISIONS: WrapupDecision[] = [
  { id: 'Q1', question: '退款单笔金额上限?', answer: '5000 元', duration: '14m' },
  {
    id: 'Q2',
    question: '退款审核流?',
    answer: '自动审核 5s 超时转人工',
    duration: '22m',
  },
  {
    id: 'Q3',
    question: '退款失败时回滚策略?',
    answer: '完全回滚(优惠券+积分+库存)',
    duration: '1h',
  },
  {
    id: 'Q4',
    question: '退款幂等实现?',
    answer: 'Idempotency-Key 头 + 业务键兜底',
    duration: '35m',
  },
  {
    id: 'Q5',
    question: '部分退款规则?',
    answer: '单笔最多 3 次, 累计 ≤ 原订单金额',
    duration: '8m',
  },
]

const REFUND_CHANGES: WrapupChangeStats = {
  added: 847,
  removed: 213,
  files: 38,
  repos: 2,
}

const REFUND_AI: WrapupAIActivity = {
  totalWrites: 247,
  thinkingTimeMinutes: 142,
  snapshotCount: 6,
  skillInvocations: 23,
}

const REFUND_STAGE: WrapupStage = {
  badge: '⑥ 完成',
  title: 'WRAP-UP · Archive 形态 · 回顾报告',
  meta: '耗时 3 天 7 小时 · 14 任务 · 4 PR · 6 产物',
}

const REFUND_TOOLBAR: WrapupToolbar = {
  crumb: [
    { label: '退款功能优化' },
    { label: '/' },
    { label: '完成' },
    { label: '/' },
    { label: '回顾报告', current: true },
  ],
}

const REFUND_WRAPUP: Omit<WrapupData, 'requirementId'> = {
  empty: false,
  stage: REFUND_STAGE,
  toolbar: REFUND_TOOLBAR,
  hero: REFUND_HERO,
  acs: REFUND_ACS,
  artifacts: REFUND_ARTIFACTS,
  prs: REFUND_PRS,
  decisions: REFUND_DECISIONS,
  changes: REFUND_CHANGES,
  ai: REFUND_AI,
  archive: { archived: false },
  reportStats: REFUND_REPORT_STATS,
}

/**
 * 拉取 WRAP-UP 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001)→ REFUND_WRAPUP 样例数据
 * - 未知 id / 尚未到 EXECUTING 阶段 → emptyWrapup(id)
 *
 * 显式标注 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getWrapupData(
  requirementId: string,
): Promise<WrapupData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_WRAPUP, requirementId }
  }
  return emptyWrapup(requirementId)
}
