import { notFound } from 'next/navigation'
import { SECTION_META } from '@/lib/sections'
import { ZoneShell } from '@/lib/zone-shell'
import {
  getCardDetail,
  getCardTranscriptInitial,
  getRequirementSummaryForBoard,
  getBoardCardsForDetail,
} from '@/lib/board.server'
import { BoardCardDetailPage } from '@/components/board/detail/BoardCardDetailPage'

/**
 * board 卡片详情页(issue 08 / ADR-0027 D5 + ADR-0028 D5)
 *
 * 路由:`/requirements/[id]/board/[cardId]/`(静态段,优先于 `[zone]` catch-all)
 *
 * SSR:并发拉 card + transcript + parent summary + 全卡列表(子任务/依赖派生);
 * 任一失败容错降级 null / [],不阻塞 SSR;card 不存在 → notFound()。
 *
 * 渲染 `<ZoneShell zone={SECTION_META.board}>` + `<BoardCardDetailPage initialData/>`。
 *
 * 守门(ADR-0023 zero-touch):SSR 走 agent HTTP(transcript / cards),
 * 不触达 Provider;transcript 仅描述 / 不挂 Run(ADR-0028 D2)。
 */

/**
 * 安全 decodeURIComponent:对已 decode / 不含 `%XX` 的串是 no-op;
 * 仅在 param 仍带 URL 编码时触发解码(沿用 [zone]/page.tsx safeDecode 范式)。
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export default async function BoardCardDetailPageRoute({
  params,
}: {
  params: { id: string; cardId: string }
}) {
  const requirementId = safeDecode(params.id)
  const cardId = safeDecode(params.cardId)

  // 并发拉 SSR 数据;任一失败容错降级
  const [card, transcript, parentSummary, cards] = await Promise.all([
    getCardDetail(requirementId, cardId),
    getCardTranscriptInitial(requirementId, cardId),
    getRequirementSummaryForBoard(requirementId),
    getBoardCardsForDetail(requirementId),
  ])

  // card 不存在 → 404
  if (!card) {
    notFound()
  }

  const zone = SECTION_META.board

  return (
    <ZoneShell id={requirementId} zone={zone}>
      <BoardCardDetailPage
        requirementId={requirementId}
        cardId={cardId}
        initialCard={card}
        initialCards={cards}
        initialTranscript={transcript}
        initialParentSummary={parentSummary}
      />
    </ZoneShell>
  )
}
