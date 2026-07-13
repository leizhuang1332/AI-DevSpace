'use client'

/**
 * ProductList 组件 — ANALYZING 工位主区右侧"识别产物"分类列表
 *
 * 历史:
 * - VS2 (issue 19b/19c):只读视图,按 📌子问题 / ⚠️风险点 / 🎨方案方向 三类分块
 * - VS4 (issue 19d):新增**交互编辑**能力(增 / 删 / 改 / 合并)
 *
 * 视觉对照基线:docs/design/pages/11h-A-zone-multisession-tabs.html 右列
 *
 * 设计要点:
 * - props.products 来自 server-side `deriveProducts(chunks)`(analyzing.ts)
 * - editable=false → 回退到 VS2 只读视图(不破坏旧测试)
 * - editable=true(默认)→ 每条卡片右上角 3 按钮 + 每类底部 + 新增
 * - 卡片三态:normal / editing / confirm-delete(单一 state per card)
 * - 合并模式是 ProductList 层级的合并状态:进入合并模式后,该类其他卡片显示
 *   复选框 + 底部 [合并 N 项] 按钮;支持取消退出
 * - 所有 mutation 通过 `onAction(change)` 回调通知父组件 —— 父组件决定是否走
 *   server action / 乐观更新 / 重新拉取
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AnalyzingProductGroup,
  AnalyzingProductItem,
} from '@/lib/analyzing'
import type {
  ProductChange,
  ProductEditPatch,
  ProductKind,
  ProductSeverity,
} from '@/lib/products'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProductListProps {
  products: AnalyzingProductGroup
  /**
   * 是否启用交互(默认 true)。editable=false 时,渲染回退到 VS2 只读视图,
   * 与旧测试兼容(无任何 button、无 + 新增按钮、无 inline 编辑 UI)。
   */
  editable?: boolean
  /**
   * 变更回调 — 父组件决定如何落盘(server action / 乐观更新等)。
   * editable=true 时必传;editable=false 时可不传(no-op)。
   */
  onAction?: (change: ProductChange) => void | Promise<void>
}

// ---------------------------------------------------------------------------
// severity → border-l 类(与 admission-dashboard 同色系)
// ---------------------------------------------------------------------------

const SEVERITY_BORDER: Record<ProductSeverity, string> = {
  red: 'border-l-error',
  orange: 'border-l-warning',
  yellow: 'border-l-yellow-500',
  green: 'border-l-success',
  blue: 'border-l-blue-500',
}

// ---------------------------------------------------------------------------
// 三类的元数据(标题 + emoji + 空态文案 + 新增按钮文案)
// ---------------------------------------------------------------------------

interface SectionMeta {
  testId: string
  emoji: string
  label: string
  emptyText: string
  addLabel: string
}

const SUBPROBLEM_META: SectionMeta = {
  testId: 'product-subproblems',
  emoji: '📌',
  label: '子问题',
  emptyText: '暂无子问题',
  addLabel: '+ 新增子问题',
}
const RISK_META: SectionMeta = {
  testId: 'product-risks',
  emoji: '⚠️',
  label: '风险点',
  emptyText: '暂无风险',
  addLabel: '+ 新增风险',
}
const OPTION_META: SectionMeta = {
  testId: 'product-options',
  emoji: '🎨',
  label: '方案方向',
  emptyText: '暂无方案',
  addLabel: '+ 新增方案',
}

// ---------------------------------------------------------------------------
// 卡片状态(per-card state machine:normal / editing / confirm-delete)
// ---------------------------------------------------------------------------

type CardState = 'normal' | 'editing' | 'confirm-delete'

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function ProductList({
  products,
  editable = true,
  onAction,
}: ProductListProps) {
  // 只读视图(等价于 VS2):editable=false 直接渲染旧版
  if (!editable) {
    return <ReadOnlyProductList products={products} />
  }

  return (
    <InteractiveProductList
      products={products}
      onAction={onAction ?? (() => undefined)}
    />
  )
}

// ===========================================================================
// 只读视图(等价 VS2,editable=false 走此分支;不依赖 React state)
// ===========================================================================

function ReadOnlyProductList({ products }: { products: AnalyzingProductGroup }) {
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
        <ReadOnlySection
          meta={SUBPROBLEM_META}
          items={products.subproblems}
        />
        <ReadOnlySection meta={RISK_META} items={products.risks} />
        <ReadOnlySection meta={OPTION_META} items={products.options} />
      </div>
    </div>
  )
}

function ReadOnlySection({
  meta,
  items,
}: {
  meta: SectionMeta
  items: AnalyzingProductItem[]
}) {
  return (
    <section data-testid={meta.testId} className="mb-4 last:mb-0">
      <h3 className="text-xs uppercase tracking-wider text-text-3 font-semibold mb-2">
        {meta.emoji} {meta.label}{' '}
        <span className="font-mono normal-case text-text-3">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p
          data-testid={`${meta.testId}-empty`}
          className="text-sm text-text-3 px-3 py-2"
        >
          {meta.emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.id}
              data-testid={`${meta.testId}-item`}
              data-item-id={it.id}
              data-severity={it.severity}
              className={`bg-bg-subtle border border-border rounded-md border-l-[3px] ${SEVERITY_BORDER[it.severity]} px-3 py-2`}
            >
              <div className="text-sm font-medium text-text-1">{it.title}</div>
              {it.description && (
                <div className="text-xs text-text-2 mt-1 whitespace-pre-wrap">
                  {it.description}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ===========================================================================
// 交互视图(editable=true)
// ===========================================================================

function InteractiveProductList({
  products,
  onAction,
}: {
  products: AnalyzingProductGroup
  onAction: (change: ProductChange) => void | Promise<void>
}) {
  // per-card 状态:仅记录当前不在 normal 的卡片 id + state
  // 用 Map<itemId, CardState> 而不是 Set<itemId>:允许 normal / editing / confirm-delete 共存(虽然实际同一时间一卡只有一种)
  const [cardStates, setCardStates] = useState<Map<string, CardState>>(
    () => new Map(),
  )

  // 合并模式:作用于某一种类(一次只能合并同一 kind)
  // null = 不在合并模式;非空 = { kind, sourceId, selected: Set<itemId> }
  // sourceId 是触发合并模式的卡片 id,自动 selected 且不可取消(checkbox disabled)
  const [mergeMode, setMergeMode] = useState<{
    kind: ProductKind
    sourceId: string
    selected: Set<string>
  } | null>(null)

  // 新增对话框
  const [addDialog, setAddDialog] = useState<ProductKind | null>(null)

  // 合并 title dialog
  const [mergeDialog, setMergeDialog] = useState<boolean>(false)

  // ---------------------------------------------------------------------
  // 卡片状态切换
  // ---------------------------------------------------------------------
  const setCardState = useCallback((id: string, state: CardState | null) => {
    setCardStates((prev) => {
      const next = new Map(prev)
      if (state === null) next.delete(id)
      else next.set(id, state)
      return next
    })
  }, [])

  // ---------------------------------------------------------------------
  // 编辑保存/取消
  // ---------------------------------------------------------------------
  const handleSaveEdit = useCallback(
    async (kind: ProductKind, id: string, patch: ProductEditPatch) => {
      await onAction({ kind, action: 'edit', id, patch })
      setCardState(id, null)
    },
    [onAction, setCardState],
  )

  // ---------------------------------------------------------------------
  // 删除确认/取消
  // ---------------------------------------------------------------------
  const handleConfirmDelete = useCallback(
    async (kind: ProductKind, id: string) => {
      await onAction({ kind, action: 'delete', id })
      // 删除后该卡片不再存在,本地 state map 残留无所谓(下次 render 不再渲染该 id)
    },
    [onAction],
  )

  // ---------------------------------------------------------------------
  // 合并模式
  // - 点 🔗 → 进入合并模式,source 卡自动选中(>=1)
  // - 再次点同 kind 的 🔗 → 退出合并模式
  // - 点 source 卡的 checkbox → 禁用(source 不可取消)
  // - 点其他卡的 checkbox → 切换选中
  // ---------------------------------------------------------------------
  const toggleMergeMode = useCallback((kind: ProductKind, sourceId: string) => {
    setMergeMode((prev) => {
      if (prev?.kind === kind) {
        // 同 kind 二次点 🔗 → 退出合并模式
        return null
      }
      // 进入合并模式:自动选中 source id(>=1 个)
      return { kind, sourceId, selected: new Set([sourceId]) }
    })
  }, [])

  const toggleMergeCheckbox = useCallback((id: string) => {
    setMergeMode((prev) => {
      if (!prev) return prev
      // source 不可取消(避免 N=0 时无法合并)
      if (id === prev.sourceId) return prev
      const next = new Set(prev.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { kind: prev.kind, sourceId: prev.sourceId, selected: next }
    })
  }, [])

  const cancelMergeMode = useCallback(() => {
    setMergeMode(null)
    setMergeDialog(false)
  }, [])

  const openMergeDialog = useCallback(() => {
    if (!mergeMode || mergeMode.selected.size < 2) return
    setMergeDialog(true)
  }, [mergeMode])

  const confirmMerge = useCallback(
    async (newTitle: string) => {
      if (!mergeMode) return
      const ids = Array.from(mergeMode.selected)
      // 生成新 id(caller 负责保证唯一 — 用 crypto.randomUUID)
      const newId = `merged-${generateUuid()}`
      await onAction({
        kind: mergeMode.kind,
        action: 'merge',
        ids,
        newId,
        newTitle,
        newSeverity: 'blue',
      })
      setMergeMode(null)
      setMergeDialog(false)
    },
    [mergeMode, onAction],
  )

  // ---------------------------------------------------------------------
  // 新增
  // ---------------------------------------------------------------------
  const submitAdd = useCallback(
    async (kind: ProductKind, title: string) => {
      const newId = generateUuid()
      await onAction({
        kind,
        action: 'add',
        item: { id: newId, title, severity: 'blue' },
      })
      setAddDialog(null)
    },
    [onAction],
  )

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
        <InteractiveSection
          meta={SUBPROBLEM_META}
          kind="subproblems"
          items={products.subproblems}
          cardStates={cardStates}
          setCardState={setCardState}
          onSaveEdit={handleSaveEdit}
          onConfirmDelete={handleConfirmDelete}
          mergeMode={mergeMode?.kind === 'subproblems' ? mergeMode : null}
          onToggleMergeMode={toggleMergeMode}
          onToggleMergeCheckbox={toggleMergeCheckbox}
          onOpenAdd={() => setAddDialog('subproblems')}
        />
        <InteractiveSection
          meta={RISK_META}
          kind="risks"
          items={products.risks}
          cardStates={cardStates}
          setCardState={setCardState}
          onSaveEdit={handleSaveEdit}
          onConfirmDelete={handleConfirmDelete}
          mergeMode={mergeMode?.kind === 'risks' ? mergeMode : null}
          onToggleMergeMode={toggleMergeMode}
          onToggleMergeCheckbox={toggleMergeCheckbox}
          onOpenAdd={() => setAddDialog('risks')}
        />
        <InteractiveSection
          meta={OPTION_META}
          kind="options"
          items={products.options}
          cardStates={cardStates}
          setCardState={setCardState}
          onSaveEdit={handleSaveEdit}
          onConfirmDelete={handleConfirmDelete}
          mergeMode={mergeMode?.kind === 'options' ? mergeMode : null}
          onToggleMergeMode={toggleMergeMode}
          onToggleMergeCheckbox={toggleMergeCheckbox}
          onOpenAdd={() => setAddDialog('options')}
        />
      </div>

      {/* 合并模式底部 bar */}
      {mergeMode && !mergeDialog && (
        <MergeBar
          count={mergeMode.selected.size}
          onSubmit={openMergeDialog}
          onCancel={cancelMergeMode}
        />
      )}

      {/* 新增对话框 */}
      {addDialog && (
        <AddDialog
          kind={addDialog}
          meta={
            addDialog === 'subproblems'
              ? SUBPROBLEM_META
              : addDialog === 'risks'
                ? RISK_META
                : OPTION_META
          }
          onConfirm={(title) => submitAdd(addDialog, title)}
          onCancel={() => setAddDialog(null)}
        />
      )}

      {/* 合并 title 对话框 */}
      {mergeDialog && mergeMode && (
        <MergeDialog
          count={mergeMode.selected.size}
          onConfirm={confirmMerge}
          onCancel={() => setMergeDialog(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单类分区(交互版)
// ---------------------------------------------------------------------------

interface InteractiveSectionProps {
  meta: SectionMeta
  kind: ProductKind
  items: AnalyzingProductItem[]
  cardStates: Map<string, CardState>
  setCardState: (id: string, state: CardState | null) => void
  onSaveEdit: (kind: ProductKind, id: string, patch: ProductEditPatch) => Promise<void>
  onConfirmDelete: (kind: ProductKind, id: string) => Promise<void>
  mergeMode: { kind: ProductKind; sourceId: string; selected: Set<string> } | null
  onToggleMergeMode: (kind: ProductKind, sourceId: string) => void
  onToggleMergeCheckbox: (id: string) => void
  onOpenAdd: () => void
}

function InteractiveSection({
  meta,
  kind,
  items,
  cardStates,
  setCardState,
  onSaveEdit,
  onConfirmDelete,
  mergeMode,
  onToggleMergeMode,
  onToggleMergeCheckbox,
  onOpenAdd,
}: InteractiveSectionProps) {
  return (
    <section data-testid={meta.testId} className="mb-4 last:mb-0">
      <h3 className="text-xs uppercase tracking-wider text-text-3 font-semibold mb-2">
        {meta.emoji} {meta.label}{' '}
        <span className="font-mono normal-case text-text-3">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p
          data-testid={`${meta.testId}-empty`}
          className="text-sm text-text-3 px-3 py-2"
        >
          {meta.emptyText}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <InteractiveItem
              key={it.id}
              item={it}
              testIdPrefix={`${meta.testId}-item`}
              kind={kind}
              state={cardStates.get(it.id) ?? 'normal'}
              setState={(s) => setCardState(it.id, s)}
              onSaveEdit={(patch) => onSaveEdit(kind, it.id, patch)}
              onConfirmDelete={() => onConfirmDelete(kind, it.id)}
              mergeMode={mergeMode}
              onToggleMergeMode={() => onToggleMergeMode(kind, it.id)}
              onToggleMergeCheckbox={() => onToggleMergeCheckbox(it.id)}
            />
          ))}
        </ul>
      )}
      {/* 新增按钮:始终在分区底部 */}
      <button
        type="button"
        data-testid={`product-add-${kind}`}
        onClick={onOpenAdd}
        className="mt-2 text-xs text-text-2 hover:text-brand-700 hover:bg-brand-50/40 border border-dashed border-border rounded-md px-3 py-2 w-full text-left transition-colors"
      >
        {meta.addLabel}
      </button>
    </section>
  )
}

// ---------------------------------------------------------------------------
// 单条产品卡(交互版:三态切换 + 合并 checkbox)
// ---------------------------------------------------------------------------

interface InteractiveItemProps {
  item: AnalyzingProductItem
  testIdPrefix: string
  kind: ProductKind
  state: CardState
  setState: (s: CardState | null) => void
  onSaveEdit: (patch: ProductEditPatch) => Promise<void>
  onConfirmDelete: () => Promise<void>
  mergeMode: { kind: ProductKind; sourceId: string; selected: Set<string> } | null
  onToggleMergeMode: () => void
  onToggleMergeCheckbox: () => void
}

function InteractiveItem({
  item,
  testIdPrefix,
  kind,
  state,
  setState,
  onSaveEdit,
  onConfirmDelete,
  mergeMode,
  onToggleMergeMode,
  onToggleMergeCheckbox,
}: InteractiveItemProps) {
  const isMergeModeForThisKind = mergeMode?.kind === kind
  const checked = isMergeModeForThisKind && mergeMode?.selected.has(item.id)

  // 编辑态:本地临时 title;提交时回传 patch
  const [editTitle, setEditTitle] = useState(item.title)
  // 当切换回 normal 时,重置 editTitle 为最新 item.title
  const lastItemIdRef = useRef(item.id)
  useEffect(() => {
    if (lastItemIdRef.current !== item.id) {
      lastItemIdRef.current = item.id
      setEditTitle(item.title)
    } else if (state === 'normal') {
      setEditTitle(item.title)
    }
  }, [item.id, item.title, state])

  // 边角样式:normal vs editing vs confirm-delete vs merge-mode
  let cardCls =
    'bg-bg-subtle border border-border rounded-md border-l-[3px] px-3 py-2 transition-colors'
  if (state === 'confirm-delete') {
    cardCls += ' border-error border-l-error bg-error/5'
  } else if (isMergeModeForThisKind) {
    cardCls += ' border-brand-100 bg-brand-50/20'
  } else {
    cardCls += ` ${SEVERITY_BORDER[item.severity]}`
  }

  return (
    <li
      data-testid={testIdPrefix}
      data-item-id={item.id}
      data-severity={item.severity}
      data-state={state}
      data-kind={kind}
      className={cardCls}
    >
      {/* 合并模式:checkbox 在卡片左侧 */}
      {isMergeModeForThisKind ? (
        <MergeCheckboxRow
          item={item}
          checked={!!checked}
          disabled={item.id === mergeMode?.sourceId}
          onToggle={onToggleMergeCheckbox}
        />
      ) : state === 'editing' ? (
        <EditingRow
          item={item}
          editTitle={editTitle}
          setEditTitle={setEditTitle}
          onSave={() => onSaveEdit({ title: editTitle.trim() })}
          onCancel={() => setState(null)}
        />
      ) : state === 'confirm-delete' ? (
        <ConfirmDeleteRow
          item={item}
          onConfirm={onConfirmDelete}
          onCancel={() => setState(null)}
        />
      ) : (
        <NormalRow item={item} />
      )}

      {/* 右上角操作按钮(非编辑 / 非删除 / 非合并模式下显示) */}
      {state === 'normal' && !isMergeModeForThisKind && (
        <div className="flex items-center gap-1 mt-1.5 -mb-0.5 justify-end">
          <IconButton
            testId="product-card-edit"
            label="✏️"
            title="编辑"
            onClick={() => setState('editing')}
          />
          <IconButton
            testId="product-card-delete"
            label="🗑"
            title="删除"
            onClick={() => setState('confirm-delete')}
          />
          <IconButton
            testId="product-card-merge-toggle"
            label="🔗"
            title="合并"
            onClick={onToggleMergeMode}
          />
        </div>
      )}
    </li>
  )
}

function NormalRow({ item }: { item: AnalyzingProductItem }) {
  return (
    <>
      <div className="text-sm font-medium text-text-1">{item.title}</div>
      {item.description && (
        <div className="text-xs text-text-2 mt-1 whitespace-pre-wrap">
          {item.description}
        </div>
      )}
    </>
  )
}

function EditingRow({
  item,
  editTitle,
  setEditTitle,
  onSave,
  onCancel,
}: {
  item: AnalyzingProductItem
  editTitle: string
  setEditTitle: (v: string) => void
  onSave: () => Promise<void>
  onCancel: () => void
}) {
  const trimmed = editTitle.trim()
  const canSave = trimmed.length > 0
  return (
    <div data-testid={`${item.id}-editing`} className="flex flex-col gap-2">
      <input
        type="text"
        data-testid="product-card-edit-input"
        value={editTitle}
        onChange={(e) => setEditTitle(e.target.value)}
        aria-label="编辑产物标题"
        autoFocus
        className="text-sm text-text-1 bg-bg-elevated border border-border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
      />
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          data-testid="product-card-cancel"
          onClick={onCancel}
          className="text-xs h-7 px-2 rounded-md bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          ✕ 取消
        </button>
        <button
          type="button"
          data-testid="product-card-save"
          onClick={onSave}
          disabled={!canSave}
          className="text-xs h-7 px-2 rounded-md bg-brand text-white hover:bg-brand-600 disabled:bg-bg-subtle disabled:text-text-3 disabled:cursor-not-allowed"
        >
          ✓ 保存
        </button>
      </div>
    </div>
  )
}

function ConfirmDeleteRow({
  item,
  onConfirm,
  onCancel,
}: {
  item: AnalyzingProductItem
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  return (
    <div data-testid={`${item.id}-confirm`} className="flex flex-col gap-2">
      <div className="text-sm font-medium text-error">确认删除?</div>
      <div className="text-xs text-text-2 truncate">「{item.title}」</div>
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          data-testid="product-card-cancel-delete"
          onClick={onCancel}
          className="text-xs h-7 px-2 rounded-md bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          ✕ 否
        </button>
        <button
          type="button"
          data-testid="product-card-confirm-delete"
          onClick={onConfirm}
          className="text-xs h-7 px-2 rounded-md bg-error text-white hover:opacity-90"
        >
          ✓ 是
        </button>
      </div>
    </div>
  )
}

function MergeCheckboxRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: AnalyzingProductItem
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <label
      className={`flex items-start gap-2 ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        data-testid="product-merge-checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        className="mt-1 w-4 h-4 accent-brand disabled:opacity-60"
        aria-label={`选中 ${item.title} 进行合并`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text-1">{item.title}</div>
        {item.description && (
          <div className="text-xs text-text-2 mt-1 whitespace-pre-wrap">
            {item.description}
          </div>
        )}
      </div>
    </label>
  )
}

function IconButton({
  testId,
  label,
  title,
  onClick,
}: {
  testId: string
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-sm hover:bg-bg-elevated text-text-2 hover:text-text-1 transition-colors"
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// 合并模式底部 bar
// ---------------------------------------------------------------------------

function MergeBar({
  count,
  onSubmit,
  onCancel,
}: {
  count: number
  onSubmit: () => void
  onCancel: () => void
}) {
  const canSubmit = count >= 2
  return (
    <div
      data-testid="product-merge-bar"
      className="flex-shrink-0 px-4 py-3 border-t border-border bg-brand-50/40 flex items-center justify-between"
    >
      <span className="text-sm text-text-1">已选 {count} 项</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="product-merge-cancel"
          onClick={onCancel}
          className="h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
        >
          取消
        </button>
        <button
          type="button"
          data-testid="product-merge-submit"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:bg-bg-subtle disabled:text-text-3 disabled:cursor-not-allowed"
        >
          合并 {count} 项
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 合并 title 对话框
// ---------------------------------------------------------------------------

function MergeDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number
  onConfirm: (newTitle: string) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const trimmed = title.trim()
  const canConfirm = trimmed.length > 0
  return (
    <div
      data-testid="product-merge-dialog"
      role="dialog"
      aria-label="合并产物"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
    >
      <div className="bg-bg-elevated border border-border rounded-lg shadow-xl w-[480px] max-w-[92vw] p-5">
        <h3 className="text-lg font-semibold text-text-1 mb-1">
          合并 {count} 项产物
        </h3>
        <p className="text-sm text-text-2 mb-4">
          为合并后的产物起一个新标题。原 {count} 项将被删除,新条目追加到末尾。
        </p>
        <input
          type="text"
          data-testid="product-merge-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="新标题..."
          autoFocus
          className="w-full text-sm text-text-1 bg-bg-subtle border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            data-testid="product-merge-dialog-cancel"
            onClick={onCancel}
            className="h-9 px-4 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
          >
            ✕ 取消
          </button>
          <button
            type="button"
            data-testid="product-merge-dialog-confirm"
            onClick={() => onConfirm(trimmed)}
            disabled={!canConfirm}
            className="h-9 px-4 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:bg-bg-subtle disabled:text-text-3 disabled:cursor-not-allowed"
          >
            ✓ 确认合并
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 新增对话框
// ---------------------------------------------------------------------------

function AddDialog({
  kind,
  meta,
  onConfirm,
  onCancel,
}: {
  kind: ProductKind
  meta: SectionMeta
  onConfirm: (title: string) => Promise<void>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const trimmed = title.trim()
  const canConfirm = trimmed.length > 0
  return (
    <div
      data-testid="product-add-dialog"
      role="dialog"
      aria-label="新增产物"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
    >
      <div className="bg-bg-elevated border border-border rounded-lg shadow-xl w-[480px] max-w-[92vw] p-5">
        <h3 className="text-lg font-semibold text-text-1 mb-1">
          新增{meta.label}
        </h3>
        <p className="text-sm text-text-2 mb-4">
          标题必填,描述 / 严重度可在后续编辑。
        </p>
        <label className="block text-xs text-text-3 mb-1">标题 *</label>
        <input
          type="text"
          data-testid="product-add-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${meta.label}标题...`}
          autoFocus
          className="w-full text-sm text-text-1 bg-bg-subtle border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            data-testid="product-add-dialog-cancel"
            onClick={onCancel}
            className="h-9 px-4 rounded-md text-sm font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle"
          >
            ✕ 取消
          </button>
          <button
            type="button"
            data-testid="product-add-dialog-confirm"
            onClick={() => onConfirm(trimmed)}
            disabled={!canConfirm}
            className="h-9 px-4 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:bg-bg-subtle disabled:text-text-3 disabled:cursor-not-allowed"
          >
            ✓ 保存
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// id 生成(crypto.randomUUID 包装,便于测试 mock)
// ---------------------------------------------------------------------------

function generateUuid(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return globalThis.crypto.randomUUID()
  }
  // Fallback(SSR / 极旧浏览器):timestamp + random
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}