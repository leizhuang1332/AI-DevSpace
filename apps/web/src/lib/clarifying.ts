/**
 * CLARIFYING 工位数据层(ADR-0011 §6 CLARIFYING 布局 · issue 20)
 *
 * Q&A 形态(对应原型 11b-stage-adaptive-clarifying.html):
 * - 主区全宽:当前提问焦点 + 候选答案 + 历史澄清(无资源树 / 无 Inline 栏)
 * - 当前提问焦点:AI 问题正文 + 关联上下文链接(指向 ANALYZING 工位的产物)
 * - 候选答案:2-4 个候选按钮 + 自定义回答输入框
 * - 历史澄清:按时间倒序(最新最上),可折叠,可"回到那一步"触发 AI 重新思考
 *
 * 设计原则(沿用 ANALYZING/DRAFTING/EXECUTING):
 * - 纯函数 + 类型化,便于单元测试
 * - 空数据兜底:未知 id → empty=true,UI 渲染引导去 DRAFTING
 * - 数据由 server 注入,组件本身纯渲染或纯客户端交互
 * - 当前提问与历史派生:progress.current = history.done.length + 1
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 澄清问题上下文链接 — 指向 ANALYZING 工位的产物 */
export interface ClarifyingContextLink {
  /** 链接文本(短,如 "design/02-api.md:15-23") */
  label: string
  /** 链接 URL(锚到具体行号,或跳转到 ANALYZING 工位的某条 chunk) */
  href: string
}

/** 候选答案按钮 */
export interface ClarifyingCandidateOption {
  id: string
  /** 按钮文案(2-4 个字符,如 "是,必须回滚" / "否,保留扣减") */
  label: string
  /** 视觉变体(yes=绿/no=红/neutral=灰),UI 决定边框 + 文本色 */
  variant: 'yes' | 'no' | 'neutral'
}

/** 当前 AI 提问(焦点卡) */
export interface ClarifyingCurrentQuestion {
  id: string
  /** 问题正文 */
  text: string
  /** 候选答案按钮(2-4 个) */
  candidates: ClarifyingCandidateOption[]
  /** 关联上下文链接(指向 ANALYZING 工位的产物,如 design/02-api.md:15-23) */
  contextLinks: ClarifyingContextLink[]
}

/** 历史澄清条目 */
export interface ClarifyingHistoryItem {
  id: string
  /** 问题 id(用于"回到那一步") */
  questionId: string
  /** 问题文案(短) */
  question: string
  /** 已答文本(没有则为空字符串) */
  answer: string
  /** 状态:done=已答 / doing=正在答(当前)/ blocked=阻塞(依赖 doing) */
  status: 'done' | 'doing' | 'blocked'
  /** 时间戳("14:23:01" 形式) */
  ts: string
  /**
   * 阻塞原因(仅 status='blocked' 时存在)。
   * 显式声明依赖关系,避免 UI 按 questionId 字符串硬猜依赖。
   */
  blockedReason?: {
    /** 阻塞于哪个 questionId(渲染为 "Q4" / "上一题") */
    dependsOn: string
  }
}

/** 进度(派生:history.done.length / total) */
export interface ClarifyingProgress {
  current: number
  total: number
  /** 0-100,UI 渲染进度条宽度 */
  pct: number
}

/** Toolbar(面包屑) */
export interface ClarifyingToolbarCrumb {
  label: string
  current?: boolean
}

export interface ClarifyingToolbar {
  crumb: ClarifyingToolbarCrumb[]
}

/** 顶部 Stage 条 */
export interface ClarifyingStage {
  badge: string
  title: string
  /** 右上 meta("Q4 / 5") */
  meta: string
}

/** 用户回答载荷(候选答案 / 自定义) */
export type ClarifyingAnswerPayload =
  | { kind: 'candidate'; questionId: string; optionId: string; label: string }
  | { kind: 'custom'; questionId: string; text: string }

/** "回到那一步"载荷 */
export interface ClarifyingBackPayload {
  questionId: string
}

/** CLARIFYING 工位顶层数据 */
export interface ClarifyingData {
  requirementId: string
  stage: ClarifyingStage
  toolbar: ClarifyingToolbar
  /** 当前 AI 提问;null = 全部问题已答完 */
  currentQuestion: ClarifyingCurrentQuestion | null
  history: ClarifyingHistoryItem[]
  progress: ClarifyingProgress
  /** 空数据(未知 id);UI 渲染引导去 DRAFTING */
  empty: boolean
}

// ---------------------------------------------------------------------------
// 纯函数:派生 progress
// ---------------------------------------------------------------------------

/**
 * 从 history 派生进度:
 * - current = done 条目数 + (当前 doing ? 1 : 0)
 * - total = history.length(若 history 为空 → 0)
 * - pct = total > 0 ? round(current / total * 100) : 0
 */
export function computeClarifyingProgress(
  history: readonly ClarifyingHistoryItem[],
): ClarifyingProgress {
  const total = history.length
  if (total === 0) return { current: 0, total: 0, pct: 0 }
  let current = 0
  for (const h of history) {
    if (h.status === 'done') current++
  }
  // current 题目正在 doing 状态时也算 1
  if (history.some((h) => h.status === 'doing')) current++
  const pct = Math.round((current / total) * 100)
  return { current, total, pct }
}

// ---------------------------------------------------------------------------
// 兜底数据(未知 id)
// ---------------------------------------------------------------------------

/**
 * 空状态 CLARIFYING 工位数据(未知 id / 新建需求)。
 * UI 渲染时若 data.empty === true → 走空态引导(去 DRAFTING 写 PRD)。
 */
export function emptyClarifying(requirementId: string): ClarifyingData {
  return {
    requirementId,
    stage: { badge: '③ 澄清', title: '', meta: '' },
    toolbar: { crumb: [] },
    currentQuestion: null,
    history: [],
    progress: { current: 0, total: 0, pct: 0 },
    empty: true,
  }
}

// ---------------------------------------------------------------------------
// Mock 数据源 — 对应原型 11b CLARIFYING(退款功能优化)
// 与 ANALYZING 工位的 5 个 subproblem 对应(issue 19 mock REFUND_ANALYZING_CHUNKS)
// ---------------------------------------------------------------------------

const REFUND_HISTORY: ClarifyingHistoryItem[] = [
  // q-1 ~ q-3 已答;q-4 doing(当前);q-5 blocked(依赖 q-4)
  {
    id: 'h-1',
    questionId: 'q-1',
    question: '退款单 ID 生成规则?',
    answer: '雪花算法',
    status: 'done',
    ts: '14:23:30',
  },
  {
    id: 'h-2',
    questionId: 'q-2',
    question: '退款审核流程?',
    answer: '自动审核 5s',
    status: 'done',
    ts: '14:24:05',
  },
  {
    id: 'h-3',
    questionId: 'q-3',
    question: '退款金额上限?',
    answer: '单笔 5000 元',
    status: 'done',
    ts: '14:24:42',
  },
  {
    id: 'h-4',
    questionId: 'q-4',
    question: '退款失败时是否要回滚已扣减的优惠券额度?',
    answer: '',
    status: 'doing',
    ts: '14:25:10',
  },
  {
    id: 'h-5',
    questionId: 'q-5',
    question: '退款幂等策略?',
    answer: '',
    status: 'blocked',
    ts: '',
    blockedReason: { dependsOn: 'q-4' },
  },
]

const REFUND_CURRENT_QUESTION: ClarifyingCurrentQuestion = {
  id: 'q-4',
  text: '退款失败时,是否要回滚已扣减的优惠券额度?',
  candidates: [
    {
      id: 'opt-yes',
      label: '✓ 是,必须回滚',
      variant: 'yes',
    },
    {
      id: 'opt-no',
      label: '✗ 否,保留扣减',
      variant: 'no',
    },
  ],
  contextLinks: [
    {
      label: 'design/02-api.md:15-23',
      href: '/requirements/req-001/analyzing#c-11',
    },
    {
      label: 'refund_flow 表结构',
      href: '/requirements/req-001/analyzing#c-3',
    },
  ],
}

const REFUND_CLARIFYING: Omit<ClarifyingData, 'requirementId' | 'progress'> = {
  empty: false,
  stage: {
    badge: '③ 澄清',
    title: 'CLARIFYING · Q&A 形态 · 一问一答对话推进器',
    meta: 'Q4 / 5',
  },
  toolbar: {
    crumb: [
      { label: '退款功能优化' },
      { label: '/' },
      { label: '分析' },
      { label: '/' },
      { label: '澄清对话', current: true },
    ],
  },
  currentQuestion: REFUND_CURRENT_QUESTION,
  history: REFUND_HISTORY,
}

/**
 * 拉取 CLARIFYING 工位数据(mock 期 —— 后续替换为 `await fetch(...)`)。
 *
 * - 已知 id(req-001) → REFUND_CLARIFYING 样例数据
 * - 未知 id / 新建需求 → emptyClarifying(id)
 *
 * 显式标注 async 是为后续接 agent API 时的接口稳定 —— 调用方可以无差异使用。
 */
export async function getClarifyingData(
  requirementId: string,
): Promise<ClarifyingData> {
  if (requirementId === 'req-001') {
    return {
      ...REFUND_CLARIFYING,
      requirementId,
      progress: computeClarifyingProgress(REFUND_HISTORY),
    }
  }
  return emptyClarifying(requirementId)
}
