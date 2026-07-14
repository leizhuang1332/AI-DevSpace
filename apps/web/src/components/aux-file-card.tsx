'use client'

import type { AuxFile, UsageTag } from '@ai-devspace/shared'

/**
 * 单个辅助文件卡片(issue 04 验收 #2)
 *
 * 视觉对照基线:`docs/design/pages/19-final-drafting.html` 的 `.fcard` 区域
 *
 * 布局:
 * ┌───────────────────────────────────────┐
 * │ 📐  api-draft.md       [API 草案]    │  ← icon · filename · usage tag
 * │ 退款 API 端点草案 · 5 字段 · …        │  ← body 预览(2 行截断)
 * │ ─────────────────────────────────────│
 * │ md                14 分钟前           │  ← meta 行(format chip · 时间)
 * └───────────────────────────────────────┘
 *
 * 行为:
 * - 点击整张卡片 → 调用 `onOpen(aux.id)`(issue 05 抽屉留接口,本期仅占位)
 * - 鼠标 hover 提边框 + 上移 1px(设计稿 .fcard:hover)
 *
 * 颜色映射(对应 `.fcard .tag` 行内色块):
 * - api:indigo(主色 #5e6ad2)
 * - data:amber
 * - research:pink
 * - sop:blue
 * - ui:green
 * - other:gray
 */

export interface AuxFileCardProps {
  aux: AuxFile
  /** 点击卡片回调;不传则禁用 hover/click 视觉反馈 */
  onOpen?: (id: string) => void
}

// ---------------------------------------------------------------------------
// Usage tag → (icon, label, 颜色) 查表
// ---------------------------------------------------------------------------

interface UsageTagMeta {
  icon: string
  label: string
  /** Tailwind utility 用于 tag chip 背景(注意:必须在 tailwind safelist 中存在) */
  chipClass: string
}

const USAGE_TAG_META: Record<UsageTag, UsageTagMeta> = {
  api: {
    icon: '📐',
    label: 'API 草案',
    chipClass: 'bg-[#eef2ff] text-[#4338ca]',
  },
  data: {
    icon: '📊',
    label: '数据字典',
    chipClass: 'bg-[#fef3c7] text-[#a16207]',
  },
  research: {
    icon: '📑',
    label: '调研',
    chipClass: 'bg-[#fce7f3] text-[#9d174d]',
  },
  sop: {
    icon: '📄',
    label: 'SOP',
    chipClass: 'bg-[#dbeafe] text-[#1e40af]',
  },
  ui: {
    icon: '🎨',
    label: 'UI 草图',
    chipClass: 'bg-[#dcfce7] text-[#15803d]',
  },
  other: {
    icon: '📎',
    label: '其他',
    chipClass: 'bg-bg-subtle text-text-2',
  },
}

// ---------------------------------------------------------------------------
// body 预览:取首个非空非标题行,2 行 CSS 截断(设计稿 .fcard .desc)
// ---------------------------------------------------------------------------

const HEADING_LINE_RE = /^#{1,6}\s/

function pickPreviewLine(body: string): string {
  if (!body) return ''
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (HEADING_LINE_RE.test(line)) continue
    return line
  }
  return ''
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function AuxFileCard({ aux, onOpen }: AuxFileCardProps) {
  const meta = USAGE_TAG_META[aux.usage_tag]
  const preview = pickPreviewLine(aux.body)

  const handleClick = () => {
    onOpen?.(aux.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(aux.id)
    }
  }

  return (
    <div
      data-testid="aux-card"
      data-aux-id={aux.id}
      data-usage-tag={aux.usage_tag}
      data-source-format={aux.source_format}
      data-converted-to-md={String(aux.converted_to_md)}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : -1}
      aria-label={`${meta.label} · ${aux.filename}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        'flex flex-col gap-2 p-3 min-h-[90px]',
        'bg-bg-elevated border border-border rounded-lg',
        onOpen &&
          'cursor-pointer transition-[border-color,box-shadow,transform] duration-150',
        onOpen && 'hover:border-brand hover:shadow-sm hover:-translate-y-px',
        onOpen && 'focus:outline-none focus:ring-2 focus:ring-brand-50',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* icon · filename · usage tag */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          data-testid="aux-card-icon"
          className="text-sm w-[18px] text-center flex-shrink-0"
          aria-hidden
        >
          {meta.icon}
        </span>
        <span
          data-testid="aux-card-filename"
          className="font-semibold text-sm text-text-1 flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
        >
          {aux.filename}
        </span>
        <span
          data-testid="aux-card-usage-tag"
          data-usage-label={meta.label}
          className={[
            'text-[10px] font-medium px-1.5 py-0.5 rounded-sm flex-shrink-0',
            meta.chipClass,
          ].join(' ')}
        >
          {meta.label}
        </span>
      </div>

      {/* body 预览 */}
      {preview && (
        <div
          data-testid="aux-card-preview"
          className="text-xs text-text-3 leading-snug line-clamp-2"
        >
          {preview}
        </div>
      )}

      {/* meta 行:format chip · 已转 MD */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-dashed border-border text-xs text-text-3">
        <span
          data-testid="aux-card-format"
          className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-bg-subtle text-text-2"
        >
          {aux.source_format}
        </span>
        {aux.converted_to_md && (
          <span
            data-testid="aux-card-converted"
            className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-success-50 text-success"
          >
            ↻ 已转 MD
          </span>
        )}
      </div>
    </div>
  )
}