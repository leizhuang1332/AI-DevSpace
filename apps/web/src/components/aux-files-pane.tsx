'use client'

import type { AuxFile } from '@ai-devspace/shared'
import { AuxFileCard } from './aux-file-card'
import { EmptyAuxPlaceholder } from './empty-aux-placeholder'

/**
 * 辅助文件面板(issue 04 验收 #1 #2 #7)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.files-pane` 区域
 *
 * 布局:
 * ┌────────────────────────────────────────────────────┐
 * │ 📎 辅助材料 — N 个文件 · 全部为 md · 点击打开抽屉  │  ← pane head
 * ├────────────────────────────────────────────────────┤
 * │ ┌card┐ ┌card┐ ┌card┐ ┌card┐ ┌card┐                  │
 * │ └────┘ └────┘ └────┘ └────┘ └────┘  ← 卡片网格       │
 * └────────────────────────────────────────────────────┘
 *
 * 空态:auxFiles.length === 0 → 整个网格用 EmptyAuxPlaceholder 占位。
 *
 * 不在本组件范围:
 * - 抽屉打开(issue 05):通过 `onOpen` 回调交给上层
 * - 新建/上传(issue 06):通过 `onCreate` 回调交给上层
 * - 拖拽分割(issue 04 验收 #3):由 drafting-zone.tsx 的 DraggableDivider 负责
 */

export interface AuxFilesPaneProps {
  /** 辅助文件列表;空数组 → 显示虚线占位卡 */
  auxFiles: AuxFile[]
  /** 点击卡片回调 */
  onOpen?: (id: string) => void
  /** 点击占位卡回调(空态) */
  onCreate?: () => void
}

export function AuxFilesPane({ auxFiles, onOpen, onCreate }: AuxFilesPaneProps) {
  const isEmpty = auxFiles.length === 0

  // 头部副标题:仅在非空态显示文件统计
  const subTitle = isEmpty
    ? '— 0 个文件 · 上传或新建开始整理资料'
    : `— ${auxFiles.length} 个文件 · 全部为 md · 点击打开抽屉`

  return (
    <section
      data-testid="aux-files-pane"
      data-empty={isEmpty ? 'true' : 'false'}
      data-card-count={auxFiles.length}
      aria-label="辅助文件"
      className="flex flex-col gap-3 pt-2 min-h-0 h-full"
    >
      {/* 面板头 */}
      <header
        data-testid="aux-files-pane-head"
        className="flex items-center justify-between flex-shrink-0"
      >
        <div className="flex items-baseline gap-1 text-md font-bold">
          <span aria-hidden>📎</span>
          <span>辅助材料</span>
          <span
            data-testid="aux-files-pane-subtitle"
            className="text-xs text-text-3 font-normal ml-1.5"
          >
            {subTitle}
          </span>
        </div>
        {/* 后续 issue 06 接入"上传 / 新建"按钮组,本期先留空以保持视觉一致 */}
        <div
          data-testid="aux-files-pane-actions"
          className="flex items-center gap-1.5"
        >
          {/* placeholder for upload / create actions (issue 06) */}
        </div>
      </header>

      {/* 卡片网格 / 空态 */}
      {isEmpty ? (
        <div
          data-testid="aux-files-grid"
          className="grid gap-3 flex-1 min-h-0"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          <EmptyAuxPlaceholder onCreate={onCreate} />
        </div>
      ) : (
        <div
          data-testid="aux-files-grid"
          className="grid gap-3 flex-1 min-h-0 overflow-auto"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          }}
        >
          {auxFiles.map((aux) => (
            <AuxFileCard key={aux.id} aux={aux} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}