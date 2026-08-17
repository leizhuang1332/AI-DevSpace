/**
 * board section React Query hooks(issue 07 / ADR-0027)
 *
 * 5 个 hook:
 * - `useBoardCards(requirementId, filter, initialData?)` —— 列表查询
 *   queryKey `['board', requirementId, filter]`(对齐 issue spec)
 *   拉全量(active 卡),客户端按 `filterCardsByBoardFilter` 过滤(后端
 *   filter 不支持 mine / high-priority 语义)
 * - `useCreateBoardCard(requirementId)` —— manual 创建 mutation
 *   成功后 invalidate `['board', requirementId]` → 列重拉 + N 计数更新
 * - `useArchiveBoardCard(requirementId)` —— 卡片菜单 archive mutation
 *   成功后 invalidate `['board', requirementId]`
 * - `useMoveCardToColumn(requirementId)` —— 跨列拖(issue 19 / ADR-0035 D1+D5)
 *   悲观(等 Guard),status 改后再 order_index;冲突 = 返 conflicts, caller 弹 Modal
 * - `useReorderCard(requirementId)` —— 列内重排(issue 19 / ADR-0035 D1+D5)
 *   乐观(立即视觉成功),失败还原 cache + 抛错让 caller 弹 Toast
 *
 * 走 `agentFetch`(`@/lib/agent-client`),cookie 鉴权已封装。
 * 不触发 Run(守门 zero-touch,ADR-0023);manual 创建直接 POST 落盘。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BoardCardBlockers,
  BoardCardCreateRequest,
  BoardCardCreateResponse,
  BoardCardListResponse,
  TaskCard,
  TaskCardStatusT,
} from '@ai-devspace/shared'
import { AgentError, agentFetch } from './agent-client'
import { filterCardsByBoardFilter, type BoardFilter, type BoardCardListData } from './board'
import type { UpdateCardStatusResponse } from './board-detail-hooks'

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
 *
 * 注:ADR-0036 D7 后,board UI 不再触发 `archive`;后端路径保留供 snapshot /
 * CLI 工具调用。本 hook 保留以便未来"已归档抽屉"等功能(ADR-0036 D7 不在范围内)。
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

// ---------------------------------------------------------------------------
// delete(物理删除,issue 03 / ADR-0036)
// ---------------------------------------------------------------------------

/**
 * useDeleteBoardCard —— 物理删除卡片(ADR-0036 D1)
 *
 * **契约:只 throw,不 Toast**(陷阱 3)。错误由 caller 路由:
 * - `error.code === 'E_CARD_HAS_BLOCKERS'` + `error.blockers` 非空 → 弹 BlockerModal
 * - `error.code === 'E_CARD_NOT_FOUND'` → silent(已删,本地缓存由 onSuccess invalidate 重刷)
 * - 其他 → `pushToast(message, 'err')`
 *
 * 结构化错误对象(throw 出去的 Error 上挂载的字段):
 * - `code: string` —— 后端 `error` 字段,例如 `E_CARD_HAS_BLOCKERS` / `E_CARD_NOT_FOUND`
 * - `reason: string` —— 后端 `reason` 字段,例如 `card-has-blockers`
 * - `blockers: BoardCardBlockers | undefined` —— 仅 409 时存在(子任务 / 依赖方)
 * - `httpStatus: number` —— 后端 HTTP 状态
 * - `message: string` —— 后端 `message` 字段或本地 fallback
 */
export interface DeleteBoardCardError extends Error {
  code: string
  reason: string
  blockers?: BoardCardBlockers
  httpStatus: number
}

export function useDeleteBoardCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (cardId: string): Promise<{ deleted: boolean; id: string }> => {
      try {
        return await agentFetch<{ deleted: boolean; id: string }>(
          `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}`,
          { method: 'DELETE' },
        )
      } catch (err) {
        if (err instanceof AgentError) {
          const body = (err.body ?? {}) as {
            error?: string
            reason?: string
            message?: string
            blockers?: BoardCardBlockers
          }
          const code = body.error ?? 'E_INTERNAL'
          const reason = body.reason ?? 'internal'
          const message = body.message ?? err.message
          const structured: DeleteBoardCardError = Object.assign(new Error(message), {
            code,
            reason,
            blockers: body.blockers,
            httpStatus: err.status,
          })
          throw structured
        }
        throw err
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
      void qc.invalidateQueries({ queryKey: ['board-card', requirementId] })
    },
  })
}

// ---------------------------------------------------------------------------
// 拖拽 mutation(issue 19 / ADR-0035 D1 + D5)
// ---------------------------------------------------------------------------

/**
 * 跨列拖(改 status + order_index)—— 走「先 status 后 order_index」二段式。
 *
 * 调度策略(ADR-0035 D5):**悲观**等 Guard;冲突 = 返 `UpdateCardStatusResponse`
 * `{ ok: false, conflicts }` 给 caller 弹 `StatusConstraintModal`,不调 order_index。
 *
 * 链路:
 * 1. `PATCH /board/cards/:cardId/status` body `{ status, override: false }`
 * 2. `ok:false` → 直接 return statusRes,caller 弹 Modal
 * 3. `ok:true` → `PATCH /board/cards/:cardId` body `{ order_index }`
 * 4. 任意一段 throw(network / 500) → mutation error, caller 弹 Toast
 *
 * `onSuccess` 仅在 `ok:true` 时 invalidate(`ok:false` 没落盘,缓存不变)。
 */
export interface MoveCardToColumnInput {
  cardId: string
  toStatus: TaskCardStatusT
  /** 目标列内落位 order_index;undefined 跳过 order_index PATCH(仅改 status) */
  toOrderIndex?: number | null
  /**
   * 用户在 Modal 里选 A「强制 override」时传 true,后续 PATCH order_index 阶段不受 Guard 影响
   * (order_index 字段白名单 PATCH 不走 Guard,但 override 透传到 PATCH /status)
   */
  override?: boolean
}

export function useMoveCardToColumn(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: MoveCardToColumnInput): Promise<UpdateCardStatusResponse> => {
      // 1. 改 status(走 Guard)
      const statusRes = await agentFetch<UpdateCardStatusResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(input.cardId)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: input.toStatus,
            override: input.override ?? false,
          }),
        },
      )
      // 2. 冲突 → 不调 order_index,直接返回 statusRes(让 caller 弹 Modal)
      if (!statusRes.ok) return statusRes
      // 3. ok:true → 改 order_index(乐观)
      if (input.toOrderIndex !== undefined && input.toOrderIndex !== null) {
        await agentFetch<{ card: TaskCard }>(
          `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(input.cardId)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ order_index: input.toOrderIndex }),
          },
        )
      }
      return statusRes
    },
    onSuccess: (data, vars) => {
      // ok:false → 没落盘,缓存不变;ok:true → invalidate
      if (!data.ok) return
      void qc.invalidateQueries({ queryKey: ['board-card', requirementId, vars.cardId] })
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}

/**
 * 列内重排(仅改 order_index)—— 乐观(立即视觉成功)。
 *
 * 调度策略(ADR-0035 D5):**乐观**(`onMutate` 改 queryCache),失败(`onError`)
 * 还原 `previousData` + throw,让 caller 弹 Toast 提示「排序保存失败,已回滚」。
 *
 * 乐观更新范围 = `['board', reqId, ...filters]` 全部子键(filter 切换后也能 hit)。
 *
 * 注:不走 SSR 注水缓存(只走 `['board', reqId, filter]` 树,`['board', reqId, 'detail']`
 * 平级不同前缀,本函数跳过 —— 详情页修 status 后会自己 invalidate)。
 */
export interface ReorderCardInput {
  cardId: string
  newOrderIndex: number
  /** 目标列 status(只改 order_index 不改 status);caller 必传 */
  toStatus: TaskCardStatusT
}

/**
 * 内部辅助:在所有 `['board', reqId, ...]` 子树 queryData 上做 order_index 替换。
 * 替换函数 = 把目标卡片挪到目标 status 列内,确保局部乐观更新视图一致。
 */
function applyOptimisticReorder(
  data: BoardCardListData | undefined,
  input: ReorderCardInput,
): BoardCardListData | undefined {
  if (!data) return data
  const nextCards = data.cards.map((c) =>
    c.id === input.cardId
      ? { ...c, status: input.toStatus, order_index: input.newOrderIndex }
      : c,
  )
  return { ...data, cards: nextCards }
}

export function useReorderCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ReorderCardInput): Promise<{ card: TaskCard }> => {
      return agentFetch<{ card: TaskCard }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(input.cardId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ order_index: input.newOrderIndex }),
        },
      )
    },
    // 乐观:把目标卡片在新 order_index 写入所有 ['board', reqId, ...] 子树缓存
    onMutate: async (input) => {
      const queries = qc.getQueryCache().findAll({
        queryKey: ['board', requirementId],
      })
      const previousData = new Map<readonly unknown[], BoardCardListData>()
      for (const q of queries) {
        const data = q.state.data as BoardCardListData | undefined
        if (!data) continue
        previousData.set(q.queryKey, data)
        qc.setQueryData(q.queryKey, applyOptimisticReorder(data, input))
      }
      return { previousData }
    },
    // 失败:还原 + 抛错(让 caller 弹 Toast)
    onError: (_err, _input, ctx) => {
      const context = ctx as { previousData: Map<readonly unknown[], BoardCardListData> } | undefined
      if (!context) return
      for (const [key, data] of context.previousData) {
        qc.setQueryData(key, data)
      }
    },
    // 终态:invalidate 兜底,确保服务端真相最终一致
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
      void qc.invalidateQueries({ queryKey: ['board-card', requirementId, vars.cardId] })
    },
  })
}
