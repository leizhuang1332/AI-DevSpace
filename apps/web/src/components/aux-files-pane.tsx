'use client'

import { useRef } from 'react'
import type { AuxFile } from '@ai-devspace/shared'
import { AuxFileCard } from './aux-file-card'
import { EmptyAuxPlaceholder } from './empty-aux-placeholder'

/**
 * 辅助文件面板(issue 04 + issue 06)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.files-pane` 区域
 *
 * 布局:
 * ┌────────────────────────────────────────────────────┐
 * │ 📎 辅助材料 — N 个文件 · 全部为 md   [📁 上传][＋ 新建]│  ← pane head(issue 06)
 * ├────────────────────────────────────────────────────┤
 * │ ┌card┐ ┌card┐ ┌card┐ ┌card┐ ┌card┐                  │
 * │ └────┘ └────┘ └────┘ └────┘ └────┘  ← 卡片网格       │
 * └────────────────────────────────────────────────────┘
 *
 * 空态:auxFiles.length === 0 → 整个网格用 EmptyAuxPlaceholder 占位。
 *
 * 不在本组件范围:
 * - 抽屉打开(issue 05):通过 `onOpen` 回调交给上层
 * - 新建(issue 06):点击头部 `＋ 新建` → `onCreate()`;由上层弹出文件名 + tag 对话框
 * - 上传(issue 06):点击头部 `📁 上传` → 打开隐藏 <input type="file">;
 *   支持 `.md` / `.docx` / `.pdf`,选择文件后调用 `onUpload(file)`
 * - 拖拽分割(issue 04):由 drafting-zone.tsx 的 DraggableDivider 负责
 *
 * 文件输入的 accept 字段聚焦于 mock 转换器已支持的扩展名;.docx/.pdf 进入上层
 * 后通过 `mockConvertToMarkdown` 派生 deterministic Markdown,`.md` 跳过转换。
 */

export interface AuxFilesPaneProps {
  /** 辅助文件列表;空数组 → 显示虚线占位卡 */
  auxFiles: AuxFile[]
  /** 点击卡片回调 */
  onOpen?: (id: string) => void
  /** 点击占位卡(空态)回调 */
  onCreate?: () => void
  /**
   * 头部 `＋ 新建` 按钮回调;不传则按钮 disabled(桌位容许只读场景)。
   * 后续会弹出文件名 + usage_tag 对话框。
   */
  onCreateClick?: () => void
  /**
   * 用户选择了上传文件后回调;接收一个浏览器 File 对象。
   * 类型 / 后缀校验由上层负责(mock 转换器只接 .md / .docx / .pdf)。
   */
  onUpload?: (file: File) => void
}

// 仅 mockConvertToMarkdown 支持的扩展名(issue 01 验收 #6)
const UPLOAD_ACCEPT = '.md,.docx,.pdf'

export function AuxFilesPane({
  auxFiles,
  onOpen,
  onCreate,
  onCreateClick,
  onUpload,
}: AuxFilesPaneProps) {
  const isEmpty = auxFiles.length === 0
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 头部副标题:仅在非空态显示文件统计
  const subTitle = isEmpty
    ? '— 0 个文件 · 上传或新建开始整理资料'
    : `— ${auxFiles.length} 个文件 · 全部为 md · 点击打开抽屉`

  // 计算混合内容:上传过一次 DOCX/PDF 的卡片会显示 "↻ 已转 MD",所以非纯 md 时
  // 副标题改成更中性的"…点击打开抽屉"提示。
  const hasConverted = auxFiles.some((f) => f.converted_to_md)
  const finalSubTitle = hasConverted
    ? `— ${auxFiles.length} 个文件 · 点击打开抽屉`
    : subTitle

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 重置 value 让连续选同一文件也能再次触发 change
    e.target.value = ''
    if (!file) return
    onUpload?.(file)
  }

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
            {finalSubTitle}
          </span>
        </div>
        {/* 头部 action 槽(issue 06):📁 上传 + ＋ 新建 */}
        <div
          data-testid="aux-files-pane-actions"
          className="flex items-center gap-1.5"
        >
          {/* 隐藏的 file input — 上传按钮 click() 触发它 */}
          <input
            ref={fileInputRef}
            type="file"
            accept={UPLOAD_ACCEPT}
            data-testid="aux-files-pane-upload-input"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden
          />
          <button
            type="button"
            data-testid="aux-files-pane-upload"
            onClick={handleUploadClick}
            disabled={!onUpload}
            className={[
              'inline-flex items-center gap-1 h-[26px] px-2 rounded-md text-xs font-medium',
              'bg-bg-elevated text-text-1 border border-border-strong',
              'hover:bg-bg-subtle',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-brand-50',
            ].join(' ')}
          >
            <span aria-hidden>📁</span>
            <span>上传</span>
          </button>
          <button
            type="button"
            data-testid="aux-files-pane-create"
            onClick={() => onCreateClick?.()}
            disabled={!onCreateClick}
            className={[
              'inline-flex items-center gap-1 h-[26px] px-2 rounded-md text-xs font-semibold',
              'bg-brand text-white',
              'hover:bg-brand-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'focus:outline-none focus:ring-2 focus:ring-brand-50',
            ].join(' ')}
          >
            <span aria-hidden>＋</span>
            <span>新建</span>
          </button>
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
