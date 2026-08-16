/**
 * board section 拖拽排序算法 — issue 19 / ADR-0035 D2
 *
 * 浮点中位法 + 列排序 + 列内位置计算:
 * - `computeOrderIndex(prev, next)` —— 前后卡中位,精度耗尽抛 E_INDEX_PRECISION_EXHAUSTED
 * - `computeOrderIndexForHead(first)` —— `first / 2`(等差数列)
 * - `computeOrderIndexForTail(last)` —— `last + 1`(等差 1)
 * - `computeOrderIndexForEmptyColumn()` —— `1`(空列起始)
 * - `sortByOrderIndex(cards)` —— `order_index asc, null last, updated_at desc`
 * - `rankInColumn(card, columnCards)` —— `1..N` 序号(给 Detail 页只读行用)
 *
 * 设计要点:
 * - 纯函数,无 IO / 无 React 依赖,agent / web 两端可共用(`packages/shared/src/index.ts` 导出)
 * - 精度耗尽阈值 = `1e-6`;触发时浮点中位接近 0,前一次拖拽产生的中间值失去了可区分度
 * - null 排序规则 = 列尾追加(ADR-0024 D5 字段默认语义);不留 null,不留 undefined
 * - 调用方(BoardSection / TaskCardStore 等)负责把 `null` 卡片先 sort 后传入 `computeOrderIndexForHead/ForTail`
 *
 * 关联:
 * - ADR-0024 D1 字段集(13 字段含 `order_index`)
 * - ADR-0027 D3 「拖拽(本期不做,留 P1+)」延期项解锁
 * - ADR-0035 D2 浮点中位法
 */

import type { TaskCard } from './task-card.js'

// ---------------------------------------------------------------------------
// 精度常量
// ---------------------------------------------------------------------------

/**
 * 浮点中位法精度耗尽阈值(JS Number 双精度 ≈ 1e-15,留 9 阶余量)。
 *
 * 前后两卡 `order_index` 之差 < 1e-6 → 中位值接近 0,前后失去可区分度。
 * 此时调用方应触发整列批量重排(参考 ADR-0035 D2「精度耗尽」)。
 */
export const INDEX_PRECISION_EXHAUSTED = 1e-6

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** 浮点中位法精度耗尽时抛错;调用方决定批量重排 vs 提示用户。 */
export class IndexPrecisionExhaustedError extends Error {
  constructor(
    message: string,
    /** 触发耗尽时的前卡 order_index */
    public readonly prev: number,
    /** 触发耗尽时的后卡 order_index */
    public readonly next: number,
  ) {
    super(message)
    this.name = 'IndexPrecisionExhaustedError'
  }
}

// ---------------------------------------------------------------------------
// 计算工具
// ---------------------------------------------------------------------------

/**
 * 拖到前卡 `[prev]` 和后卡 `[next]` 之间 → `(prev + next) / 2`。
 *
 * @throws {RangeError} prev > next(数据错乱)
 * @throws {IndexPrecisionExhaustedError} 前后差 < `INDEX_PRECISION_EXHAUSTED`
 */
export function computeOrderIndex(prev: number, next: number): number {
  if (prev > next) {
    throw new RangeError(
      `computeOrderIndex: prev (${prev}) must be <= next (${next})`,
    )
  }
  if (next - prev < INDEX_PRECISION_EXHAUSTED) {
    throw new IndexPrecisionExhaustedError(
      `order_index precision exhausted: prev=${prev}, next=${next} (gap < ${INDEX_PRECISION_EXHAUSTED})`,
      prev,
      next,
    )
  }
  return (prev + next) / 2
}

/**
 * 拖到列头 = 与首个卡取中点 = `first / 2`。
 *
 * 入参约定:首卡已 sort 后(非 null)才传进来;若首卡为 null,先 `sortByOrderIndex` 去掉 null。
 * 输入合法性: `first > 0`(0 意味着没卡,应走 `computeOrderIndexForEmptyColumn`)。
 */
export function computeOrderIndexForHead(first: number): number {
  if (first <= 0) {
    throw new RangeError(
      `computeOrderIndexForHead: first (${first}) must be > 0; for empty column use computeOrderIndexForEmptyColumn`,
    )
  }
  return first / 2
}

/**
 * 拖到列尾 = `last + 1`(等差 1)。
 *
 * 入参约定:尾卡已 sort 后(非 null)才传进来;尾卡为 null 时等同空列。
 * 输入合法性: `last > 0`(列尾追加 = 后于最大已排序卡)。
 */
export function computeOrderIndexForTail(last: number): number {
  if (last <= 0) {
    throw new RangeError(
      `computeOrderIndexForTail: last (${last}) must be > 0; for empty column use computeOrderIndexForEmptyColumn`,
    )
  }
  return last + 1
}

/**
 * 空列 = 起始 `1`。
 *
 * 空列首次落卡,后续卡 `order_index = 1, 2, 3, ...`(沿用 `computeOrderIndexForTail`)。
 */
export function computeOrderIndexForEmptyColumn(): number {
  return 1
}

// ---------------------------------------------------------------------------
// 排序
// ---------------------------------------------------------------------------

/**
 * 列内排序 = `order_index asc, null last, updated_at desc`。
 *
 * - 主键 `order_index` 升序;null 视为 `+Infinity`(列尾)
 * - 同 order_index 时按 `updated_at` 降序(与 `TaskCardStore.list` 行为一致)
 * - 纯函数,不修改入参
 */
export function sortByOrderIndex<T extends Pick<TaskCard, 'order_index' | 'updated_at'>>(
  cards: T[],
): T[] {
  return [...cards].sort((a, b) => {
    const aInf = a.order_index === null ? Number.POSITIVE_INFINITY : a.order_index
    const bInf = b.order_index === null ? Number.POSITIVE_INFINITY : b.order_index
    if (aInf !== bInf) return aInf - bInf
    if (a.updated_at < b.updated_at) return 1
    if (a.updated_at > b.updated_at) return -1
    return 0
  })
}

// ---------------------------------------------------------------------------
// 位置(rank)
// ---------------------------------------------------------------------------

/**
 * 在列内找到 `card` 的 1-indexed 序号(给 Detail 页右栏「列内位置 #N / M」用)。
 *
 * - 不要求 `card` 属 `columnCards` 列(调用方负责传入同一 `status` 的全集)
 * - 返回 `-1` 表示未找到(理论不应发生,防御用)
 */
export function rankInColumn(
  card: TaskCard,
  columnCards: TaskCard[],
): number {
  const sorted = sortByOrderIndex(columnCards)
  const idx = sorted.findIndex((c) => c.id === card.id)
  return idx === -1 ? -1 : idx + 1
}
