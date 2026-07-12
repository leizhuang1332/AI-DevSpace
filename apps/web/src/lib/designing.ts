/**
 * DESIGNING 工位数据层(ADR-0011 §6 DESIGNING 布局 · issue 21)
 *
 * Compare 形态(对应原型 11c-stage-adaptive-designing.html):
 *
 * - 主区全宽:左侧设计文档(markdown) + 右侧 3 个候选方案横向对比
 *   (无资源树 / 无 Inline 栏 —— ADR-0011 R2 DESIGNING 默认无资源树)
 * - 候选卡片:标题 + tag(最简/AI 推荐/强一致)+ ✓/✗ 优缺点 + 量化指标
 *   (微服务调用 / 预估延迟 / 失败率)+ [✓ 采纳 X]
 * - 底部操作:
 *   - 每张卡片 [✓ 采纳 X] → 触发 select(选中后弹出切到 EXECUTING 引导卡)
 *   - Toolbar 的 [↻ 让 AI 重新生成] → 触发 regenerate(无 hint)
 *   - ✏️ 自定义调整输入框 → 触发 regenerate({ hint })
 * - 底部"取舍点详情 + AI 建议"区(Compare 形态专属)
 *
 * 设计原则(沿用 ANALYZING/CLARIFYING/DRAFTING):
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:未知 id → empty=true,UI 渲染引导去 ANALYZING
 * - 数据由 server 注入,组件本身只关心渲染 + 客户端交互
 * - selectedCandidateId 由组件 useState 维护(也允许 server 预置作 SSR 兜底)
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 候选方案 id(固定 A/B/C,模式可推到 D/E...但本期锁 3 个候选) */
export type DesigningCandidateId = 'A' | 'B' | 'C'

/** 卡片 tag 视觉变体 */
export type DesigningCandidateTagVariant = 'simple' | 'recommended' | 'strict'

/** 卡片 tag(顶角小标) */
export interface DesigningCandidateTag {
  label: string
  variant: DesigningCandidateTagVariant
}

/** 量化指标行(如 "微服务调用 = 3 个") */
export interface DesigningCandidateMetric {
  /** 指标名(微服务调用 / 预估延迟 / 失败率) */
  label: string
  /** 数值(字符串由调用方决定:可能是 80ms / 0.01% / 7 个) */
  value: string
  /** 视觉强调色:good=success 绿 */
  tone?: 'good'
}

/**
 * 候选方案卡片数据(对应原型 .cards > .card)。
 *
 * - id:           A / B / C
 * - title:        "同步单阶段" / "异步多阶段" / "同步+回滚"
 * - tag:          最简 / AI 推荐 / 强一致
 * - pros / cons:  ✓/✗ 文本列表(每行以符号开头,UI 着色)
 * - metrics:      3 行量化指标
 * - recommended:  AI 推荐(决定 data-recommended=true + 边色高亮)
 */
export interface DesigningCandidate {
  id: DesigningCandidateId
  title: string
  tag: DesigningCandidateTag
  pros: string[]
  cons: string[]
  metrics: DesigningCandidateMetric[]
  recommended?: boolean
}

/** 设计文档目录项 */
export interface DesigningTocItem {
  id: string
  label: string
  level: number
}

/**
 * 设计文档(对应原型左侧 markdown 渲染)。
 *
 * - title:    "退款功能 · 设计文档"
 * - markdown: 段落正文(本期多段落文本,不做 MD 语法解析 —— 由 UI 用语义换行;
 *             后续接 DesignDoc Skill 后,加 ReactMarkdown 渲染即可)
 * - toc:      锚点列表(点击滚动到对应位置)
 */
export interface DesigningDesignDoc {
  title: string
  markdown: string
  toc: DesigningTocItem[]
}

/** 取舍点详情一行(对应原型 .tradeoff .row) */
export interface DesigningTradeoffRow {
  candidateId: DesigningCandidateId
  /** 该候选方案的简评,如 "A 简单但性能差,适合低频场景;" */
  summary: string
}

/** AI 推荐说明 */
export interface DesigningRecommendation {
  candidateId: DesigningCandidateId
  /** 推荐理由,如 "综合性能+容错,推荐 B (异步多阶段) — 与「退款时长 ≤ 30s」AC 最契合。" */
  reason: string
}

/** 底部取舍点详情 + AI 建议 */
export interface DesigningTradeoff {
  rows: DesigningTradeoffRow[]
  recommendation: DesigningRecommendation
}

/** 顶部 Stage 条 */
export interface DesigningStage {
  badge: string
  title: string
  /** 右上 meta("等选 3 / 3") */
  meta: string
}

/** Toolbar(面包屑) */
export interface DesigningToolbarCrumb {
  label: string
  current?: boolean
}

export interface DesigningToolbar {
  crumb: DesigningToolbarCrumb[]
}

/** 采纳候选方案载荷 */
export interface DesigningSelectPayload {
  candidateId: DesigningCandidateId
}

/** 让 AI 重做载荷;hint 可选 */
export interface DesigningRegeneratePayload {
  hint?: string
}

/** DESIGNING 工位顶层数据 */
export interface DesigningData {
  requirementId: string
  stage: DesigningStage
  toolbar: DesigningToolbar
  designDoc: DesigningDesignDoc
  candidates: DesigningCandidate[]
  tradeoff: DesigningTradeoff
  /**
   * 已选候选 id;null = 未选。组件 useState 维护,允许 server 预置(SSR 兜底)。
   * 渲染时,若 selectedCandidateId !== null → 该卡片 data-selected + 底部决策卡
   */
  selectedCandidateId: DesigningCandidateId | null
  /** 空数据(未知 id);UI 渲染引导去 ANALYZING */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 空数据(未知 id / 新建需求)
// ---------------------------------------------------------------------------

/**
 * 空状态 DESIGNING 工位数据。UI 渲染时若 data.empty === true → 走空态引导
 * (去 ANALYZING 让 AI 先产生分析流 / 子问题,才能进入候选方案阶段)。
 */
export function emptyDesigning(requirementId: string): DesigningData {
  return {
    requirementId,
    stage: { badge: '④ 设计', title: '', meta: '' },
    toolbar: { crumb: [] },
    designDoc: { title: '', markdown: '', toc: [] },
    candidates: [],
    tradeoff: {
      rows: [],
      recommendation: { candidateId: 'B', reason: '' },
    },
    selectedCandidateId: null,
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 11c DESIGNING(退款功能优化)
// 与 ANALYZING 工位的 OPTION chunks 对应(issue 19 mock 中 c-14/c-15 = A/B 雏形)
// ---------------------------------------------------------------------------

const REFUND_DESIGN_DOC: DesigningDesignDoc = {
  title: '退款功能 · 设计文档',
  // 多段落用换行分隔;UI 渲染时按段落拆分(本期不做 MD 解析;
  // 后续接 DesignDoc Skill 时加 ReactMarkdown 渲染即可)
  markdown: [
    '## 问题背景',
    '当前退款链路涉及 5 个微服务调用,平均退款耗时 12 分钟,失败率 0.6%(其中幂等不当导致的重复退款占 60%)。',
    '需求方:支付业务部 / 退款业务部 / 风控部。',
    '退款链路 SLA:',
    '· 退款发起 → 用户收到结果 ≤ 30s(99.9% 请求)',
    '· 单笔退款金额上限:5000 元(白名单账户 50000 元)',
    '· 退款失败率 ≤ 0.05%',
    '',
    '## 范围',
    '本设计文档覆盖同步单阶段 / 异步多阶段 / 同步+回滚 三种候选方案的技术取舍。',
    '',
    '## 关键流程',
    '退款发起 → 风控校验 → 库存回退 → 优惠券回退 → 银行打款 → 结果通知',
    '',
    '## 非目标',
    '· 不覆盖资金账户的设计(由账户域团队 owner)',
    '· 不覆盖退款审核规则的变更(由风控团队 owner)',
  ].join('\n'),
  toc: [
    { id: '问题背景', label: '问题背景', level: 0 },
    { id: '范围', label: '范围', level: 0 },
    { id: '关键流程', label: '关键流程', level: 0 },
    { id: '非目标', label: '非目标', level: 0 },
  ],
}

const REFUND_CANDIDATES: DesigningCandidate[] = [
  {
    id: 'A',
    title: '同步单阶段',
    tag: { label: '最简', variant: 'simple' },
    pros: [
      '实现简单,链路短',
      '易于调试与回归',
      '团队上手成本最低',
    ],
    cons: ['高并发下性能差', '失败率受雪崩影响'],
    metrics: [
      { label: '微服务调用', value: '3 个' },
      { label: '预估延迟', value: '250ms' },
      { label: '失败率', value: '0.1%' },
    ],
  },
  {
    id: 'B',
    title: '异步多阶段',
    tag: { label: 'AI 推荐', variant: 'recommended' },
    pros: [
      '容错好,可重试补偿',
      '性能优,吞吐高',
      '生产级可观测',
    ],
    cons: ['复杂度中等,需补一套事件总线', '调试链路较长'],
    metrics: [
      { label: '微服务调用', value: '7 个' },
      { label: '预估延迟', value: '80ms', tone: 'good' },
      { label: '失败率', value: '0.01%', tone: 'good' },
    ],
    recommended: true,
  },
  {
    id: 'C',
    title: '同步+回滚',
    tag: { label: '强一致', variant: 'strict' },
    pros: ['一致性最强,事务完整', '失败率极低'],
    cons: ['复杂度与维护成本高', '对团队强事务经验有要求'],
    metrics: [
      { label: '微服务调用', value: '5 个' },
      { label: '预估延迟', value: '320ms' },
      { label: '失败率', value: '0.001%', tone: 'good' },
    ],
  },
]

const REFUND_TRADEOFF: DesigningTradeoff = {
  rows: [
    {
      candidateId: 'A',
      summary: '简单但性能差,适合低频场景 / 团队人手不足时优先;',
    },
    {
      candidateId: 'B',
      summary: '复杂度中等但生产级,容错与性能兼顾,适配 SLO ≤ 30s;',
    },
    {
      candidateId: 'C',
      summary: '强一致但维护成本高,适合金额敏感强事务场景。',
    },
  ],
  recommendation: {
    candidateId: 'B',
    reason:
      '综合性能 + 容错,推荐 B(异步多阶段)— 与「退款时长 ≤ 30s」AC 最契合。',
  },
}

const REFUND_DESIGNING: Omit<DesigningData, 'requirementId'> = {
  empty: false,
  stage: {
    badge: '④ 设计',
    title: 'DESIGNING · Compare 形态 · 并排决策台',
    meta: '等选 3 / 3',
  },
  toolbar: {
    crumb: [
      { label: '退款功能优化' },
      { label: '/' },
      { label: '分析' },
      { label: '/' },
      { label: '方案评审', current: true },
    ],
  },
  designDoc: REFUND_DESIGN_DOC,
  candidates: REFUND_CANDIDATES,
  tradeoff: REFUND_TRADEOFF,
  selectedCandidateId: null,
}

/**
 * 拉取 DESIGNING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001)→ REFUND_DESIGNING 样例数据
 * - 未知 id / 新建需求 → emptyDesigning(id)
 *
 * 显式标注 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getDesigningData(
  requirementId: string,
): Promise<DesigningData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_DESIGNING, requirementId }
  }
  return emptyDesigning(requirementId)
}
