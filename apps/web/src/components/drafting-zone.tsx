'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUX_PANE_MIN_HEIGHT_PX,
  DEFAULT_PRD_RATIO,
  SPLIT_RESIZER_HEIGHT_PX,
  clampSplitRatio,
  type DraftingData,
} from '@/lib/drafting'
import { DraftingPrdPane } from './drafting-prd-pane'
import { AuxFilesPane } from './aux-files-pane'
import { DraggableDivider } from './draggable-divider'
import { AuxDrawer } from './aux-drawer'

/**
 * DRAFTING 工位组件(issue 02 + issue 04)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 *
 * 布局(issue 04 形态 —— PRD 顶置 + 拖拽分割 + 辅助文件网格):
 * ┌────────────────────────────────────────────────┐
 * │ Toolbar(面包屑 + 自动保存状态)                  │
 * ├────────────────────────────────────────────────┤
 * │ 主区:上下分割的 flex 列                         │
 * │  ┌────────────────────────────────────────┐    │
 * │  │ PRD 卡片(标题 + 编辑器)  [ratio ~60%]   │    │
 * │  ├────────────────────────────────────────┤    │
 * │  │ ‖ 拖拽分割条(6px)              ‖      │    │
 * │  ├────────────────────────────────────────┤    │
 * │  │ 辅助文件网格 + empty 占位  [1-ratio]   │    │
 * │  └────────────────────────────────────────┘    │
 * └────────────────────────────────────────────────┘
 * + 右侧 Inline 栏(由 ZoneShell 注入 DraftingSkillRail)
 *
 * 数据全部由 props 注入;交互逻辑委托给 DraftingPrdPane('use client')。
 * Inline 栏(候命 Skill)由 ZoneShell 通过 inlineRailSlot 注入 DraftingSkillRail。
 *
 * 设计要点(issue 04 引入):
 * - 上下比例用 ratio ∈ [0, 1] 描述 PRD 占比;默认 DEFAULT_PRD_RATIO = 0.6
 * - 拖拽分割条由 `DraggableDivider` 渲染;本组件提供 clientY → ratio 的换算
 *   + `clampSplitRatio` 保证 aux 始终 ≥ AUX_PANE_MIN_HEIGHT_PX(行卡片可视)
 * - 容器高度由 ref 实测;窗口 resize 时重测,以保证 clamp 永远反映当前布局
 *
 * 不在本组件范围(后续 ticket 引入):
 * - 新建/上传 → mock 转换(issue 06):占位 no-op
 * - 仓库底部条 + 软警告(issue 08)
 *
 * issue 05 已实现:
 * - 辅助文件点击 → 打开右侧 60% 抽屉(AuxDrawer)
 * - 抽屉宽度 60%(min 520 / max 880)+ 半透明 backdrop + Escape / ✕ / 点击遮罩关闭
 * - 抽屉内的编辑内容由父组件(DraftingZone)的 `auxBodies` 跨生命周期持久
 *   —— 关闭再开同一文件,内容不丢
 * - 单一抽屉:openAuxId 是 string | null;同时只能打开一个
 */

export function DraftingZone({ data }: { data: DraftingData }) {
  // -------------------------------------------------------------------------
  // 上下分割比例(issue 04)
  // -------------------------------------------------------------------------
  const [prdRatio, setPrdRatio] = useState<number>(DEFAULT_PRD_RATIO)

  // -------------------------------------------------------------------------
  // 辅助文件抽屉状态(issue 05)
  // - `openAuxId`:当前打开的 aux file id;null = 抽屉关闭
  //   单一抽屉语义:string | null 即可天然保证"同时只一个"
  //   切换文件由父组件直接 setOpenAuxId(新 id);AuxDrawer 接住后自动重置内容
  // - `auxBodies`:per-file 跨抽屉生命周期的编辑内容
  //   (打开 → 编辑 → 关闭 → 再打开,内容恢复)
  // -------------------------------------------------------------------------
  const [openAuxId, setOpenAuxId] = useState<string | null>(null)
  const [auxBodies, setAuxBodies] = useState<Record<string, string>>({})

  /** 受控回调 —— AuxDrawer 通知 body 变化 */
  const handleAuxBodyChange = useCallback((id: string, newBody: string) => {
    setAuxBodies((prev) => ({ ...prev, [id]: newBody }))
  }, [])

  /** 主区(split-row)DOM 引用,用于实测高度 + clamp 计算 */
  const splitContainerRef = useRef<HTMLDivElement | null>(null)

  /** 主区实测高度;0 表示尚未测量(SSR / 首次 render 之前) */
  const [containerHeight, setContainerHeight] = useState<number>(0)

  /** 拖拽起点信息;DraggableDivider 触发 onDragStart 时写入 */
  const dragStartRef = useRef<{ startClientY: number; startRatio: number } | null>(
    null,
  )

  // -------------------------------------------------------------------------
  // 监听窗口尺寸变化 → 重测容器高度 → 重算 clamp 后的 ratio
  // -------------------------------------------------------------------------
  useEffect(() => {
    const el = splitContainerRef.current
    if (!el) return

    const measure = () => {
      const h = el.getBoundingClientRect().height
      setContainerHeight(h)
    }

    measure()

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measure)
        : null
    if (observer) observer.observe(el)
    window.addEventListener('resize', measure)

    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // -------------------------------------------------------------------------
  // clamp 后的实际 ratio —— 用于渲染 flexGrow
  // -------------------------------------------------------------------------
  const effectiveRatio =
    containerHeight > 0 ? clampSplitRatio(prdRatio, containerHeight) : prdRatio

  // -------------------------------------------------------------------------
  // 拖拽事件 → ratio 增量
  // -------------------------------------------------------------------------
  const handleDragStart = useCallback(
    (startClientY: number) => {
      dragStartRef.current = {
        startClientY,
        startRatio: prdRatio,
      }
    },
    [prdRatio],
  )

  const handleDrag = useCallback((clientY: number) => {
    const el = splitContainerRef.current
    if (!el) return
    const containerH = el.getBoundingClientRect().height
    if (containerH <= 0) return

    setPrdRatio((prevRatio) => {
      const start = dragStartRef.current
      if (!start) {
        // 没有起点信息(理论上 DraggableDivider 应先调 onDragStart 再 move;
        // 这里是 belt-and-suspenders 兜底):用当前 clientY 当起点,delta=0。
        dragStartRef.current = {
          startClientY: clientY,
          startRatio: prevRatio,
        }
        return prevRatio
      }
      const deltaRatio = (clientY - start.startClientY) / containerH
      return start.startRatio + deltaRatio
    })
  }, [])

  const handleDragEnd = useCallback(() => {
    dragStartRef.current = null
  }, [])

  // 键盘事件 → ratio 增量(由父组件 clamp)
  const handleRatioChangeBy = useCallback((delta: number) => {
    setPrdRatio((prev) => prev + delta)
  }, [])

  // -------------------------------------------------------------------------
  // 辅助文件 / 新建点击(issue 05/06)
  // -------------------------------------------------------------------------
  const handleAuxOpen = useCallback((auxId: string) => {
    // issue 05:打开抽屉显示该 aux file
    // - 单一抽屉语义:如果点击另一张卡片,直接切换(无需手动 close)
    // - editedBodies 已经持久所有之前的编辑,切换不会丢
    setOpenAuxId(auxId)
  }, [])

  const handleAuxClose = useCallback(() => {
    setOpenAuxId(null)
  }, [])

  const handleAuxCreate = useCallback(() => {
    // issue 06:新建 / 上传 mock 转换;本期先 console.info 占位
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line no-console
      console.info('[drafting-aux] create')
    }
  }, [])

  // -------------------------------------------------------------------------
  // aria-valuemin / aria-valuemax 给 DraggableDivider 的 clamp 边界
  // -------------------------------------------------------------------------
  const minRatio =
    containerHeight > 0
      ? clampSplitRatio(0, containerHeight)
      : SPLIT_RESIZER_HEIGHT_PX / Math.max(1, containerHeight)
  const maxRatio =
    containerHeight > 0 ? clampSplitRatio(1, containerHeight) : 1

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  return (
    <main
      data-testid="drafting-zone"
      data-requirement-id={data.requirementId}
      data-empty={data.empty ? 'true' : 'false'}
      data-prd-ratio={String(prdRatio)}
      data-effective-prd-ratio={String(effectiveRatio)}
      className="flex flex-col h-full overflow-hidden bg-bg"
    >
      <DraftingToolbar toolbar={data.toolbar} />

      {/* 主区:上下分割的 flex 列(issue 04) */}
      <div
        data-testid="drafting-main"
        className="flex-1 overflow-hidden p-6 bg-bg"
      >
        <div className="max-w-[1080px] mx-auto h-full flex flex-col">
          <div
            ref={splitContainerRef}
            data-testid="drafting-split-row"
            className="flex flex-col h-full min-h-0"
          >
            {/* PRD 卡片 —— wrapper 控制 flexGrow,内部仍是 issue 02/03 布局 */}
            <div
              data-testid="drafting-prd-wrapper"
              data-flex-grow={String(effectiveRatio)}
              style={{ flexGrow: effectiveRatio, minHeight: 0 }}
              className="overflow-hidden"
            >
              <DraftingPrdPane data={data} />
            </div>

            {/* 拖拽分割条 —— 固定 6px 高 */}
            <DraggableDivider
              ratio={prdRatio}
              minRatio={minRatio}
              maxRatio={maxRatio}
              onDragClientY={handleDrag}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onRatioChangeBy={handleRatioChangeBy}
              ariaLabel="拖拽调整 PRD 与辅助文件的比例"
            />

            {/* 辅助文件面板 —— flexGrow = 1 - ratio(自动;不显式传,浏览器按剩余空间分配) */}
            <div
              data-testid="drafting-aux-wrapper"
              data-flex-grow={String(Math.max(0, 1 - effectiveRatio))}
              style={{ flexGrow: Math.max(0, 1 - effectiveRatio), minHeight: 0 }}
              className="overflow-hidden"
            >
              <AuxFilesPane
                auxFiles={data.auxFiles}
                onOpen={handleAuxOpen}
                onCreate={handleAuxCreate}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 辅助文件抽屉(issue 05) —— 用 portal 思路直接渲染在主元素末尾,
          固定定位 + 高 z-index 覆盖全屏。父组件(DraftingZone)持有:
          - 当前打开文件 id(openAuxId)
          - 跨生命周期编辑内容(auxBodies) */}
      <AuxDrawer
        openAuxId={openAuxId}
        auxFiles={data.auxFiles}
        auxBodies={auxBodies}
        onClose={handleAuxClose}
        onBodyChange={handleAuxBodyChange}
        autosaveIntervalMs={data.autosaveIntervalMs}
      />
    </main>
  )
}

// ============================================================================
// Toolbar
// ============================================================================

function DraftingToolbar({ toolbar }: { toolbar: DraftingData['toolbar'] }) {
  return (
    <div
      data-testid="drafting-toolbar"
      className="flex items-center justify-between px-6 py-2 border-b border-border bg-bg-elevated gap-3 h-11"
    >
      <nav
        data-testid="drafting-toolbar-crumb"
        aria-label="面包屑"
        className="flex items-center gap-1.5 text-sm text-text-3"
      >
        {toolbar.crumb.map((c, i) => (
          <span
            key={`${c.label}-${i}`}
            data-testid={
              c.current ? 'drafting-crumb-current' : 'drafting-crumb-item'
            }
            data-current={c.current ? 'true' : 'false'}
            className={
              c.current
                ? 'text-text-1 font-medium'
                : i % 2 === 1
                  ? 'text-text-3'
                  : 'text-text-2'
            }
          >
            {c.label}
          </span>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <span
          data-testid="drafting-toolbar-status"
          className="text-xs text-text-3"
        >
          {toolbar.statusText}
        </span>
      </div>
    </div>
  )
}