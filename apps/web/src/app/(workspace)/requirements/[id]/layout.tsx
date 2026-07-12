import type { ReactNode } from 'react'

/**
 * /requirements/[id]/ 的 layout — ADR-0012 §4 之后:
 * - 不再默认渲染 ResourceTree / InlineRail(已下放给 [zone]/layout.tsx)
 * - 仅透传 children(settings / repos / artifacts / history / [zone]/ 各自负责自己的 UI)
 *
 * 保留此 layout 文件是为了:
 * 1. 给 [id]/* 下所有子路由(settings / repos / artifacts / history)共享一个最外层 wrapper
 * 2. 未来若需要 [id] 级 Provider(查询缓存、权限),在此处注入而不污染 workspace layout
 */
export default function RequirementIdLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}