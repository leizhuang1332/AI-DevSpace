/**
 * ANALYZING 工位测试 fixture
 *
 * ticket 03 改造:把原本放在 `apps/web/src/lib/analyzing.ts` 里的
 * `REFUND_ANALYZING` 常量迁到这里,作为测试专用 fixture。
 *
 * 改造动机:
 * - 历史背景:原 `REFUND_ANALYZING` 作为运行时 mock 挂在 `analyzing.server.ts`
 *   里 `getAnalyzingData('req-001')` 的硬短路分支上 —— 当 SSR 加载 req-001
 *   时不读 fs,直接返回样例数据(给 UI 演示 + 早期 dev 提供 mock)
 * - ticket 01 之后:`getAnalyzingData('req-001')` 已经真接 SDK,
 *   运行时短路不再安全 —— 短路的副作用是"req-001 在磁盘空时也能渲染
 *   AdmissionDashboard 满数据",这与其它 id 行为不一致,会破坏 ticket 05
 *   计划的"统一空态 → 点开始分析"UX
 * - ticket 03 决策:把 `REFUND_ANALYZING` 从 runtime 迁出到这里,仅作测试 fixture;
 *   4 个消费 `getAnalyzingData('req-001')` mock 数据的测试改 import 此处,
 *   测的依然是"样例数据契约"(shape / stats / admission 等),而不是
 *   "运行时短路行为"
 *
 * 消费方 import 约定:`@/__tests__/__fixtures__/analyzing-fixtures`
 * (对应 tsconfig paths `@/*` → `./src/*`)
 *
 * 向后兼容:为了让没改 import 的旧调用方(若还有)继续工作,
 * `apps/web/src/lib/analyzing.ts` 通过 re-export 暴露同名字常量;
 * 新代码应直接 import 此 fixture 文件,而不是经 analyzing.ts。
 */

import type { AnalyzingChunk, AnalyzingData } from '@/lib/analyzing'
import { buildAdmissionData, summarizeAnalyzingStats } from '@/lib/analyzing'

// ---------------------------------------------------------------------------
// 思考流 chunks —— 17 行(4 narration + 5 subproblem + 3 risk + 2 option +
//   3 narration),5 子问题 + 3 风险 + 2 方案方向
// ---------------------------------------------------------------------------

/**
 * 退款功能优化样例 —— 17 行思考流(其中 5 子问题 + 3 风险 + 2 方案方向)。
 * 对应原型 .thinking-stream 中的全部行;最后一行(COMPLETE)是活动结束态。
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

// ---------------------------------------------------------------------------
// 顶层 fixture —— Omit<AnalyzingData, 'requirementId'>
// ---------------------------------------------------------------------------

/**
 * 退款功能优化样例的完整 ANALYZING 工位数据(不含 `requirementId`,
 * 因为它是 per-request 注入的;用 `refundAnalyzingFixture(id)` 取带 id 的全量数据)
 *
 * 用途:
 * - 组件测试:渲染 `<AnalyzingZone data={refundAnalyzingFixture('req-001')} />`,
 *   直接给 UI 看满数据;不再依赖 `getAnalyzingData('req-001')` 的运行时 mock
 * - 数据契约测试:验证 shape / stats / admission 字段,与原
 *   `getAnalyzingData('req-001')` 行为等价
 */
export const REFUND_ANALYZING: Omit<AnalyzingData, 'requirementId'> = {
  empty: false,
  phase: 'active',
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
  // issue 19a VS1 — admission 仪表板样例(2 资损 + 3 性能 + 1 架构 + 0 业务 + 4 上下文,
  // 因有 🔴 资损 → 默认 verdict='fail';pendingAdjudicationCount=10 模拟"待裁决 10")
  admission: buildAdmissionData({
    counts: {
      loss_prevention: 2,
      performance: 3,
      arch_conflict: 1,
      business_reasonable: 0,
      context_query: 4,
    },
    pendingAdjudicationCount: 10,
    verdict: 'fail',
  }),
  // issue 19e VS5 — tech brief preview 占位(实际数据由 server 端按需加载)
  canGenerateBrief: true,
  techBriefPreview: null,
  modulesPreview: null,
  briefGeneratedAt: null,
  // issue 19c VS3 — 多会话样例(架构 / 数据 / 接口 3 个 Tab,主区显示"数据"会话)
  sessions: [
    {
      id: 'sess-arch',
      label: '架构',
      angle: 'architecture',
      detectedCount: 3,
      isStreaming: false,
    },
    {
      id: 'sess-data',
      label: '数据',
      angle: 'data',
      detectedCount: 5,
      isStreaming: true,
    },
    {
      id: 'sess-interface',
      label: '接口',
      angle: 'interface',
      detectedCount: 8,
      isStreaming: false,
    },
  ],
  activeSessionId: 'sess-data',
  // ADR-0017 D5 — SSR 注入 PRD / AuxFile / Asset(mock 样例:退款功能优化的代表性内容)
  prdMarkdown: [
    '# 退款功能优化',
    '',
    '## 背景',
    '',
    '退款业务是电商核心链路之一,当前实现存在幂等问题导致重复退款;此外高并发场景下',
    '微服务调用链路过长(5 跳),失败时优惠券未回滚会导致资损。',
    '',
    '## 目标',
    '',
    '- 退款单笔金额 ≤ 1000 元',
    '- 退款审核流:自动 / 人工阈值 5000 元',
    '- 幂等键 + 7 天重试窗口',
    '',
    '![退款流程图](assets/refund-flow.png)',
    '',
    '## 验收标准',
    '',
    '- [ ] 高并发退款不重复创建(bug #247 复现)',
    '- [ ] 退款失败时优惠券回滚',
    '',
  ].join('\n'),
  auxFiles: [
    {
      id: 'aux-api-refund',
      filename: 'api-refund.md',
      usage_tag: 'api',
      source_format: 'md',
      converted_to_md: false,
      body: [
        '# 退款 API 文档',
        '',
        '## POST /api/refunds',
        '',
        '请求参数:`orderId`, `amount`, `reason`。',
        '幂等键:`Idempotency-Key` 头,7 天窗口。',
        '',
      ].join('\n'),
    },
    {
      id: 'aux-data-orders',
      filename: 'data-orders.md',
      usage_tag: 'data',
      source_format: 'md',
      converted_to_md: false,
      body: [
        '# 订单表设计',
        '',
        '`orders(id, amount, status, refund_status, created_at)`。',
        '',
      ].join('\n'),
    },
  ],
  assetList: [
    {
      name: 'refund-flow.png',
      url: '/api/requirement/req-001/assets/refund-flow.png',
      path: 'requirements/req-001/assets/refund-flow.png',
      size: 102400,
      mime: 'image/png',
    },
  ],
}

/**
 * 退款功能优化样例的完整 `AnalyzingData`(含 `requirementId`)。
 *
 * 测试用法:
 * ```ts
 * const data = refundAnalyzingFixture('req-001')
 * render(<AnalyzingZone data={data} />)
 * ```
 *
 * 返回的是新对象(`{ ...REFUND_ANALYZING, requirementId: id }`),
 * 多次调用之间互不干扰 —— 测试可在同一个 `describe` 块内多次调用而无需
 * 担心 mutation 泄漏。
 */
export function refundAnalyzingFixture(requirementId: string): AnalyzingData {
  return { ...REFUND_ANALYZING, requirementId }
}
