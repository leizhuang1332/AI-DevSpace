'use client'

/**
 * ProductList 组件 — ANALYZING 工位主区右侧"识别产物"分类列表(ADR-0013 D2 ③)
 *
 * 视觉对照基线:docs/design/pages/11h-A-zone-multisession-tabs.html 右列
 *
 * 职责:
 * - 把识别产物按三类(📌子问题 / ⚠️风险点 / 🎨方案方向)分块展示
 * - **本 slice 仅只读**(issue 19d VS4 才会加 inline 编辑 / 删除 / 合并 / 新增)
 * - 每条产品卡:小图标 + title + description(可选)
 * - 整体可滚动,容器高度由父布局(grid h-full)决定
 *
 * 设计要点:
 * - props.products 来自 server-side `deriveProducts(chunks)`(analyzing.ts)
 * - 客户端不做分类聚合(避免与 server 重复计算)
 * - 空列表 → 渲染 "暂无" 占位文案(避免空容器看起来是 bug)
 * - severity 决定左侧 border-l 颜色,与 admission 维度一致
 */

import type { AnalyzingProductGroup, AnalyzingProductItem } from '@/lib/analyzing'

export interface ProductListProps {
  products: AnalyzingProductGroup
}

// ---------------------------------------------------------------------------
// severity → border-l 类(与 admission-dashboard 同色系,保持视觉一致)
// ---------------------------------------------------------------------------

const SEVERITY_BORDER: Record<AnalyzingProductItem['severity'], string> = {
  red: 'border-l-error',
  orange: 'border-l-warning',
  yellow: 'border-l-yellow-500',
  green: 'border-l-success',
  blue: 'border-l-blue-500',
}

// ---------------------------------------------------------------------------
// 三类的元数据(标题 + emoji + 空态文案)
// ---------------------------------------------------------------------------

interface SectionMeta {
  testId: string
  emoji: string
  label: string
  emptyText: string
}

const SUBPROBLEM_META: SectionMeta = {
  testId: 'product-subproblems',
  emoji: '📌',
  label: '子问题',
  emptyText: '暂无子问题',
}
const RISK_META: SectionMeta = {
  testId: 'product-risks',
  emoji: '⚠️',
  label: '风险点',
  emptyText: '暂无风险',
}
const OPTION_META: SectionMeta = {
  testId: 'product-options',
  emoji: '🎨',
  label: '方案方向',
  emptyText: '暂无方案',
}

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function ProductList({ products }: ProductListProps) {
  return (
    <div
      data-testid="product-list"
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden h-full flex flex-col"
    >
      <div className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between flex-shrink-0">
        <span className="text-md font-semibold flex items-center gap-2">
          🎯 识别产物
        </span>
        <span className="font-mono text-xs text-text-3">
          {products.subproblems.length} 子问题 + {products.risks.length} 风险 +{' '}
          {products.options.length} 方案
        </span>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3">
        <ProductSection
          testId={SUBPROBLEM_META.testId}
          emoji={SUBPROBLEM_META.emoji}
          label={SUBPROBLEM_META.label}
          emptyText={SUBPROBLEM_META.emptyText}
          items={products.subproblems}
        />
        <ProductSection
          testId={RISK_META.testId}
          emoji={RISK_META.emoji}
          label={RISK_META.label}
          emptyText={RISK_META.emptyText}
          items={products.risks}
        />
        <ProductSection
          testId={OPTION_META.testId}
          emoji={OPTION_META.emoji}
          label={OPTION_META.label}
          emptyText={OPTION_META.emptyText}
          items={products.options}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单类分区(标题 + 列表 / 空态)
// ---------------------------------------------------------------------------

function ProductSection({
  testId,
  emoji,
  label,
  emptyText,
  items,
}: {
  testId: string
  emoji: string
  label: string
  emptyText: string
  items: AnalyzingProductItem[]
}) {
  return (
    <section data-testid={testId} className="mb-4 last:mb-0">
      <h3 className="text-xs uppercase tracking-wider text-text-3 font-semibold mb-2">
        {emoji} {label}{' '}
        <span className="font-mono normal-case text-text-3">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p
          data-testid={`${testId}-empty`}
          className="text-sm text-text-3 px-3 py-2"
        >
          {emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <ProductItemCard key={it.id} item={it} testIdPrefix={`${testId}-item`} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 单条产品卡(只读 · 无编辑按钮 — VS4 才会加)
// ---------------------------------------------------------------------------

function ProductItemCard({
  item,
  testIdPrefix,
}: {
  item: AnalyzingProductItem
  testIdPrefix: string
}) {
  return (
    <li
      data-testid={testIdPrefix}
      data-item-id={item.id}
      data-severity={item.severity}
      className={`bg-bg-subtle border border-border rounded-md border-l-[3px] ${SEVERITY_BORDER[item.severity]} px-3 py-2`}
    >
      <div className="text-sm font-medium text-text-1">{item.title}</div>
      {item.description && (
        <div className="text-xs text-text-2 mt-1 whitespace-pre-wrap">
          {item.description}
        </div>
      )}
    </li>
  )
}
