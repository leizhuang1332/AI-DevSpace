import type { UsageTag } from '@ai-devspace/shared'

/**
 * UsageTag → 视觉 metadata 共享表(issue 04/05)
 *
 * DRAFTING 工位的所有"辅助文件"视觉元素都引用这里:
 * - `aux-file-card.tsx`:卡片头部 icon / tag chip(背景色 + 文字色)
 * - `aux-drawer.tsx`:抽屉 head 与 pane head 的 icon
 *
 * 如果后续需要新增一个 UsageTag,只需改本表 + packages/shared/src/drafting.ts
 * 类型联合,UI 自动一致。
 *
 * Tailwind utility(背景色 + 文字色)必须在 tailwind.config 的 safelist 中
 * 存在 —— 由于使用变量色(如 bg-brand-50)被 exhaustive class 检测,
 * 这里直接用 `bg-[#xxx]` 内联色,天然可被构建器静态检测到。
 */

export interface AuxUsageMeta {
  /** emoji icon */
  icon: string
  /** 中文标签(UI 上显示) */
  label: string
  /** Tailwind utility 用于 tag chip 背景 + 文字色 */
  chipClass: string
}

export const AUX_USAGE_META: Record<UsageTag, AuxUsageMeta> = {
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
