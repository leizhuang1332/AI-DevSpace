/**
 * board section — server-only SSR 数据层(issue 07 / ADR-0027)
 *
 * 设计动机(对齐 `requirement-list.server.ts` 的 RSC fetch 范式):
 * - `board.ts` 只放 client-safe 内容(类型 + 纯函数 + 列色 token)
 * - 本文件专存 server-only IO:`getBoardData(reqId)` 走 agent HTTP 拉卡片列表
 * - 客户端 component 不应 import 本文件(避免 server IO 漏入 client bundle)
 *
 * RSC 内不走 `agentFetch`(无 document,无法 bootstrap cookie),而是直接 fetch
 * agent server + 手动传 Cookie header(从 `cookies()` helper 读),与
 * `requirement-list.server.ts` 同款范式(ticket 07b 决策 D1)。
 *
 * 与 analyzing/drafting 的 .server.ts 差异:
 * - analyzing / drafting 走 fs 直读 `requirement.md`(web 端可达的物理路径)
 * - board 卡片数据全在 agent 端 TaskCardStore(`~/.aidevspace/requirements/<id>/
 *   board/tasks/<ulid>.json`),web SSR 走 HTTP `GET /api/requirement/:id/board/cards`
 *
 * 容错(决策 30):agent 不可达 / 401(无 token cookie)/ 404 / 5xx →
 * `{ requirementId, cards: [], total: 0 }`,UI 走空态,不抛错阻塞 SSR。
 */

import { cookies } from 'next/headers'
import type {
  BoardCardListResponse,
  RequirementListResponse,
  RequirementSummary,
  TaskCard,
  TaskCardTranscript,
  TaskCardTranscriptResponse,
} from '@ai-devspace/shared'
import type { BoardCardListData } from './board'

/** server 端 agent base(env 不带 NEXT_PUBLIC_ 前缀,沿用 requirement-list.server.ts) */
const AGENT_BASE = process.env.AGENT_URL ?? 'http://localhost:7777'

/**
 * SSR 拉 board 卡片列表(活跃卡全集)。
 *
 * - 走 `GET /api/requirement/:id/board/cards`(默认 include_archived=false)
 * - 从 `cookies()` 读 `aidevspace_token` → 手动传 Cookie header(鉴权)
 * - `cache: 'no-store'` 防 RSC 永久缓存
 * - 成功 → `{ requirementId, cards, total }`
 * - 失败(agent 不可达 / 401 无 token / 404 / 5xx / 解析错)→
 *   `{ requirementId, cards: [], total: 0 }`,不阻塞 SSR
 *
 * 后端 Zod 校验在 route 层已做(BoardCardListResponseSchema 不强制运行时校验
 * 这里 —— 与 requirement-list.server.ts 一致,信任 agent 端 schema 校验)。
 */
export async function getBoardData(
  requirementId: string,
): Promise<BoardCardListData> {
  try {
    const token = cookies().get('aidevspace_token')?.value
    const headers: Record<string, string> = {}
    if (token) {
      headers.Cookie = `aidevspace_token=${token}`
    }
    // 无 token 仍发请求 —— agent 端会返 401,本函数 catch 后降级空态;
    // 不在 SSR 抛错(用户未 bootstrap 时 board 走空态,客户端 bootstrap 后
    // React Query 会自动重拉)

    const res = await fetch(
      `${AGENT_BASE}/api/requirement/${encodeURIComponent(requirementId)}/board/cards`,
      { headers, cache: 'no-store' },
    )
    if (!res.ok) {
      return { requirementId, cards: [], total: 0 }
    }
    const raw = (await res.json()) as BoardCardListResponse
    return {
      requirementId,
      cards: Array.isArray(raw.cards) ? (raw.cards as TaskCard[]) : [],
      total: typeof raw.total === 'number' ? raw.total : 0,
    }
  } catch {
    // agent 不可达 / fetch 抛错 → 空态(决策 30 容错)
    return { requirementId, cards: [], total: 0 }
  }
}

// ---------------------------------------------------------------------------
// 卡片详情页 SSR(issue 08 / ADR-0027 D5 + ADR-0028 D5)
// ---------------------------------------------------------------------------

/**
 * SSR 拉单卡详情。失败 → null(不阻塞 SSR,客户端 React Query 兜底重拉)。
 *
 * card 不存在 → null(让 page.tsx 走 notFound())。
 */
export async function getCardDetail(
  requirementId: string,
  cardId: string,
): Promise<TaskCard | null> {
  try {
    const token = cookies().get('aidevspace_token')?.value
    const headers: Record<string, string> = {}
    if (token) {
      headers.Cookie = `aidevspace_token=${token}`
    }
    const res = await fetch(
      `${AGENT_BASE}/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}`,
      { headers, cache: 'no-store' },
    )
    if (!res.ok) return null
    const raw = (await res.json()) as { card?: TaskCard }
    return raw.card ?? null
  } catch {
    return null
  }
}

/**
 * SSR 拉 TaskCard transcript。失败 → null(UI 走空态,客户端 React Query 重拉)。
 */
export async function getCardTranscriptInitial(
  requirementId: string,
  cardId: string,
): Promise<TaskCardTranscript | null> {
  try {
    const token = cookies().get('aidevspace_token')?.value
    const headers: Record<string, string> = {}
    if (token) {
      headers.Cookie = `aidevspace_token=${token}`
    }
    const res = await fetch(
      `${AGENT_BASE}/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/transcript`,
      { headers, cache: 'no-store' },
    )
    if (!res.ok) return null
    const raw = (await res.json()) as TaskCardTranscriptResponse
    return raw.transcript ?? null
  } catch {
    return null
  }
}

/**
 * SSR 拉父 Requirement summary(走 list 端点 + find,因 detail 端点不含 status)。
 *
 * 容错降级:agent 不可达 / 找不到 → null(UI crumb 走 reqId 兜底)。
 */
export async function getRequirementSummaryForBoard(
  requirementId: string,
): Promise<RequirementSummary | null> {
  try {
    const token = cookies().get('aidevspace_token')?.value
    const headers: Record<string, string> = {}
    if (token) {
      headers.Cookie = `aidevspace_token=${token}`
    }
    const res = await fetch(`${AGENT_BASE}/api/requirements`, {
      headers,
      cache: 'no-store',
    })
    if (!res.ok) return null
    const raw = (await res.json()) as RequirementListResponse
    return raw.requirements.find((r) => r.id === requirementId) ?? null
  } catch {
    return null
  }
}

/**
 * SSR 拉全卡列表(子任务/依赖派生用)。复用 getBoardData 的 fetch 范式。
 * 失败 → 空数组(不阻塞 SSR)。
 */
export async function getBoardCardsForDetail(
  requirementId: string,
): Promise<TaskCard[]> {
  const data = await getBoardData(requirementId)
  return data.cards
}
