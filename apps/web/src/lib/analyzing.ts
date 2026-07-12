/**
 * ANALYZING 工位数据层(ADR-0011 §6 ANALYZING 布局 · issue 19)
 *
 * Thinking 大屏形态(对应原型 11e-stage-adaptive-analyzing.html,但本工位是
 * "主区全宽" —— 资源树 / Inline 栏都关掉,只显示思考屏本身):
 *
 * - 顶部 stats:子问题 N / 风险点 N / 候选方案 N
 * - 中部思考流:SSE 推送 chunk,打字机效果(20ms / 字),可暂停 / 重置 / 跳过
 * - 底部操作:[⏸ 暂停] [↶ 重置]
 *
 * 数据形态(对应 SSE chunk):
 * - 每个 chunk = 一行思考产物(label + text + ts + tone)
 * - chunks 中含 kind: 'subproblem' | 'risk' | 'option' 的项目被计入顶部 stats
 * - isComplete = true 时,UI 弹"AI 分析完成,切到 CLARIFYING 吗?"提示
 *
 * 设计原则(沿用 EXECUTING/DRAFTING 工位):
 * - 纯函数 + 类型化,便于单元测试
 * - 显式标注 async 为后续接 agent API 时的接口稳定
 * - 数据由 server 注入,组件只关心渲染 + 客户端打字机控制
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 思考流单 chunk 标签:对应 SSE 推送事件类型 */
export type AnalyzingChunkLabel =
  | 'START'
  | 'READ'
  | 'SCAN'
  | 'MATCH'
  | 'DETECT'
  | 'RISK'
  | 'INFER'
  | 'THINK'
  | 'OPTION'
  | 'COMPLETE'

/** chunk 语义分类:决定被顶部 stats 计入哪一类 */
export type AnalyzingChunkKind = 'narration' | 'subproblem' | 'risk' | 'option'

/** chunk 视觉调色(info=brand 蓝,success=绿,warn=黄,err=红) */
export type AnalyzingChunkTone = 'info' | 'success' | 'warn' | 'err'

/**
 * AI 思考流单 chunk —— 一次 SSE 推送对应一条 chunk。
 *
 * - label: 步骤标签(START/READ/DETECT 等),UI 渲染为彩色徽章
 * - text:  这一步骤的描述文字
 * - ts:    时间戳(形如 "14:23:01")
 * - kind:  决定是否计入顶部 stats(subproblem/risk/option 三类计数)
 * - tone:  决定 label 徽章背景色与左侧 border 颜色
 */
export interface AnalyzingChunk {
  id: string
  ts: string
  label: AnalyzingChunkLabel
  text: string
  kind: AnalyzingChunkKind
  tone: AnalyzingChunkTone
}

/** 顶部 stats 三档计数(对应原型 .summary-stat 三块) */
export interface AnalyzingStats {
  subproblems: number
  risks: number
  options: number
  /** 三个数字之和(便于渲染 "5 + 3 + 2" 类提示) */
  total: number
}

/** 思考流元数据 */
export interface AnalyzingStreamMeta {
  /** chunk 总数;UI 渲染 "X / Y" 进度 */
  totalChunks: number
  /** 流式是否仍在进行(false = 已全部到达,可弹完成提示) */
  isStreaming: boolean
  /** 流式开始时间(ISO);UI 渲染 "已运行 14s" */
  startedAt: string
  /** 流式结束时间(ISO);isStreaming=false 时存在 */
  endedAt: string | null
}

/** Toolbar(面包屑 + 动作按钮) */
export interface AnalyzingToolbarCrumb {
  label: string
  current?: boolean
}

/** Toolbar 按钮 —— 仅含 UI 决策(文案 + 样式),不绑定 ID。
 *  对齐 EXECUTING 样板的 `ToolbarAction` 设计;业务特定动作(如"复制思考产物")
 *  通过 variant 区分,本期不区分 ID。 */
export interface AnalyzingToolbarAction {
  label: string
  variant: 'primary' | 'secondary' | 'danger' | 'ghost'
}

export interface AnalyzingToolbar {
  crumb: AnalyzingToolbarCrumb[]
  actions: AnalyzingToolbarAction[]
}

/** 顶部摘要(原型 .thinking-summary:大图标 + 标题 + 描述 + 三 stats) */
export interface AnalyzingSummary {
  icon: string
  title: string
  description: string
}

/** ANALYZING 工位顶层数据 */
export interface AnalyzingData {
  requirementId: string
  toolbar: AnalyzingToolbar
  summary: AnalyzingSummary
  chunks: AnalyzingChunk[]
  streamMeta: AnalyzingStreamMeta
  /** 顶部 stats(chunks 派生 —— 也可由调用方预聚合) */
  stats: AnalyzingStats
  /** 空数据(无需求 / 新建需求);UI 渲染引导去 DRAFTING */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 纯函数:从 chunks 聚合 stats
// ---------------------------------------------------------------------------

/**
 * 聚合 stats:扫描 chunks 计数 kind === 'subproblem' / 'risk' / 'option'。
 * 纯函数,组件渲染前预计算 + 测试可独立验证。
 */
export function summarizeAnalyzingStats(
  chunks: readonly AnalyzingChunk[],
): AnalyzingStats {
  let subproblems = 0
  let risks = 0
  let options = 0
  for (const c of chunks) {
    if (c.kind === 'subproblem') subproblems++
    else if (c.kind === 'risk') risks++
    else if (c.kind === 'option') options++
  }
  return {
    subproblems,
    risks,
    options,
    total: subproblems + risks + options,
  }
}

// ---------------------------------------------------------------------------
// 空数据(新建需求 / 未知 id)
// ---------------------------------------------------------------------------

/**
 * 空状态 ANALYZING 工位数据。
 * UI 渲染时若 data.empty === true → 走空态引导(去 DRAFTING 写 PRD)。
 */
export function emptyAnalyzing(requirementId: string): AnalyzingData {
  return {
    requirementId,
    toolbar: { crumb: [], actions: [] },
    summary: { icon: '', title: '', description: '' },
    chunks: [],
    streamMeta: {
      totalChunks: 0,
      isStreaming: false,
      startedAt: '',
      endedAt: null,
    },
    stats: { subproblems: 0, risks: 0, options: 0, total: 0 },
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 11e ANALYZING(退款功能优化)
// ---------------------------------------------------------------------------

/**
 * 退款功能优化样例 —— 11 行思考流(其中 5 子问题 + 2 风险 + 2 方案方向)。
 * 对应原型 .thinking-stream 中的全部行;最后一行(THINK)是打字机当前正在打字的"活动行"。
 */
const REFUND_ANALYZING_CHUNKS: AnalyzingChunk[] = [
  {
    id: 'c-1',
    ts: '14:23:01',
    label: 'START',
    text: '接收需求文档(847 字)+ 2 个仓库路径',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-2',
    ts: '14:23:02',
    label: 'READ',
    text: 'requirement.md · 抽取 5 个业务目标',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-3',
    ts: '14:23:04',
    label: 'SCAN',
    text: 'refund-service · 识别 3 个相关模块',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-4',
    ts: '14:23:05',
    label: 'MATCH',
    text: '知识库命中:退款业务 v2 · 退款幂等 pattern · bug history',
    kind: 'narration',
    tone: 'info',
  },
  // 5 个 subproblem(对应原型 .identified-item.subproblem × 5)
  {
    id: 'c-5',
    ts: '14:23:07',
    label: 'DETECT',
    text: 'Q1 · 退款单笔金额上限?PRD 未明确',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-6',
    ts: '14:23:08',
    label: 'DETECT',
    text: 'Q2 · 退款审核流?自动 / 人工 / 阈值',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-7',
    ts: '14:23:08',
    label: 'DETECT',
    text: 'Q3 · 退款失败时回滚策略?',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-8',
    ts: '14:23:09',
    label: 'DETECT',
    text: 'Q4 · 退款幂等实现?幂等键 + 重试窗口',
    kind: 'subproblem',
    tone: 'success',
  },
  {
    id: 'c-9',
    ts: '14:23:09',
    label: 'DETECT',
    text: 'Q5 · 部分退款规则?单笔次数 + 累计上限',
    kind: 'subproblem',
    tone: 'success',
  },
  // 3 个 risk(对应原型 .identified-item.risk × 3)
  {
    id: 'c-10',
    ts: '14:23:10',
    label: 'RISK',
    text: '高并发退款重复创建(bug #247 · 相关度 0.82)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-11',
    ts: '14:23:11',
    label: 'RISK',
    text: '退款失败优惠券未回滚(bug #312 · 相关度 0.91)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-12',
    ts: '14:23:12',
    label: 'RISK',
    text: '微服务调用链路过长(5 跳)',
    kind: 'risk',
    tone: 'warn',
  },
  {
    id: 'c-13',
    ts: '14:23:13',
    label: 'INFER',
    text: '从退款幂等 pattern 推断:本需求必须包含幂等设计',
    kind: 'narration',
    tone: 'info',
  },
  // 2 个 option(对应原型 .identified-item.option × 2)
  {
    id: 'c-14',
    ts: '14:23:14',
    label: 'OPTION',
    text: 'A · 同步单阶段 · 单事务 · 250ms',
    kind: 'option',
    tone: 'success',
  },
  {
    id: 'c-15',
    ts: '14:23:14',
    label: 'OPTION',
    text: 'B · 异步多阶段 · 事件驱动 · 80ms',
    kind: 'option',
    tone: 'success',
  },
  {
    id: 'c-16',
    ts: '14:23:15',
    label: 'THINK',
    text: '正在评估方案 B 异步多阶段的失败回滚边界...',
    kind: 'narration',
    tone: 'info',
  },
  {
    id: 'c-17',
    ts: '14:23:18',
    label: 'COMPLETE',
    text: '分析完成 · 识别 5 子问题 + 3 风险 + 2 方案方向',
    kind: 'narration',
    tone: 'success',
  },
]

const REFUND_ANALYZING: Omit<AnalyzingData, 'requirementId'> = {
  empty: false,
  toolbar: {
    crumb: [
      { label: '退款功能优化' },
      { label: '/' },
      { label: '分析' },
      { label: '/' },
      { label: 'AI 思考过程', current: true },
    ],
    actions: [
      { label: '📋 复制思考产物', variant: 'secondary' },
      { label: '⏸ 暂停', variant: 'danger' },
      { label: '↶ 重置', variant: 'danger' },
    ],
  },
  summary: {
    icon: '🧠',
    title: 'AI 正在解析需求:退款功能优化',
    description:
      '正在扫描 2 个关联仓库 · 引用 3 条知识库记录 · 已识别子问题 / 风险点 / 候选方案方向',
  },
  chunks: REFUND_ANALYZING_CHUNKS,
  streamMeta: {
    totalChunks: REFUND_ANALYZING_CHUNKS.length,
    isStreaming: true,
    startedAt: '2026-07-12T14:23:01.000Z',
    endedAt: null,
  },
  stats: summarizeAnalyzingStats(REFUND_ANALYZING_CHUNKS),
}

/**
 * 拉取 ANALYZING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001)→ REFUND_ANALYZING 样例数据
 * - 未知 id / 新建需求 → emptyAnalyzing(id)
 */
export async function getAnalyzingData(
  requirementId: string,
): Promise<AnalyzingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_ANALYZING, requirementId }
  }
  return emptyAnalyzing(requirementId)
}