/**
 * board section React Query hooks(issue 07 / ADR-0027)
 *
 * 3 个 hook:
 * - `useBoardCards(requirementId, filter, initialData?)` —— 列表查询
 *   queryKey `['board', requirementId, filter]`(对齐 issue spec)
 *   拉全量(active 卡),客户端按 `filterCardsByBoardFilter` 过滤(后端
 *   filter 不支持 mine / high-priority 语义)
 * - `useCreateBoardCard(requirementId)` —— manual 创建 mutation
 *   成功后 invalidate `['board', requirementId]` → 列重拉 + N 计数更新
 * - `useArchiveBoardCard(requirementId)` —— 卡片菜单 archive mutation
 *   成功后 invalidate `['board', requirementId]`
 *
 * 走 `agentFetch`(`@/lib/agent-client`),cookie 鉴权已封装。
 * 不触发 Run(守门 zero-touch,ADR-0023);manual 创建直接 POST 落盘。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BoardCardCreateRequest,
  BoardCardCreateResponse,
  BoardCardListResponse,
  TaskCard,
} from '@ai-devspace/shared'
import { agentFetch } from './agent-client'
import { filterCardsByBoardFilter, type BoardFilter, type BoardCardListData } from './board'

// ---------------------------------------------------------------------------
// 列表查询
// ---------------------------------------------------------------------------

/**
 * 拉 board 卡片列表 + 按 filter 过滤。
 *
 * - queryKey `['board', requirementId, filter]`(issue spec 要求 `['board', reqId, ...filters]`)
 * - queryFn 拉 GET /api/requirement/:id/board/cards(默认 include_archived=false,
 *   后端返活跃卡全集)→ 客户端按 `filterCardsByBoardFilter` 过滤
 * - `initialData`(SSR 注水):首次渲染不闪骨架,避免 hydration 闪烁
 * - staleTime 30s,refetchOnWindowFocus false(沿用 config-hooks 范式)
 *
 * 返回 `{ cards, total, ...queryState }`:
 * - `cards` = 过滤后的卡片(按 filter)
 * - `total` = 该 filter 命中的卡数(列头 N 计数用过滤后数据;全量 total 在
 *   `rawTotal`)
 * - `rawTotal` = 后端返的活跃卡总数(不受 filter 影响,toolbar 不显示但留 ref)
 */
export interface UseBoardCardsResult {
  cards: TaskCard[]
  /** filter 命中数(列头 N 用) */
  total: number
  /** 后端返的活跃卡总数(不受 filter 影响) */
  rawTotal: number
  isLoading: boolean
  isError: boolean
  error: unknown
}

export function useBoardCards(
  requirementId: string,
  filter: BoardFilter,
  initialData?: BoardCardListData,
): UseBoardCardsResult {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['board', requirementId, filter] as const,
    async queryFn() {
      const res = await agentFetch<BoardCardListResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards`,
      )
      return {
        requirementId,
        cards: Array.isArray(res.cards) ? (res.cards as TaskCard[]) : [],
        total: typeof res.total === 'number' ? res.total : 0,
      } satisfies BoardCardListData
    },
    // SSR 注水:filter='all' 时用 initialData(后端拉的就是全量);
    // 其他 filter 不注水(initialData 是全量,filter 后会与 queryFn 结果不一致,
    // 留给 queryFn 重拉后再过滤)。
    initialData:
      filter === 'all' && initialData ? initialData : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  // 客户端按 filter 过滤(query.data 是全量活跃卡)
  const allCards = query.data?.cards ?? []
  const filtered = filterCardsByBoardFilter(allCards, filter)
  void qc // useQueryClient 引用(预留给 manual invalidate 场景)

  return {
    cards: filtered,
    total: filtered.length,
    rawTotal: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

// ---------------------------------------------------------------------------
// manual 创建
// ---------------------------------------------------------------------------

/**
 * manual 创建卡片(POST /api/requirement/:id/board/cards)。
 *
 * 后端强制 `source='manual'` + `parent_id=reqId`(忽略客户端传入,防越权)。
 * 成功后 invalidate `['board', requirementId]` → 列重拉 + N 计数更新。
 *
 * 不触发 Run(守门 zero-touch)。
 */
export interface CreateBoardCardInput {
  title: string
  content?: string
  status?: TaskCard['status']
  priority?: TaskCard['priority'] | null
  assignee?: string | null
  labels?: string[]
}

export function useCreateBoardCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateBoardCardInput) => {
      const body: BoardCardCreateRequest = {
        title: input.title,
        content: input.content ?? '',
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
      }
      return agentFetch<BoardCardCreateResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )
    },
    onSuccess: () => {
      // invalidate 该 req 的所有 board query(覆盖 4 个 filter)
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}

// ---------------------------------------------------------------------------
// archive(卡片菜单)
// ---------------------------------------------------------------------------

/**
 * 软删卡片(POST /api/requirement/:id/board/cards/:cardId/archive)。
 *
 * 成功后 invalidate `['board', requirementId]` → 列重拉。
 */
export function useArchiveBoardCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (cardId: string) =>
      agentFetch<{ card: TaskCard }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/archive`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}
