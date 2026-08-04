/**
 * 分析历史 FAB 控制器(analyzing-fab ticket 04 · ADR-0022 D5.2)
 *
 * 把 `<AnalyzingZone>` 内部的「浮动面板开合 state + 当前 requirementId +
 * Run 总数」暴露给上层(如 `<CommandPalette>`),让 Cmd+K 命令面板可以召
 * 唤浮动面板。
 *
 * 设计动机:
 * - `<CommandPalette>` 挂在 workspace 顶层,而 `<AnalyzingZone>` 在
 *   `(workspace)/requirements/[id]/[zone]/page.tsx` 深层渲染。两者不
 *   是父子关系。直接在 props 链上传不现实(有路由层级穿越)。
 * - 沿用项目内现有 UIOverlay 的「workspace 顶层 Context + 子组件 setValue」
 *   模式(参考 `components/ui-overlay-store.tsx`),不引入新 IPC / event
 *   bus / 路由层级 Provider。
 *
 * 不暴露:
 * - `open()` 的第二个参数(关闭 callback 等)—— ticket 04 只需要 `open`,
 *   预留扩展位。把 close 也暴露出来便于后续扩展(Cmd+K 关面板等)。
 *
 * 不持久化:
 * - 状态完全由当前 `<AnalyzingZone>` 渲染周期内的 `setController` 维护。
 *   AnalyzingZone unmount → setController(null) → CommandPalette 看到
 *   controller 为 null → 「🗂️ 历史分析」命令 disabled。
 */

'use client'

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * 当前可识别的浮动面板 key。预留多 panel 扩展位(analyzing-fab ticket 04
 * 只用 'historyFab');不绑新 IPC —— 各 panel 内部独立调自己的 state。
 */
export type AnalyzingFabPanel = 'historyFab'

export interface AnalyzingHistoryFabController {
  /** 当前 controller 绑定的 requirement id(让 CommandPalette 比对 pathname) */
  requirementId: string
  /** 历史 Run 总数,实时跟随 AnalyzingZone 内 runs.length */
  runCount: number
  /** 浮动面板当前是否打开 */
  isOpen: boolean
  /** 打开浮动面板 —— Cmd+K 「🗂️ 历史分析」action 闭包调用 */
  open: (panel: AnalyzingFabPanel) => void
  /** 关闭浮动面板 —— 本 ticket 不调用,预留多 panel / 后续召关能力 */
  close: (panel: AnalyzingFabPanel) => void
}

interface CtxValue {
  controller: AnalyzingHistoryFabController | null
  /**
   * 子组件(AnalyzingZone)调用以注册 / 更新 / 清空 controller。
   * 传 null 清空(组件 unmount 时)。
   */
  setController: (next: AnalyzingHistoryFabController | null) => void
}

const Ctx = createContext<CtxValue | null>(null)

/**
 * Provider 在 workspace layout 渲染(参考 `app/(workspace)/layout.tsx`),
 * 跨 CommandPalette + AnalyzingZone 共享。Controller value 由
 * AnalyzingZone 内部 useEffect 同步;CommandPalette 读 `controller` 渲染
 * 「🗂️ 历史分析」命令。
 */
export function AnalyzingHistoryFabControllerProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<AnalyzingHistoryFabController | null>(null)
  // useMemo 锁住 value 对象引用:只在 `controller` 实际变化时才生成新引用。
  // 之前每次 Provider render 都重建 value 对象,导致 `useContext(Ctx)` 在消费
  // 方每次都拿到新引用 —— 与 AnalyzingZone 的 controller 同步 effect 联用时,
  // 副作用(setController)反作用于自己会触发无限循环("Maximum update depth
  // exceeded")。
  const value = useMemo<CtxValue>(
    () => ({ controller, setController }),
    [controller],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * 全功能 hook —— AnalyzingZone 内部用。
 *
 * 读 controller 用于内部一致性校验(setController 是否被自己注册过);
 * setController 用于同步当前 zone 的 controller 值。
 */
export function useAnalyzingHistoryFabController(): CtxValue | null {
  return useContext(Ctx)
}

/**
 * 只读便利 hook —— CommandPalette 等消费方用。只暴露 `controller`,
 * 不暴露 `setController`(避免消费方误改造成 analyze zone 状态污染)。
 *
 * 消费方必须 null-check:`controller === null` 表示「当前没有正在提供
 * controller 的 AnalyzingZone」,此时命令 disabled。
 */
export function useAnalyzingHistoryFabControllerValue(): AnalyzingHistoryFabController | null {
  const ctx = useContext(Ctx)
  return ctx?.controller ?? null
}
