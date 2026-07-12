/**
 * EXECUTING 工位数据层(ADR-0011 §6 EXECUTING 布局 · issue 17 样板)
 *
 * 三列 Mission Control 形态:
 * - 左列 DAG:任务列表 + 4 状态 stats(done / doing / wait / todo)
 * - 中列 Diff:文件级 diff,每行 +/- / ctx
 * - 右列 AI 行为流:tool call 事件(时间戳 + 动作 + 描述)
 *
 * 数据来源:mock 期(对应原型 [11d-stage-adaptive-implementing.html]
 * 的 "退款功能优化 IMPLEMENTING" 样例)。
 *
 * 后续接 agent API 时只需替换 getExecutingData 函数体,调用方无差异。
 *
 * 设计原则:
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:空 DAG / 空 Diff / 空 AI 流 → UI 渲染空态引导
 * - toolbar / stage 等"装配数据"也在这里聚合,组件只负责渲染
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type DagTaskStatus = 'done' | 'doing' | 'wait' | 'todo'

export interface DagTask {
  id: string
  title: string
  status: DagTaskStatus
  /** 当前 doing 任务的迭代次数(如 "第 2 次迭代");非 doing 时可空 */
  iteration?: string
  /** doing 时的子状态描述(如 "边界条件处理");done 时可空 */
  sub?: string
  /** 任务详情跳转 href(若有任务详情路由;无则不显示为链接) */
  href?: string
}

export interface DagBlock {
  title: string
  meta: string
  tasks: DagTask[]
}

export interface DagData {
  block: DagBlock
  tasks: DagTask[]
}

// ---------------------------------------------------------------------------

export type DiffLineKind = 'add' | 'rem' | 'ctx'

export interface DiffLine {
  /** 行号(显示用);context 行可省略 */
  gutter?: number
  /** 行内容;add/rem 行带前缀符号(+ / -)由 UI 渲染时加 */
  content: string
  kind: DiffLineKind
}

export interface DiffFile {
  path: string
  icon: string
  added: number
  removed: number
  /** "deleted" 等附加标记 */
  badge?: string
  lines: DiffLine[]
}

export interface DiffData {
  /** "全部 / 修改 / 新增 / 删除" 顶部筛选项的可见性(由 UI 渲染) */
  files: DiffFile[]
  /** 累计 +N / -M 文本;UI 显示在列头 */
  cumulativeText: string
}

// ---------------------------------------------------------------------------

export type AIEventTone = 'info' | 'success' | 'warn' | 'err'

export type AIEventKind =
  | 'ask' // AI 提问等用户回答
  | 'edit' // Edit 文件
  | 'bash' // Bash 命令(测试 / 构建)
  | 'think' // AI 思考
  | 'artifact' // 产物采纳
  | 'state' // 状态变更
  | 'design' // 候选方案

export interface AIEvent {
  id: string
  ts: string // 形如 "14:24"
  tag: string // 形如 "PAUSED" / "DONE" / "STATE"
  icon: string
  action: string
  /** tone 决定左侧 3px border 颜色 */
  tone: AIEventTone
  /** 主描述(如 "✓ 14 tests passed") */
  desc?: string
  /** stats 文案(如 "+18 + / -7 -") */
  stats?: { added: number; removed: number }
  /** 子级操作按钮文案(可选,UI 渲染为 mini-btn) */
  acts?: string[]
}

// ---------------------------------------------------------------------------

/** 顶部 toolbar 数据 */
export interface ToolbarCrumb {
  label: string
  current?: boolean
}

export interface ToolbarAction {
  label: string
  /** 决定按钮样式(btn / btn-secondary / btn-danger / btn-ghost) */
  variant: 'primary' | 'secondary' | 'danger' | 'ghost'
}

export interface ToolbarData {
  crumb: ToolbarCrumb[]
  actions: ToolbarAction[]
}

/** Stage strip 顶部状态条 */
export interface StageData {
  /** 形如 "④ 编码" */
  badge: string
  /** 形如 "IMPLEMENTING · Mission Control 形态" */
  title: string
  /** 形如 "7/14 tasks" */
  metaLeft: string
  /** 形如 "60% 完成" */
  metaCenter: string
  /** 形如 "⏸ 1 阻塞" */
  metaRight: string
}

// ---------------------------------------------------------------------------

export interface ExecutingData {
  requirementId: string
  stage: StageData
  toolbar: ToolbarData
  dag: DagData
  diff: DiffData
  aiEvents: AIEvent[]
  /** 空数据(无产物 / 新建需求)→ UI 渲染空态引导 */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 工具函数(纯函数,被组件复用)
// ---------------------------------------------------------------------------

export interface DagStats {
  done: number
  doing: number
  wait: number
  todo: number
  total: number
  /** 0-100,基于 done / total,total=0 时为 0 */
  percent: number
}

/**
 * 聚合 DAG 任务的 4 状态数字 + 完成率。
 * 暴露为纯函数以便组件渲染前预计算,测试也能独立验证。
 */
export function summarizeDagStats(tasks: readonly DagTask[]): DagStats {
  let done = 0
  let doing = 0
  let wait = 0
  let todo = 0
  for (const t of tasks) {
    if (t.status === 'done') done++
    else if (t.status === 'doing') doing++
    else if (t.status === 'wait') wait++
    else todo++
  }
  const total = tasks.length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return { done, doing, wait, todo, total, percent }
}

// ---------------------------------------------------------------------------
// 空数据(新建需求 / 未知 id)
// ---------------------------------------------------------------------------

const EMPTY_STAGE: StageData = {
  badge: '',
  title: '',
  metaLeft: '',
  metaCenter: '',
  metaRight: '',
}

const EMPTY_TOOLBAR: ToolbarData = {
  crumb: [],
  actions: [],
}

const EMPTY_DIFF: DiffData = {
  files: [],
  cumulativeText: '',
}

const EMPTY_DAG: DagData = {
  block: { title: '', meta: '', tasks: [] },
  tasks: [],
}

/**
 * 空状态 EXECUTING 工位数据。
 * 组件渲染时若 data.empty === true → 走空态引导(去 DRAFTING 写 PRD)。
 */
export function emptyExecuting(requirementId: string): ExecutingData {
  return {
    requirementId,
    stage: { ...EMPTY_STAGE },
    toolbar: { ...EMPTY_TOOLBAR, crumb: [], actions: [] },
    dag: {
      block: { ...EMPTY_DAG.block, tasks: [] },
      tasks: [],
    },
    diff: { ...EMPTY_DIFF, files: [] },
    aiEvents: [],
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 [11d-stage-adaptive-implementing.html]
// ---------------------------------------------------------------------------

const REFUND_EXECUTING: Omit<ExecutingData, 'requirementId'> = {
  empty: false,
  stage: {
    badge: '⑤ 编码',
    title: 'IMPLEMENTING · Mission Control 形态',
    metaLeft: '7/14 tasks',
    metaCenter: '60% 完成',
    metaRight: '⏸ 1 阻塞',
  },
  toolbar: {
    crumb: [
      { label: '退款功能优化' },
      { label: '/' },
      { label: '编码' },
      { label: '/' },
      { label: 'Mission Control', current: true },
    ],
    actions: [
      { label: '⏸ 暂停 AI', variant: 'secondary' },
      { label: '⚙️ 设置', variant: 'secondary' },
      { label: '⏹ 中止', variant: 'danger' },
    ],
  },
  dag: {
    block: {
      title: '任务 DAG',
      meta: '7/14 · 4 done · 1 doing · 1 wait · 1 todo',
      tasks: [],
    },
    tasks: [
      { id: '#1', title: 'schema 迁移', status: 'done', href: '?task=T-1' },
      { id: '#2', title: 'Service 骨架', status: 'done', href: '?task=T-2' },
      { id: '#7', title: '退款查询接口', status: 'doing', iteration: '第 2 次迭代', sub: '边界条件处理', href: '?task=T-7' },
      { id: '#8', title: '单元测试', status: 'wait', href: '?task=T-8' },
      { id: '#9', title: '集成测试', status: 'todo', href: '?task=T-9' },
    ],
  },
  diff: {
    cumulativeText: 'Diff 流 · 累计 +18 / -7',
    files: [
      {
        path: 'refund-service/src/main/java/com/acme/refund/RefundController.java',
        icon: '🌿',
        added: 18,
        removed: 7,
        lines: [
          { gutter: 12, content: 'package com.acme.refund;', kind: 'ctx' },
          { gutter: 13, content: 'import org.springframework.web.bind.annotation.*;', kind: 'ctx' },
          { gutter: 14, content: 'import javax.validation.Valid;', kind: 'ctx' },
          { gutter: 15, content: 'import com.acme.common.api.Result;', kind: 'add' },
          { gutter: 16, content: '', kind: 'ctx' },
          { gutter: 17, content: '@RestController', kind: 'ctx' },
          { gutter: 18, content: '@RequestMapping("/api/refunds")', kind: 'ctx' },
          { gutter: 19, content: 'public class RefundController {', kind: 'ctx' },
          { gutter: 20, content: '  @Autowired', kind: 'rem' },
          { gutter: 21, content: '  private RefundService refundService;', kind: 'rem' },
          { gutter: 20, content: '  private final RefundService refundService;', kind: 'add' },
          { gutter: 22, content: '', kind: 'ctx' },
          { gutter: 23, content: '  /**', kind: 'ctx' },
          { gutter: 24, content: '   * 查询单笔退款', kind: 'ctx' },
          { gutter: 25, content: '   */', kind: 'ctx' },
          { gutter: 26, content: '  @GetMapping("/{refundId}")', kind: 'add' },
          { gutter: 27, content: '  public Result<RefundDTO> getRefund(', kind: 'add' },
          { gutter: 28, content: '      @PathVariable Long refundId) {', kind: 'add' },
          { gutter: 29, content: '    RefundDTO refund = refundService.findById(refundId);', kind: 'add' },
          { gutter: 30, content: '    return Result.success(refund);', kind: 'add' },
          { gutter: 31, content: '  }', kind: 'add' },
          { gutter: 32, content: '', kind: 'ctx' },
          { gutter: 33, content: '  /**', kind: 'ctx' },
          { gutter: 34, content: '   * 分页查询用户退款列表', kind: 'ctx' },
          { gutter: 35, content: '   */', kind: 'ctx' },
          { gutter: 36, content: '  @GetMapping', kind: 'add' },
          { gutter: 37, content: '  public Result<Page<RefundDTO>> listRefunds(', kind: 'add' },
          { gutter: 38, content: '      @RequestParam Long userId,', kind: 'add' },
          { gutter: 39, content: '      @RequestParam(defaultValue = "1") int page,', kind: 'add' },
          { gutter: 40, content: '      @RequestParam(defaultValue = "20") int size) {', kind: 'add' },
          { gutter: 41, content: '    return Result.success(refundService.listByUser(userId, page, size));', kind: 'add' },
          { gutter: 42, content: '  }', kind: 'add' },
          { gutter: 43, content: '}', kind: 'ctx' },
        ],
      },
      {
        path: 'refund-service/src/test/java/com/acme/refund/RefundControllerTest.java',
        icon: '🧪',
        added: 12,
        removed: 0,
        lines: [
          { gutter: 1, content: 'package com.acme.refund;', kind: 'ctx' },
          { gutter: 5, content: '@WebMvcTest(RefundController.class)', kind: 'add' },
          { gutter: 6, content: 'class RefundControllerTest {', kind: 'add' },
          { gutter: 12, content: '  void shouldReturnRefundById() { /* ... */ }', kind: 'add' },
          { gutter: 18, content: '  void shouldReturn404WhenNotFound() { /* ... */ }', kind: 'add' },
          { gutter: 22, content: '  ...', kind: 'ctx' },
        ],
      },
      {
        path: 'refund-service/src/test/java/com/acme/refund/OldServiceTest.java',
        icon: '🧪',
        added: 0,
        removed: 7,
        badge: 'deleted',
        lines: [
          { gutter: 1, content: 'package com.acme.refund;', kind: 'rem' },
          { gutter: 2, content: '// 已废弃 - 改为 RefundControllerTest', kind: 'rem' },
          { gutter: 3, content: '...', kind: 'rem' },
        ],
      },
    ],
  },
  aiEvents: [
    {
      id: 'ai-1',
      ts: '14:24',
      tag: 'PAUSED',
      icon: '💬',
      action: 'AI 提问 · 等 Q3 错误码决策',
      tone: 'warn',
      desc: '错误码用 400 还是业务异常? · design/02-api.md:15-23',
      acts: ['⌘K 回答', '↶ 回滚'],
    },
    {
      id: 'ai-2',
      ts: '14:23',
      tag: 'DONE',
      icon: '✏️',
      action: 'Edit RefundController.java',
      tone: 'info',
      stats: { added: 18, removed: 7 },
      acts: ['📄 看完整 Diff', '↶ 回滚本次'],
    },
    {
      id: 'ai-3',
      ts: '14:23',
      tag: 'DONE',
      icon: '⚡',
      action: 'Bash test · mvn test -Dtest=RefundController',
      tone: 'success',
      desc: '✓ 14 tests passed · 0 failed · 1.2s',
    },
    {
      id: 'ai-4',
      ts: '14:22',
      tag: 'DONE',
      icon: '🧠',
      action: 'AI Thinking · 分析 Task #7 边界条件',
      tone: 'info',
      desc: '检测到 RefundController 需要处理: 订单不存在 / 状态非法 / 金额超限 · AI 决定增加 3 个异常处理器',
    },
    {
      id: 'ai-5',
      ts: '14:20',
      tag: 'DONE',
      icon: '📦',
      action: '产物已采纳 · refund-api.yaml v3',
      tone: 'success',
      desc: 'design-stage 完成 · 采纳 B 方案(异步多阶段)',
    },
    {
      id: 'ai-6',
      ts: '14:18',
      tag: 'STATE',
      icon: '🔄',
      action: '状态变更 · DESIGNING → IMPLEMENTING',
      tone: 'info',
      desc: 'Task #7 启动 · 7 个子任务已拆解 · 第 2 次迭代',
    },
    {
      id: 'ai-7',
      ts: '14:00',
      tag: 'DONE',
      icon: '🎨',
      action: '生成候选方案 A/B/C · 采纳 A',
      tone: 'info',
    },
  ],
}

/**
 * 拉取 EXECUTING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001) → REFUND_EXECUTING 样例数据
 * - 未知 id / 新建需求 → emptyExecuting(id)
 *
 * 显式标注为 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getExecutingData(
  requirementId: string,
): Promise<ExecutingData> {
  if (requirementId === 'req-001') {
    return { ...REFUND_EXECUTING, requirementId }
  }
  return emptyExecuting(requirementId)
}