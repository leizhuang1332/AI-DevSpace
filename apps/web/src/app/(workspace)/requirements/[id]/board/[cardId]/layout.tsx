import type { ReactNode } from 'react'

/**
 * board 详情页 layout —— 直通,不做 notFound 守卫。
 *
 * 静态段 `board/` 优先于 `[zone]` catch-all(Next.js 路由优先级),
 * 所以 `/requirements/[id]/board/[cardId]` 不经 `[zone]/layout.tsx` 守卫。
 * board 已是合法 section path,无需再校验。
 *
 * 仅继承 `[id]/layout.tsx`(薄壳 passthrough,供未来 [id] 级 Provider 注入)。
 */
export default function BoardCardLayout({
  children,
}: {
  children: ReactNode
}) {
  return <>{children}</>
}
