// ticket 07b:`RequirementStatusT` 与 `Requirement` 类型已迁到 `@ai-devspace/shared` 的
// `RequirementSummary` / `RequirementStatusT`(跨端契约)。本文件仍 re-export `Requirement`
// 作 alias,便于后续消费方渐进迁移。
export type { RequirementSummary as Requirement } from '@ai-devspace/shared'
// 同时 re-export RequirementStatusT 方便旧 import 兼容(下个迭代清掉)。
export type { RequirementStatusT as RequirementStatus } from '@ai-devspace/shared'

export type AIStatus =
  | 'idle' | 'thinking' | 'tool_calling'
  | 'writing' | 'awaiting_user' | 'error';

export interface Session { id: string; requirementId: string; title: string; aiStatus: AIStatus; currentTask?: string; filesRead?: number; ageMinutes: number; }
export interface InboxItem { id: string; kind: 'question' | 'error' | 'todo'; requirementTitle: string; message: string; agoMinutes: number; }
export interface Repository { name: string; branch: string; latestCommit: string; changedFiles: number; }
export interface Artifact { id: string; name: string; type: 'database' | 'config' | 'api' | 'test' | 'doc' | 'other'; requirementId: string; createdBy: string; agoMinutes: number; size: number; }

// ticket 07b:`requirements` mock 数组已收敛,真实数据走 `GET /api/requirements`(见
// apps/web/src/lib/requirement-list.server.ts)。sessions / inbox / repositories /
// knowledge / skills / settings / artifacts / repoDetails 等其他 mock 暂保留
// (P1+ 才收敛)。
// mock 集合（Step 2 内增长；P1+ 改 SSE 接入）

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
  { name: 'refund-service',  branch: 'feature/refund-optimize', latestCommit: 'a8f3e21', changedFiles: 12 },
  { name: 'order-service',   branch: 'main',                     latestCommit: '9d2e0ab', changedFiles: 0  },
  { name: 'member-service',  branch: 'feature/member-tier',      latestCommit: 'b1c7e22', changedFiles: 3  },
  { name: 'pay-gateway',     branch: 'feature/gray-payment',     latestCommit: 'c4d9f30', changedFiles: 7  },
  { name: 'risk-service',    branch: 'main',                     latestCommit: 'e5a1b82', changedFiles: 0  },
  { name: 'coupon-service',  branch: 'feature/coupon-stack',     latestCommit: 'f6b2c93', changedFiles: 5  },
  { name: 'cart-service',    branch: 'main',                     latestCommit: '7d8e4a1', changedFiles: 0  },
  { name: 'seckill-service', branch: 'main',                     latestCommit: '8e9f5b2', changedFiles: 0  },
];

export interface KnowledgeItem {
  id: string;
  title: string;
  category: 'domain' | 'pattern' | 'bug' | 'standard' | 'note';
  body: string;
  tags: string[];
  source: 'ai' | 'human';
  refs: number;
  agoText: string;
}

export const knowledge: KnowledgeItem[] = [
  { id: 'kb-1', title: '退款幂等性处理方案', category: 'bug',     body: '退款请求必须携带 idempotency_key，服务端用 Redis SETNX 锁 5 分钟。key 格式：refund:{user_id}:{order_id}:{timestamp_bucket}。若用户重复点击（前端未禁用），第二次直接返回第一次结果（缓存 1h）...', tags: ['refund', 'idempotency', 'redis'],         source: 'ai',    refs: 8,  agoText: '5 天前'   },
  { id: 'kb-2', title: '支付链路异步回调状态机', category: 'pattern', body: '支付网关 → 商户回调采用状态机驱动（PENDING → PROCESSING → SUCCESS/FAILED/EXPIRED）。每个状态变更写入 payment_callback_log 表，必须保证 at-least-once 投递...', tags: ['payment', 'callback', 'state-machine'], source: 'human', refs: 12, agoText: '1 周前'   },
  { id: 'kb-3', title: '退款链路数据库设计规范', category: 'domain',  body: '退款涉及 4 张核心表：refund_order（主单）、refund_flow（状态变更）、refund_compensation（补偿记录）、refund_audit（审计日志）。所有表必须有 created_at 和 updated_at...', tags: ['refund', 'database', 'spec'], source: 'human', refs: 5,  agoText: '2 周前'   },
  { id: 'kb-4', title: '会员成长值并发更新 Bug 修复', category: 'bug',  body: '高并发下用户成长值丢失。根因：UPDATE member_growth SET value = value + ? WHERE user_id=? 在 RR 隔离级别下未加行锁。修复：使用 SELECT ... FOR UPDATE 悲观锁...', tags: ['member', 'concurrency', 'mysql'],           source: 'ai',    refs: 6,  agoText: '3 周前'   },
  { id: 'kb-5', title: '后端 Java 代码规范（公司级）', category: 'standard', body: '所有 Controller 必须返回 Result<T> 包装类；Service 层禁止直接操作 HttpServletRequest；异常统一抛 BizException + 全局 @RestControllerAdvice 捕获...', tags: ['java', 'spec', 'company'],                 source: 'human', refs: 32, agoText: '1 月前'   },
  { id: 'kb-6', title: '会员等级体系业务模型', category: 'domain', body: '会员分为 6 级（V1-V6），升级由成长值驱动。成长值来源：消费 1 元 = 1 点；签到 1 天 = 5 点；评论 = 2 点。降级保护：V4 及以上 90 天无消费不降级...', tags: ['member', 'business', 'tier'], source: 'human', refs: 4, agoText: '1 月前' },
  { id: 'kb-7', title: '订单状态机流转规则', category: 'pattern', body: '订单主状态 7 种：CREATED / PAID / SHIPPED / COMPLETED / REFUNDING / REFUNDED / CANCELLED。状态转换需写入 order_state_log 表，由 OrderStateMachine 统一驱动，禁止 Service 散落改状态...', tags: ['order', 'state-machine'], source: 'human', refs: 9, agoText: '2 月前' },
  { id: 'kb-8', title: '优惠券叠加规则配置化方案', category: 'pattern', body: '把优惠券叠加规则抽到 coupon_stack_rule 表，规则按 (coupon_type, scene, user_tier) 维度匹配。前端只展示「最优叠加组合」，后端按规则树计算最终抵扣金额...', tags: ['coupon', 'rule-engine'], source: 'ai', refs: 3, agoText: '3 周前' },
  { id: 'kb-9', title: '风控拦截误杀率优化', category: 'bug', body: '上线后风控拦截误杀率 1.2%。根因：规则阈值硬编码。修复：阈值改为 Apollo 动态配置 + 灰度切流；增加白名单机制；离线复盘最近 7 天拦截明细，调参 3 次...', tags: ['risk', 'config', 'tuning'], source: 'ai', refs: 5, agoText: '2 周前' },
  { id: 'kb-10', title: '下单链路幂等方案', category: 'pattern', body: '下单接口使用 token + Redis 防重：前端调用 /order/token 获取一次性 token（5 分钟有效），提交订单时携带，服务端 SETNX 校验。同一用户 1 秒内多次提交只生效一次...', tags: ['order', 'idempotency'], source: 'human', refs: 7, agoText: '1 月前' },
  { id: 'kb-11', title: '分布式链路追踪接入', category: 'standard', body: '统一使用 SkyWalking 9.x 接入。所有 RPC 调用必须传 traceId（从 Header 或 Context 取）；日志模板含 [%traceId] [%spanId] 占位符；本地开发用本地探针不连服务端...', tags: ['observability', 'spec'], source: 'human', refs: 15, agoText: '3 月前' },
  { id: 'kb-12', title: '购物车持久化 Redis 方案', category: 'pattern', body: '购物车数据存 Redis Hash 结构：key=cart:{user_id}，field=sku_id，value=数量 + 加购时间。TTL 30 天。每次访问先读 Redis，未命中回源 DB 并回写...', tags: ['cart', 'redis', 'storage'], source: 'ai', refs: 4, agoText: '2 周前' },
];

export interface Skill {
  id: string;
  name: string;
  stage: string;
  builtIn: boolean;
  version: string;
  description: string;
  injects: string;
  outputs: string;
  createdText?: string;
}

export const skills: Skill[] = [
  { id: 'sk-analyze', name: 'analyze-stage',   stage: 'DRAFT → ANALYZING', builtIn: true,  version: 'v1.0', description: '读取 requirement.md，生成需求理解（01-understanding.md）和澄清问题（02-questions.md）。理解不清的地方必须提问，不能假设。', injects: 'requirement.md',                                outputs: 'analysis/*' },
  { id: 'sk-design',  name: 'design-stage',    stage: 'DESIGNING',         builtIn: true,  version: 'v1.0', description: '基于分析结果生成数据库、API、服务层三层设计。必须产出 OpenAPI yaml 和 SQL DDL。', injects: 'analysis/ + knowledge',                            outputs: 'design/* + artifacts/*' },
  { id: 'sk-plan',    name: 'plan-stage',      stage: 'PLANNING',          builtIn: true,  version: 'v1.0', description: '将设计分解为可执行的 Task 列表（tasks.md）。每个 Task 包含验收标准、关联产物、预估工作量。', injects: 'design/*',                                       outputs: 'plan/tasks.md' },
  { id: 'sk-code',    name: 'code-stage',      stage: 'IMPLEMENTING',      builtIn: true,  version: 'v1.0', description: '逐个执行 Task，写入代码到对应 repo 的 worktree。完成后自动 commit（需用户授权）。遇到阻塞自动生成问题。', injects: 'plan/ + design/ + 当前 Task',         outputs: 'commit + 更新 tasks.md' },
  { id: 'sk-test',    name: 'test-stage',      stage: 'IMPLEMENTING',      builtIn: true,  version: 'v1.0', description: '为每个 Task 生成测试用例（正常 / 边界 / 异常），自动运行单元测试，失败回写 code-stage。', injects: 'code diff + plan/tasks.md',                       outputs: 'test/*.md + junit report' },
  { id: 'sk-submit',  name: 'submit-stage',    stage: 'SUBMITTING',        builtIn: true,  version: 'v1.0', description: '合并 worktree 到目标分支，触发 CI，发起 PR（GitHub / GitLab），等待 Code Review 结果。', injects: 'worktree + tasks.md',                            outputs: 'PR + merge commit' },
  { id: 'sk-review',  name: 'company-review-stage', stage: 'REVIEW',        builtIn: false, version: 'v0.3', description: '遵循公司 review 规范的代码审查 Skill。检查命名规范、异常处理、日志格式（基于 knowledge/standards/java-code-spec.md）。', injects: 'code diff + standards', outputs: 'review/*.md', createdText: '用户自定义 · 1 个月前' },
  { id: 'sk-mig',     name: 'db-migration-stage',    stage: 'DEPLOY',       builtIn: false, version: 'v0.1', description: '数据库迁移脚本生成。读取 SQL DDL，自动生成 Flyway / Liquibase 兼容的版本化迁移脚本（含回滚段）。', injects: 'artifacts/*.sql',                              outputs: 'repos/*/db/migration/V*.sql', createdText: '用户自定义 · 2 周前' },
];

export interface GlobalSettings {
  theme: 'system' | 'light' | 'dark';
  typewriterSpeed: 'off' | 'fast' | 'medium' | 'slow';
  silentMode: boolean;
  silentWindowSeconds: number;
  agentEndpoint: string;
  workspaceRoot: string;
  diskUsage: string;
}

export const settings: GlobalSettings = {
  theme: 'light',
  typewriterSpeed: 'medium',
  silentMode: true,
  silentWindowSeconds: 30,
  agentEndpoint: 'http://localhost:7777',
  workspaceRoot: '~/.aidevspace/',
  diskUsage: '1.2 GB · 28 个需求 · 8 个仓库 · 47 条知识',
};

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

// =====================================================================
// 仓库详情 (page 09 repos/[name]) — 下沉以避免与 repositories[] 漂移
// =====================================================================

export type WorktreeBadgeTone = 'succ' | 'warm' | 'plain';

export interface RepoWorktree {
  branch: string;
  meta: string;
  path: string;
  reqLink?: string;
  badgeTone: WorktreeBadgeTone;
  badgeText: string;
}

export interface RepoCommit {
  sha: string;
  msg: string;
  author: string;
}

export interface RepoDetailStats {
  worktrees: number;
  linkedReqs: number;
  disk?: string;
  fetchText: string;
}

export interface RepoRepoStats {
  worktrees: number;
  linkedReqs: number;
  fetchText: string;
  ahead: string;
}

export interface RepoTag {
  label: string;
  tone: WorktreeBadgeTone;
}

export interface RepoDetail {
  worktrees: RepoWorktree[];
  commits: RepoCommit[];
  detailStats: RepoDetailStats;
  repoStats: RepoRepoStats;
  tags: RepoTag[];
  date: string;
}

export const EMPTY_REPO_DETAIL: RepoDetail = {
  worktrees: [],
  commits: [],
  detailStats: { worktrees: 1, linkedReqs: 0, fetchText: '—' },
  repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '—', ahead: 'synced' },
  tags: [],
  date: '—',
};

export const repoDetails: Record<string, RepoDetail> = {
  'refund-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · 最新 commit 3 天前',                       path: '~/.aidevspace/repos/refund-service',                            badgeTone: 'succ',  badgeText: '干净' },
      { branch: 'req-2024-007-refund-optimize',         meta: '10 分钟前 · a8f3e21',                                path: '~/.aidevspace/requirements/req-2024-007/refund-service',        reqLink: '退款功能优化', badgeTone: 'warm',  badgeText: '12 文件 · +847' },
      { branch: 'req-2024-002-refund-v2',               meta: '2 天前 · e1b2c4d',                                   path: '~/.aidevspace/requirements/req-2024-002/refund-service',        reqLink: '退款链路 v2',   badgeTone: 'warm',  badgeText: '3 文件 · +124' },
    ],
    commits: [
      { sha: 'a8f3e21', msg: 'feat(refund): 退款订单表索引优化',   author: '李雷 · 10 分钟前' },
      { sha: '9d2e0ab', msg: 'feat(order): 退款时回写订单状态',   author: '李雷 · 25 分钟前' },
      { sha: '7c91b44', msg: 'feat(refund): 添加退款状态机',      author: '李雷 · 1 小时前' },
      { sha: '3e0d9a1', msg: 'chore: 升级 spring-boot 3.2',      author: '李雷 · 昨天'     },
      { sha: '5b71f3c', msg: 'feat: 接入 Prometheus 监控',       author: '李雷 · 2 天前'   },
    ],
    detailStats: { worktrees: 3, linkedReqs: 2, disk: '128 MB', fetchText: '5 分钟前' },
    repoStats:   { worktrees: 3, linkedReqs: 2, fetchText: '5 分钟前',  ahead: '12 commits ahead' },
    tags: [
      { label: '退款功能优化',    tone: 'succ'  },
      { label: '退款链路 v2',     tone: 'plain' },
      { label: '退款幂等性修复', tone: 'warm' },
    ],
    date: '2026-07-08',
  },
  'order-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/order-service',                              badgeTone: 'succ',  badgeText: '干净' },
      { branch: 'req-2024-007-refund-optimize',         meta: '25 分钟前 · 9d2e0ab',                                 path: '~/.aidevspace/requirements/req-2024-007/order-service',         reqLink: '退款功能优化', badgeTone: 'warm',  badgeText: '4 文件 · +128' },
    ],
    commits: [
      { sha: '9d2e0ab', msg: 'feat(order): 退款时回写订单状态',   author: '李雷 · 25 分钟前' },
      { sha: '7c91b44', msg: 'feat(order): 订单导出 CSV',          author: '李雷 · 2 天前'   },
    ],
    detailStats: { worktrees: 2, linkedReqs: 2, disk: '92 MB', fetchText: '2 小时前' },
    repoStats:   { worktrees: 2, linkedReqs: 2, fetchText: '2 小时前',  ahead: 'synced'          },
    tags: [
      { label: '退款功能优化',   tone: 'succ'  },
      { label: '订单导出（CSV）', tone: 'plain' },
    ],
    date: '2026-07-08',
  },
  'member-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/member-service',                             badgeTone: 'succ',  badgeText: '干净' },
      { branch: 'feature/member-tier',                  meta: '3 天前 · b1c7e22',                                    path: '~/.aidevspace/requirements/req-002-tier/member-service',        reqLink: '会员等级体系重构', badgeTone: 'warm',  badgeText: '3 文件 · +56' },
    ],
    commits: [
      { sha: 'b1c7e22', msg: 'feat(member): 等级体系重构',          author: '李雷 · 3 天前'   },
      { sha: '4b1cd09', msg: 'fix: 成长值并发更新',                author: '李雷 · 1 周前'   },
    ],
    detailStats: { worktrees: 2, linkedReqs: 1, disk: '64 MB', fetchText: '昨天' },
    repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '昨天',     ahead: '3 commits behind' },
    tags: [{ label: '会员等级体系重构', tone: 'warm' }],
    date: '2026-07-07',
  },
  'pay-gateway': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/pay-gateway',                                badgeTone: 'succ',  badgeText: '干净' },
      { branch: 'feature/gray-payment',                 meta: '1 小时前 · c4d9f30',                                  path: '~/.aidevspace/requirements/req-003-gray/pay-gateway',           reqLink: '支付链路灰度切流', badgeTone: 'warm',  badgeText: '7 文件 · +212' },
    ],
    commits: [
      { sha: 'c4d9f30', msg: 'feat(pay): 灰度切流配置',             author: '李雷 · 1 小时前' },
      { sha: '8a7e6d5', msg: 'feat(pay): 风险引擎接入',            author: '李雷 · 2 天前'   },
    ],
    detailStats: { worktrees: 2, linkedReqs: 2, disk: '156 MB', fetchText: '3 小时前' },
    repoStats:   { worktrees: 2, linkedReqs: 2, fetchText: '3 小时前',  ahead: 'synced'          },
    tags: [
      { label: '支付链路灰度切流', tone: 'plain' },
      { label: '风险决策引擎接入', tone: 'warm'  },
    ],
    date: '2026-07-09',
  },
  'risk-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/risk-service',                               badgeTone: 'succ',  badgeText: '干净' },
    ],
    commits: [
      { sha: 'e5a1b82', msg: 'feat(risk): 决策引擎 v2',             author: '李雷 · 5 小时前' },
    ],
    detailStats: { worktrees: 1, linkedReqs: 1, disk: '48 MB', fetchText: '5 小时前' },
    repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '5 小时前',  ahead: 'synced'          },
    tags: [{ label: '风险决策引擎接入', tone: 'plain' }],
    date: '2026-07-08',
  },
  'coupon-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · 1 commit behind',                            path: '~/.aidevspace/repos/coupon-service',                             badgeTone: 'succ',  badgeText: '干净' },
      { branch: 'feature/coupon-stack',                 meta: '5 天前 · f6b2c93',                                    path: '~/.aidevspace/requirements/req-005-coupon/coupon-service',      reqLink: '优惠券叠加规则', badgeTone: 'warm',  badgeText: '5 文件 · +189' },
    ],
    commits: [
      { sha: 'f6b2c93', msg: 'feat(coupon): 叠加规则配置化',       author: '李雷 · 5 天前'   },
    ],
    detailStats: { worktrees: 2, linkedReqs: 1, disk: '72 MB', fetchText: '2 天前' },
    repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '2 天前',    ahead: '1 commit behind' },
    tags: [{ label: '优惠券叠加规则', tone: 'plain' }],
    date: '2026-07-07',
  },
  'cart-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/cart-service',                               badgeTone: 'succ',  badgeText: '干净' },
    ],
    commits: [
      { sha: '7d8e4a1', msg: 'feat(cart): 持久化 Redis',           author: '李雷 · 2 周前'   },
    ],
    detailStats: { worktrees: 1, linkedReqs: 1, disk: '38 MB', fetchText: '昨天' },
    repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '昨天',      ahead: 'synced'          },
    tags: [],
    date: '2026-07-08',
  },
  'seckill-service': {
    worktrees: [
      { branch: 'main',                                 meta: '主分支 · synced',                                     path: '~/.aidevspace/repos/seckill-service',                            badgeTone: 'succ',  badgeText: '干净' },
    ],
    commits: [
      { sha: '8e9f5b2', msg: 'chore: 压测报告归档',                author: '李雷 · 1 周前'   },
    ],
    detailStats: { worktrees: 1, linkedReqs: 1, disk: '54 MB', fetchText: '1 周前' },
    repoStats:   { worktrees: 1, linkedReqs: 1, fetchText: '1 周前',    ahead: 'synced'          },
    tags: [],
    date: '2026-07-05',
  },
};
