/**
 * board section Web 端数据层 — client-safe 部分(issue 07 / ADR-0027)
 *
 * 本文件只放 client-safe 内容(类型 + 纯函数 + 列色 token):
 * - `BoardFilter` —— toolbar 4 chip(全部 / 我的 / 高优先级 / PRD 拆)
 * - `BoardCardListData` —— SSR 初始数据契约(对齐后端 GET /board/cards 响应)
 * - `shortCardId` —— ULID 末 4 位(ADR-0027 D3 `<ulid>.slice(-4)`)
 * - `summarizeContent` —— content 摘要(首 N 字,对齐 ADR-0027 D3)
 * - `filterCardsByBoardFilter` —— 客户端按 4 chip 过滤(后端 filter 不支持
 *   mine / high-priority,web 端做)
 * - `STATUS_COLUMNS` —— 5 列元数据(对照 `board-color-options.html` 方案 A)
 * - `PRIORITY_BADGE` —— 优先级 badge 配色(对照 HTML `:89-93`)
 * - `SOURCE_LABEL` —— source 中文小标(PRD 拆 / 子拆 / 手动)
 *
 * server-only IO(fs 直读 / agent HTTP)在 `board.server.ts`;
 * React Query hooks 在 `board-hooks.ts`。
 */

import type { TaskCard, TaskCardStatusT, TaskCardPriorityT, TaskCardSourceT } from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 过滤器(toolbar 4 chip)
// ---------------------------------------------------------------------------

/**
 * board toolbar 4 个 filter chip(ADR-0027 D3 + PRD Round 2 UI 决议):
 * - `all` —— 全部(不过滤)
 * - `mine` —— 我的(assignee === currentUserId)
 * - `high-priority` —— 高优先级(priority = high | urgent)
 * - `prd-split` —— PRD 拆(source = prd_split)
 *
 * 后端 GET /board/cards 的 query filter 只支持单 status/priority/source/label,
 * 不支持 mine / high-priority 语义 → web 端拉全量后客户端过滤。
 */
export type BoardFilter = 'all' | 'mine' | 'high-priority' | 'prd-split'

/** toolbar 4 chip 顺序(对照 `board-color-options.html` filter-chips) */
export const BOARD_FILTERS: readonly BoardFilter[] = [
  'all',
  'mine',
  'high-priority',
  'prd-split',
] as const

/** filter chip 中文标签(toolbar 显示) */
export const BOARD_FILTER_LABEL: Record<BoardFilter, string> = {
  all: '全部',
  mine: '我的',
  'high-priority': '高优先级',
  'prd-split': 'PRD 拆',
}

// ---------------------------------------------------------------------------
// SSR 数据契约
// ---------------------------------------------------------------------------

/**
 * board SSR 初始数据(对齐后端 `BoardCardListResponse`):
 * `{ requirementId, cards, total }`。SSR 拉全量(后端默认 include_archived=false),
 * 客户端按 filter 再过滤。total = 活跃卡总数(未含 archived)。
 */
export interface BoardCardListData {
  requirementId: string
  cards: TaskCard[]
  total: number
}

// ---------------------------------------------------------------------------
// 纯函数
// ---------------------------------------------------------------------------

/**
 * 取 ULID 末 4 位作显示短 ID(ADR-0027 D3)。
 *
 * - 26 字符 ULID → 末 4(如 `...HFKX9` → `FKX9`)
 * - 短于 4 字符 → 原样返回
 * - 空串 → 空串(不抛错)
 */
export function shortCardId(id: string): string {
  if (id.length <= 4) return id
  return id.slice(-4)
}

/**
 * 取 content 首 N 字作摘要(ADR-0027 D3「content 首 80 字」)。
 *
 * - 默认 max=80(对齐 D3)
 * - 换行折叠为单空格(摘要单行展示)
 * - trim 前后空白
 * - 空 content → ''
 */
export function summarizeContent(content: string, max = 80): string {
  const collapsed = content.replace(/\r?\n/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max)
}

/**
 * 按 toolbar filter 过滤卡片(客户端过滤,后端不支持 mine / high-priority)。
 *
 * - `all` —— 不过滤(返新数组,不改原)
 * - `mine` —— assignee === currentUserId(currentUserId 为 undefined/null → 返空)
 * - `high-priority` —— priority = high | urgent
 * - `prd-split` —— source = prd_split
 *
 * 返回新数组,不修改入参。
 */
export function filterCardsByBoardFilter(
  cards: readonly TaskCard[],
  filter: BoardFilter,
  currentUserId?: string | null,
): TaskCard[] {
  switch (filter) {
    case 'all':
      return cards.filter(() => true)
    case 'mine':
      if (!currentUserId) return []
      return cards.filter((c) => c.assignee === currentUserId)
    case 'high-priority':
      return cards.filter((c) => c.priority === 'high' || c.priority === 'urgent')
    case 'prd-split':
      return cards.filter((c) => c.source === 'prd_split')
  }
}

// ---------------------------------------------------------------------------
// 5 列元数据(对照 board-color-options.html 方案 A)
// ---------------------------------------------------------------------------

/** 单列配色 + 文案 token(对照 `board-color-options.html` scheme-a) */
export interface StatusColumnMeta {
  /** 列名(英文,首字母大写) */
  label: string
  /** 列名中文(显示用,a11y) */
  displayName: string
  /** status dot 填充色(hex) */
  dotColor: string
  /** 列名文字色(hex) */
  nameColor: string
  /** 列背景 tint(hex + alpha,如 `#94a3b80d`) */
  bgColor: string
  /** dot 是否空心(todo 列空心,对照方案 A `.col-status.td{border:1.5px solid}`) */
  dotHollow: boolean
}

/**
 * 5 列 status 顺序(backlog → todo → in_progress → in_review → done)。
 * 与 TaskCardStatus 枚举对齐;BOARD section 渲染按此顺序遍历。
 */
export const STATUS_COLUMN_ORDER: readonly TaskCardStatusT[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
] as const

/**
 * 5 列元数据,严格对照 `docs/design/pages/board-color-options.html` 方案 A:
 * - backlog:灰 #94a3b8 实心
 * - todo:灰 #cbd5e1 空心
 * - in_progress:黄 #f59e0b
 * - in_review:绿 #16a34a
 * - done:蓝 #3b82f6
 *
 * 列背景 tint = `<dotColor>0d`(~5% alpha,对照 HTML `.col-bg` 规则)。
 */
export const STATUS_COLUMNS: Record<TaskCardStatusT, StatusColumnMeta> = {
  backlog: {
    label: 'Backlog',
    displayName: '积压',
    dotColor: '#94a3b8',
    nameColor: '#475569',
    bgColor: '#94a3b80d',
    dotHollow: false,
  },
  todo: {
    label: 'Todo',
    displayName: '待办',
    dotColor: '#cbd5e1',
    nameColor: '#64748b',
    bgColor: '#cbd5e10d',
    dotHollow: true,
  },
  in_progress: {
    label: 'In Progress',
    displayName: '进行中',
    dotColor: '#f59e0b',
    nameColor: '#b45309',
    bgColor: '#f59e0b0d',
    dotHollow: false,
  },
  in_review: {
    label: 'In Review',
    displayName: '评审中',
    dotColor: '#16a34a',
    nameColor: '#15803d',
    bgColor: '#16a34a0d',
    dotHollow: false,
  },
  done: {
    label: 'Done',
    displayName: '完成',
    dotColor: '#3b82f6',
    nameColor: '#1d4ed8',
    bgColor: '#3b82f60d',
    dotHollow: false,
  },
}

// ---------------------------------------------------------------------------
// 优先级 badge 配色(对照 HTML :89-93)
// ---------------------------------------------------------------------------

/** 优先级 badge 配色 + 英文 label(对照 `board-color-options.html` .priority 规则) */
export interface PriorityBadgeMeta {
  /** badge 背景色 */
  bg: string
  /** badge 文字色 */
  text: string
  /** 英文 label(显示) */
  label: string
}

/**
 * 4 档优先级 badge 配色,对照 HTML `:89-93`:
 * - urgent #fee2e2/#991b1b
 * - high #ffedd5/#9a3412
 * - medium #fef3c7/#92400e
 * - low #dbeafe/#1e40af
 *
 * `null`(无优先级)走 UI 层灰态(bg-subtle/text-3),不在此 map。
 */
export const PRIORITY_BADGE: Record<Exclude<TaskCardPriorityT, never>, PriorityBadgeMeta> = {
  urgent: { bg: '#fee2e2', text: '#991b1b', label: 'Urgent' },
  high: { bg: '#ffedd5', text: '#9a3412', label: 'High' },
  medium: { bg: '#fef3c7', text: '#92400e', label: 'Medium' },
  low: { bg: '#dbeafe', text: '#1e40af', label: 'Low' },
}

// ---------------------------------------------------------------------------
// source 中文小标
// ---------------------------------------------------------------------------

/**
 * source → 中文小标(对照 `board-color-options.html` 卡片 .source 文案)。
 * - prd_split → PRD 拆
 * - sub_split → 子拆
 * - manual → 手动
 */
export const SOURCE_LABEL: Record<TaskCardSourceT, string> = {
  prd_split: 'PRD 拆',
  sub_split: '子拆',
  manual: '手动',
}

/**
 * assignee 头像首字母(取 assignee 前 2 字符大写;无 assignee → placeholder '+')。
 *
 * 本期 assignee 是自由字符串(user id),无真实 user 表 → 简单取首 2 字符。
 * 未来接入 user service 后改为查 display name 首字母。
 */
export function assigneeInitial(assignee: string | null): string {
  if (!assignee || assignee.length === 0) return '+'
  return assignee.slice(0, 2).toUpperCase()
}
