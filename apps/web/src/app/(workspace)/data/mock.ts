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
  { id: 'req-002', title: '会员等级体系重构', status: 'clarifying', progress: 25, repos: ['member-service'], updatedAt: '2026-07-08T18:00:00Z', currentStage: 'analyze-stage' },
  { id: 'req-003', title: '支付链路灰度切流', status: 'designing', progress: 38, repos: ['pay-gateway', 'risk-service'], updatedAt: '2026-07-09T11:00:00Z', currentStage: 'design-stage' },
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
  { id: 'a-1', name: 'refund.sql', type: 'database', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 240, size: 4200 },
  { id: 'a-2', name: 'refund-api.yaml', type: 'api', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 220, size: 8400 },
  { id: 'a-3', name: 'apollo.yaml', type: 'config', requirementId: 'req-001', createdBy: 'design-stage', agoMinutes: 200, size: 1100 },
];
