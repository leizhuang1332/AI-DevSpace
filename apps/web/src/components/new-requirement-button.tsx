'use client'

import { useUIOverlay } from './ui-overlay-store'

/**
 * 「+ 新建需求」按钮(issue 01 ticket 验收入口)
 *
 * 视觉对照 UI-POLISH-SPEC §10.1 / §10.2:
 * - 32px 高 × auto 宽,brand 主色 + 白字
 * - 位置:概览页 / 需求列表页 右上
 *
 * 触发:onClick → `useUIOverlay().openCmdN()` 弹出 NewRequirementModal
 * (UI-POLISH-SPEC §10.1)。也由 `⌘N` 全局快捷键 / Cmd+K 命令面板 /
 * `(workspace)/layout.tsx` keyboard-bridge 共享同一入口。
 *
 * 拆为独立 client 组件是因为父 page.tsx / requirements/page.tsx 是
 * server component,不能直接传函数 prop。
 */
export function NewRequirementButton() {
  const { open } = useUIOverlay()
  return (
    <button
      type="button"
      onClick={() => open('cmdN')}
      className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-50"
    >
      + 新建需求
    </button>
  )
}