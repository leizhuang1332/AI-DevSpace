/**
 * board 详情页 React Query hooks(issue 08 / ADR-0027 D5 + ADR-0028 D5)
 *
 * 详情页专用 hooks(与 board-hooks.ts 的看板列表 hooks 分离,避免 queryKey 冲突):
 * - `useBoardCardDetail(reqId, cardId, initialCard?)` —— 单卡查询
 * - `useBoardCardsForDetail(reqId, initialCards?)` —— 全卡列表(子任务/依赖派生)
 * - `useParentRequirement(reqId, initialSummary?)` —— 父 req summary(status + title)
 * - `useUpdateCardStatus(reqId)` —— PATCH /cards/:cardId/status,返 raw response
 *   (board.ts `ok:false` 走 200 不 throw,caller 判弹 Modal)
 * - `usePatchBoardCard(reqId)` —— PATCH /cards/:cardId(非 status 字段)
 * - `useCardTranscript(reqId, cardId)` —— GET transcript
 * - `useSendTranscriptMessage(reqId, cardId)` —— POST .../transcript/messages
 * - `useStartPrdSplit(reqId)` —— POST /split-from-prd(fire-and-forget)
 * - `usePrdSplitRunDetail(reqId, runId, enabled)` —— GET /runs/:runId(轮询)
 * - `usePrdSplitRuns(reqId)` —— GET /runs(列表,board 顶 banner 来源)
 * - `useLandPrdSplitCard(reqId)` —— POST /board/cards(source=prd_split)
 *
 * 走 `agentFetch`(`@/lib/agent-client`),cookie 鉴权已封装。
 * 不触发 Run(守门 zero-touch,ADR-0023);transcript 仅描述 / 不挂 Run(ADR-0028 D2)。
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BoardCardCreateResponse,
  BoardCardListResponse,
  PrdSplitRunDetailResponse,
  PrdSplitRunListResponse,
  PrdSplitStartResponse,
  RequirementListResponse,
  RequirementSummary,
  TaskCard,
  TaskCardTranscript,
  TaskCardTranscriptResponse,
  TranscriptMessageCreateBody,
  TranscriptMessageCreateResponse,
} from '@ai-devspace/shared'
import { agentFetch } from './agent-client'

// ---------------------------------------------------------------------------
// 单卡 / 全卡 / 父 req
// ---------------------------------------------------------------------------

/** PATCH /cards/:cardId/status 的 raw 响应(可能 ok:false 带 conflicts)。 */
export type UpdateCardStatusResponse =
  | { ok: true; card: TaskCard; override_applied: boolean }
  | { ok: false; conflicts: unknown[]; parent_status: string }

export interface UseBoardCardDetailResult {
  card: TaskCard | null
  isLoading: boolean
  isError: boolean
  error: unknown
}

export function useBoardCardDetail(
  requirementId: string,
  cardId: string,
  initialCard?: TaskCard | null,
): UseBoardCardDetailResult {
  const query = useQuery({
    queryKey: ['board-card', requirementId, cardId] as const,
    async queryFn() {
      const res = await agentFetch<{ card: TaskCard }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}`,
      )
      return res.card
    },
    initialData: initialCard ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  return {
    card: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  }
}

export function useBoardCardsForDetail(
  requirementId: string,
  initialCards?: TaskCard[],
): { cards: TaskCard[]; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: ['board', requirementId, 'detail'] as const,
    async queryFn() {
      const res = await agentFetch<BoardCardListResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards`,
      )
      return {
        cards: Array.isArray(res.cards) ? (res.cards as TaskCard[]) : [],
        total: typeof res.total === 'number' ? res.total : 0,
      }
    },
    initialData: initialCards
      ? { cards: initialCards, total: initialCards.length }
      : undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  return {
    cards: query.data?.cards ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

export function useParentRequirement(
  requirementId: string,
  initialSummary?: RequirementSummary | null,
): { summary: RequirementSummary | null; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: ['requirement', requirementId] as const,
    async queryFn() {
      const res = await agentFetch<RequirementListResponse>(
        `/api/requirements`,
      )
      const found = res.requirements.find((r) => r.id === requirementId)
      return found ?? null
    },
    initialData: initialSummary ?? undefined,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

// ---------------------------------------------------------------------------
// status 变更(走 Guard)+ 通用字段 PATCH
// ---------------------------------------------------------------------------

export interface UpdateCardStatusInput {
  cardId: string
  status: TaskCard['status']
  override?: boolean
}

/**
 * PATCH /cards/:cardId/status。
 *
 * **不抛错** —— board.ts 的 `{ok:false, conflicts}` 走 200,本 hook 原样返回
 * raw response,让 caller 判断是否弹 StatusConstraintModal。
 * 成功(ok:true)后 invalidate `['board-card', reqId, cardId]` + `['board', reqId]`。
 */
export function useUpdateCardStatus(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateCardStatusInput): Promise<UpdateCardStatusResponse> => {
      return agentFetch<UpdateCardStatusResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(input.cardId)}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: input.status,
            override: input.override ?? false,
          }),
        },
      )
    },
    onSuccess: (_data, vars) => {
      // 只在 ok:true 时 invalidate(ok:false 没落盘,缓存不变)
      void qc.invalidateQueries({ queryKey: ['board-card', requirementId, vars.cardId] })
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}

export interface PatchBoardCardInput {
  cardId: string
  patch: Record<string, unknown>
}

/** PATCH /cards/:cardId(非 status 字段:priority/assignee/labels/title/content)。 */
export function usePatchBoardCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PatchBoardCardInput) =>
      agentFetch<{ card: TaskCard }>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(input.cardId)}`,
        { method: 'PATCH', body: JSON.stringify(input.patch) },
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['board-card', requirementId, vars.cardId] })
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}

// ---------------------------------------------------------------------------
// transcript(ADR-0028 D5)
// ---------------------------------------------------------------------------

export function useCardTranscript(
  requirementId: string,
  cardId: string,
  initialTranscript?: TaskCardTranscript | null,
): { transcript: TaskCardTranscript | null; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: ['board-card-transcript', requirementId, cardId] as const,
    async queryFn() {
      const res = await agentFetch<TaskCardTranscriptResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/transcript`,
      )
      return res.transcript
    },
    initialData: initialTranscript ?? undefined,
    // staleTime 0:发消息后立即重拉,保证最新消息流
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  return {
    transcript: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

export interface SendTranscriptMessageInput {
  content: string
  refs?: TranscriptMessageCreateBody['refs']
}

/**
 * POST .../transcript/messages。
 *
 * 守门(ADR-0028 D2):只发 user 消息(role 由路由强制 user,caller 不传)。
 * 成功后 invalidate transcript query → 消息流重拉。
 */
export function useSendTranscriptMessage(
  requirementId: string,
  cardId: string,
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SendTranscriptMessageInput) =>
      agentFetch<TranscriptMessageCreateResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards/${encodeURIComponent(cardId)}/transcript/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: input.content,
            refs: input.refs ?? [],
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: ['board-card-transcript', requirementId, cardId],
      })
    },
  })
}

// ---------------------------------------------------------------------------
// PRD 拆解(issue 05 / ADR-0027 D4)
// ---------------------------------------------------------------------------

export interface StartPrdSplitInput {
  granularity: '粗' | '中' | '细'
  expected_count: number
  use_context: string[]
}

/** POST /split-from-prd(fire-and-forget 201 {run_id, status:'running'})。 */
export function useStartPrdSplit(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: StartPrdSplitInput) =>
      agentFetch<PrdSplitStartResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/split-from-prd`,
        { method: 'POST', body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prd-split-runs', requirementId] })
    },
  })
}

/**
 * GET /runs/:runId(轮询:status==='running' 时每 1.5s 重拉)。
 *
 * 设计预期(sse.ts:357):prd_split_created → web 切 loading → 轮询 GET /runs/:runId。
 * enabled=false 时不发请求(未启动 split 时省一次 fetch)。
 */
export function usePrdSplitRunDetail(
  requirementId: string,
  runId: string | null,
  enabled = true,
): { detail: PrdSplitRunDetailResponse | null; isLoading: boolean; isError: boolean } {
  const query = useQuery({
    queryKey: ['prd-split-run', requirementId, runId] as const,
    enabled: enabled && runId !== null,
    async queryFn() {
      return agentFetch<PrdSplitRunDetailResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/split-from-prd/runs/${encodeURIComponent(runId!)}`,
      )
    },
    // status==='running' 时每 1.5s 轮询;终态后停止
    refetchInterval: (q) =>
      q.state.data?.run?.status === 'running' ? 1500 : false,
    refetchOnWindowFocus: false,
  })
  return {
    detail: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

/** GET /runs(列表,board 顶「建议卡片组」按钮来源)。 */
export function usePrdSplitRuns(requirementId: string) {
  const query = useQuery({
    queryKey: ['prd-split-runs', requirementId] as const,
    async queryFn() {
      return agentFetch<PrdSplitRunListResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/split-from-prd/runs`,
      )
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  return {
    runs: query.data?.runs ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}

export interface LandPrdSplitCardInput {
  title: string
  content?: string
  priority?: TaskCard['priority'] | null
  labels?: string[]
}

/**
 * 把 PRD 拆候选落盘为 TaskCard(source=prd_split)。
 *
 * 单步:POST /board/cards body 含 `source:'prd_split'`(issue 08 schema 扩展后
 * 后端透传,TaskCardStore.create 默认 manual 但接受显式 prd_split)。
 * 成功后 invalidate `['board', reqId]` → 看板列重拉。
 */
export function useLandPrdSplitCard(requirementId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LandPrdSplitCardInput) =>
      agentFetch<BoardCardCreateResponse>(
        `/api/requirement/${encodeURIComponent(requirementId)}/board/cards`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: input.title,
            content: input.content ?? '',
            source: 'prd_split',
            priority: input.priority ?? null,
            labels: input.labels ?? [],
            status: 'backlog',
          }),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['board', requirementId] })
    },
  })
}
