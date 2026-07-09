export type RequirementStatus =
  | 'draft' | 'analyzing' | 'designing' | 'planning'
  | 'implementing' | 'submitting' | 'done' | 'archived' | 'clarifying';

export type AIStatus =
  | 'idle' | 'thinking' | 'tool_calling'
  | 'writing' | 'awaiting_user' | 'error';

export interface Requirement {
  id: string;
  title: string;
  status: RequirementStatus;
  progress: number;
  repos: string[];
  updatedAt: string;
  currentStage?: string;
  currentTask?: number;
}

export interface Session { id: string; requirementId: string; title: string; aiStatus: AIStatus; currentTask?: string; filesRead?: number; ageMinutes: number; }
export interface InboxItem { id: string; kind: 'question' | 'error' | 'todo'; requirementTitle: string; message: string; agoMinutes: number; }
export interface Repository { name: string; branch: string; latestCommit: string; changedFiles: number; }
export interface Artifact { id: string; name: string; type: 'database' | 'config' | 'api' | 'test' | 'doc' | 'other'; requirementId: string; createdBy: string; agoMinutes: number; size: number; }

// mock 集合（Step 2 内增长；P1+ 改 SSE 接入）
export const requirements: Requirement[] = [
  { id: 'req-001', title: '退款功能优化', status: 'implementing', progress: 62, repos: ['refund-service', 'order-service'], updatedAt: '2026-07-09T15:00:00Z', currentStage: 'code-stage', currentTask: 12 },
  { id: 'req-002', title: '会员等级体系重构', status: 'clarifying', progress: 25, repos: ['member-service'], updatedAt: '2026-07-09T12:00:00Z', currentStage: 'analyze-stage' },
  { id: 'req-003', title: '支付链路灰度切流', status: 'designing', progress: 38, repos: ['pay-gateway', 'risk-service'], updatedAt: '2026-07-09T11:00:00Z', currentStage: 'design-stage' },
  { id: 'req-004', title: '订单导出（CSV）', status: 'done', progress: 100, repos: ['order-service'], updatedAt: '2026-07-08T09:00:00Z' },
  { id: 'req-005', title: '优惠券叠加规则', status: 'planning', progress: 48, repos: ['coupon-service'], updatedAt: '2026-07-07T14:00:00Z' },
  { id: 'req-006', title: '风险决策引擎接入', status: 'analyzing', progress: 15, repos: ['risk-service', 'pay-gateway'], updatedAt: '2026-07-06T16:00:00Z' },
  { id: 'req-007', title: '2023 Q4 活动复盘归档', status: 'archived', progress: 100, repos: ['promo-service'], updatedAt: '2026-05-01T10:00:00Z' },
  { id: 'req-008', title: '草稿：活动反作弊策略', status: 'draft', progress: 5, repos: [], updatedAt: '2026-07-09T08:00:00Z' },
  { id: 'req-009', title: '风控拦截 PR 提交', status: 'submitting', progress: 90, repos: ['risk-service'], updatedAt: '2026-07-09T13:30:00Z' },
  { id: 'req-010', title: '秒杀链路压测报告', status: 'done', progress: 100, repos: ['seckill-service', 'pay-gateway'], updatedAt: '2026-07-05T18:00:00Z' },
  { id: 'req-011', title: '购物车持久化重构', status: 'analyzing', progress: 30, repos: ['cart-service'], updatedAt: '2026-07-08T20:00:00Z' },
];

export const sessions: Session[] = [
  { id: 'sess-1', requirementId: 'req-001', title: '退款功能 · 实施中', aiStatus: 'thinking', currentTask: 'code-stage · Task #12 退款接口开发', filesRead: 8, ageMinutes: 0 },
  { id: 'sess-2', requirementId: 'req-002', title: '会员等级 · 待澄清', aiStatus: 'awaiting_user', currentTask: 'analyze-stage · 已生成 4 个问题', ageMinutes: 60 },
];

export const inbox: InboxItem[] = [
  { id: 'i-1', kind: 'question', requirementTitle: '退款功能', message: '退款失败时是否要回滚已扣减的优惠券额度？目前 code-stage 阻塞在这里', agoMinutes: 2 },
  { id: 'i-2', kind: 'error', requirementTitle: '支付链路灰度切流', message: 'SDK 调用失败：Anthropic API 502，Agent 已自动重试 2 次', agoMinutes: 15 },
  { id: 'i-3', kind: 'question', requirementTitle: '会员等级', message: '黄金会员的成长值是否继承历史等级？需要业务确认', agoMinutes: 60 },
];

export const repositories: Repository[] = [
  { name: 'refund-service', branch: 'feature/refund-optimize', latestCommit: 'abc1234', changedFiles: 12 },
  { name: 'order-service', branch: 'main', latestCommit: 'def5678', changedFiles: 0 },
  { name: 'pay-gateway', branch: 'feature/gray-payment', latestCommit: '9ab12cd', changedFiles: 7 },
];

export const artifacts: Artifact[] = [
  { id: 'a-1', name: 'refund.sql', type: 'database', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 10, size: 12000 },
  { id: 'a-2', name: 'refund-api.yaml', type: 'api', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 60, size: 8000 },
  { id: 'a-3', name: 'apollo.yaml', type: 'config', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 180, size: 4000 },
  { id: 'a-4', name: 'refund-sequence.md', type: 'doc', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 1440, size: 6000 },
  { id: 'a-5', name: 'refund-cases.md', type: 'test', requirementId: 'req-001', createdBy: 'test-stage', agoMinutes: 1440, size: 14000 },
  { id: 'a-6', name: 'application-refund.yml', type: 'config', requirementId: 'req-001', createdBy: 'code-stage', agoMinutes: 10, size: 2000 },
];

export interface ArtifactV2 {
  id: string;
  name: string;
  type: 'database' | 'api' | 'config' | 'doc' | 'test' | 'other';
  stageLabel: string;
  size: string;
  meta: string;
  snippet: string;
  footStatus: string;
  footStatusTone?: 'success' | 'warning';
  footTime: string;
  snippetBg: string;
  iconBg: string;
  iconText: string;
}

const REFUND_ARTIFACTS: ArtifactV2[] = [
  {
    id: 'a-1', name: 'refund.sql', type: 'database', stageLabel: 'SQL', iconBg: 'bg-[#336791]', iconText: 'SQL',
    size: '12 KB', meta: 'design-stage · 12 KB · 2 表',
    snippet: 'CREATE TABLE refund_order (\n  id BIGINT PRIMARY KEY,\n  order_id BIGINT NOT NULL,\n  user_id BIGINT...',
    footStatus: '已被 code-stage 引用', footTime: '10 分钟前', snippetBg: 'bg-bg-subtle',
  },
  {
    id: 'a-2', name: 'refund-api.yaml', type: 'api', stageLabel: 'OA', iconBg: 'bg-[#85ea2d]', iconText: 'OA',
    size: '8 KB', meta: 'design-stage · 8 KB · 5 接口',
    snippet: 'paths:\n  /refunds:\n    post:\n      summary: 创建退款单\n      requestBody: ...',
    footStatus: '已被 code-stage 引用', footTime: '1 小时前', snippetBg: 'bg-bg-subtle',
  },
  {
    id: 'a-3', name: 'apollo.yaml', type: 'config', stageLabel: '⚙', iconBg: 'bg-warning', iconText: '⚙',
    size: '4 KB', meta: 'design-stage · 4 KB · 8 配置',
    snippet: 'refund:\n  max-amount: 5000\n  auto-approve: false\n  retry-times: 3 ...',
    footStatus: '待人工审核', footStatusTone: 'warning', footTime: '3 小时前', snippetBg: 'bg-bg-subtle',
  },
  {
    id: 'a-4', name: 'refund-sequence.md', type: 'doc', stageLabel: '→', iconBg: 'bg-[#8b5cf6]', iconText: '→',
    size: '6 KB', meta: 'design-stage · 6 KB · Mermaid',
    snippet: 'sequenceDiagram\n  Client->>Gateway: POST /refunds\n  Gateway->>Refund: 创建退款单...',
    footStatus: '已被 review 引用', footTime: '昨天', snippetBg: 'bg-bg-subtle',
  },
  {
    id: 'a-5', name: 'refund-cases.md', type: 'test', stageLabel: '✓', iconBg: 'bg-success', iconText: '✓',
    size: '14 KB', meta: 'test-stage · 14 KB · 28 用例',
    snippet: '## TC-001 正常退款\n- Given 用户已下单\n- When 申请退款...',
    footStatus: '已采纳 · 28/28 通过', footTime: '昨天', snippetBg: 'bg-bg-subtle',
  },
  {
    id: 'a-6', name: 'application-refund.yml', type: 'config', stageLabel: '⚙', iconBg: 'bg-[#64748b]', iconText: '⚙',
    size: '2 KB', meta: 'code-stage · 2 KB',
    snippet: 'spring:\n  datasource:\n    url: jdbc:mysql://...\n    username: refund...',
    footStatus: '已写入 worktree', footTime: '10 分钟前', snippetBg: 'bg-bg-subtle',
  },
];

export function artifactsFor(reqId: string): ArtifactV2[] {
  if (reqId === 'req-001') return REFUND_ARTIFACTS;
  return [];
}

export interface HistoryEvent {
  id: string;
  kind: 'stage' | 'commit' | 'user';
  stageTag: string;
  stageTagBg: string;
  stageTagColor: string;
  when: string;
  title: string;
  body: React.ReactNode;
  files?: string[];
}

const REFUND_HISTORY: HistoryEvent[] = [
  {
    id: 'h-1',
    kind: 'stage',
    stageTag: '▶ code-stage',
    stageTagBg: 'bg-brand-50',
    stageTagColor: 'text-brand-600',
    when: '2 分钟前 · 会话 #003-code · AI 自动',
    title: '开始执行 Task #12 退款接口开发',
    body: '读取 design/02-api.md + refund.sql,正在生成 RefundService.java。已读 8 个文件,写入 0 个文件。',
    files: ['📄 design/02-api.md', '📄 artifacts/refund.sql', '📁 repos/refund-service/src/...'],
  },
  {
    id: 'h-2',
    kind: 'user',
    stageTag: '👤 用户决策',
    stageTagBg: 'bg-[#fff7ed]',
    stageTagColor: 'text-[#92400e]',
    when: '25 分钟前',
    title: '回答 AI 提问:「退款失败时是否回滚优惠券?」',
    body: '→ 是。回滚策略:调用 coupon-service 的 /compensate 接口,幂等键 = refund_id。code-stage 已据此修改。',
  },
  {
    id: 'h-3',
    kind: 'commit',
    stageTag: '✓ commit a8f3e21',
    stageTagBg: 'bg-[#dcfce7]',
    stageTagColor: 'text-[#166534]',
    when: '10 分钟前 · AI 自动提交',
    title: 'feat(refund): 退款订单表索引优化',
    body: '添加 idx_user_status_created 联合索引。包含 1 schema 变更 + 1 migration 脚本。',
    files: ['📄 artifacts/refund.sql', '📄 repos/refund-service/db/migration/V20240709_01.sql'],
  },
  {
    id: 'h-4',
    kind: 'stage',
    stageTag: '▶ code-stage',
    stageTagBg: 'bg-brand-50',
    stageTagColor: 'text-brand-600',
    when: '1 小时前',
    title: '完成 Task #11 设计退款表结构',
    body: '生成 2 张表(refund_order / refund_flow)+ 3 个索引 + 1 张序列图。等待人工 review 后 commit。',
  },
  {
    id: 'h-5',
    kind: 'commit',
    stageTag: '✓ commit 7c91b44',
    stageTagBg: 'bg-[#dcfce7]',
    stageTagColor: 'text-[#166534]',
    when: '2 小时前 · 李雷',
    title: 'feat(refund): 添加退款状态机',
    body: '人工 commit。补充 5 个边界状态。',
    files: ['📄 repos/refund-service/src/main/java/.../RefundStateMachine.java'],
  },
  {
    id: 'h-6',
    kind: 'stage',
    stageTag: '✓ plan-stage 完成',
    stageTagBg: 'bg-brand-50',
    stageTagColor: 'text-brand-600',
    when: '昨天 18:42',
    title: 'plan-stage 阶段完成 · 进入实施',
    body: '生成 19 个 Task,AI 评估总工作量 ~3 天。状态:DRAFT → ANALYZING → DESIGNING → PLANNING → IMPLEMENTING',
  },
  {
    id: 'h-7',
    kind: 'stage',
    stageTag: '+ 创建需求',
    stageTagBg: 'bg-[#f3e8ff]',
    stageTagColor: 'text-[#6b21a8]',
    when: '2026-07-08 14:30 · 李雷',
    title: '创建需求:退款功能优化',
    body: '从粘贴 PRD 开始。关联 2 个仓库(refund-service, order-service)。',
  },
];

export function historyFor(reqId: string): HistoryEvent[] {
  if (reqId === 'req-001') return REFUND_HISTORY;
  return [];
}

export interface ConvItem {
  seq: string;
  when: string;
  name: string;
  preview: string;
  active?: boolean;
}

const REFUND_CONVS: ConvItem[] = [
  {
    seq: '#003-code', when: '进行中', active: true,
    name: 'code-stage · 实施中',
    preview: '开始 Task #12 退款接口开发。读取 design/02-api.md + refund.sql,生成 RefundService.java...',
  },
  {
    seq: '#002-design', when: '昨天',
    name: 'design-stage · 已完成',
    preview: '生成数据库设计 + OpenAPI + Apollo 配置。3 个产物已落盘,14 次修订...',
  },
  {
    seq: '#001-analyze', when: '2026-07-08',
    name: 'analyze-stage · 已完成',
    preview: '基于 PRD 生成需求理解 + 4 个澄清问题。用户已回答 1 个,3 个待回答...',
  },
];

export function conversationsFor(reqId: string): ConvItem[] {
  if (reqId === 'req-001') return REFUND_CONVS;
  return [];
}

export interface KBRef { id: string; label: string; }
export interface RequirementSettings {
  name: string;
  slug: string;
  owner: string;
  targetBranch: string;
  skillChain: string;
  knowledgeRefs: KBRef[];
  autoPush: boolean;
  requireApproval: boolean;
  prdText: string;
}

const REFUND_SETTINGS: RequirementSettings = {
  name: '退款功能优化',
  slug: 'req-2024-007-refund-optimize',
  owner: '李雷',
  targetBranch: 'main',
  skillChain: 'analyze-stage → design-stage → plan-stage → code-stage → test-stage → submit-stage',
  knowledgeRefs: [
    { id: 'kb-1', label: '📚 domain/payment.md' },
    { id: 'kb-2', label: '📚 patterns/refund-3rd-party.md' },
    { id: 'kb-3', label: '📚 bugs/refund-idempotency.md' },
  ],
  autoPush: true,
  requireApproval: true,
  prdText: `# 退款功能优化

## 背景
当前退款流程存在以下问题:
1. 部分退款场景不支持
2. 退款失败时状态不一致
3. ...

## 目标
- 支持按订单项部分退款
- 退款失败自动回滚关联优惠券
- 退款链路状态机化`,
};

export function settingsFor(reqId: string): RequirementSettings | null {
  if (reqId === 'req-001') return REFUND_SETTINGS;
  return null;
}

export interface RepoCard {
  name: string;
  branch: string;
  worktreeShort: string;
  changedFiles: number;
  added: number;
  removed: number;
  commits: { sha: string; msg: string; meta: string }[];
}

const REFUND_REPOS: RepoCard[] = [
  {
    name: 'refund-service',
    branch: 'req-2024-007-refund-optimize',
    worktreeShort: 'req-2024-007',
    changedFiles: 12,
    added: 847,
    removed: 124,
    commits: [
      { sha: 'a8f3e21', msg: 'feat(refund): 退款订单表索引优化', meta: '10 分钟前 · AI 自动提交' },
      { sha: '7c91b44', msg: 'feat(refund): 添加退款状态机', meta: '1 小时前 · 李雷' },
      { sha: '3e0d9a1', msg: 'chore: 初始化 worktree', meta: '昨天 · Agent' },
    ],
  },
  {
    name: 'order-service',
    branch: 'req-2024-007-refund-optimize',
    worktreeShort: 'req-2024-007',
    changedFiles: 4,
    added: 128,
    removed: 12,
    commits: [
      { sha: '9d2e0ab', msg: 'feat(order): 退款时回写订单状态', meta: '25 分钟前 · AI 自动提交' },
      { sha: '5b71f3c', msg: 'chore: 初始化 worktree', meta: '昨天 · Agent' },
    ],
  },
];

export function reposFor(reqId: string): RepoCard[] {
  if (reqId === 'req-001') return REFUND_REPOS;
  return [];
}
