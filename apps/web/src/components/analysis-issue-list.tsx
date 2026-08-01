'use client'

/**
 * AnalysisIssueList 组件 — ADR-0021 issue 03 / issue 04
 *
 * 职责:渲染当前 Analysis Run 已提交的 Analysis Issue 列表,每条 Issue 卡片
 * 包含:
 * - 标题 + 描述(原始字段,不再由模型侧修改)
 * - Skill metadata(若有,通用键值展示,不驱动排序 / Verdict)
 * - SourceRef 列表:每个 ref 渲染为可点击 chip
 *   - kind === 'requirement' / 'repository' → 文件级引用
 *   - kind === 'aux' / 'asset' → 文档阅读器能定位的资源
 *   - 引用缺失(资源已删除 / AuxFile id 不匹配 / asset 名不在 PRD 内联引用)→
 *     显示「⚠️ 引用缺失」chip,且整体 Issue 卡片挂角标
 * - IssueResponseEditor(issue 04):每条 Issue 末尾挂一个自动保存的 Markdown
 *   编辑器;不修改原始 Issue。
 *
 * 与 DocumentReaderPane 联动:点击 SourceRef chip → onSourceRefClick(ref) →
 * 父组件 AnalyzingZone 切换阅读器 Tab + 滚到对应行 + pulse 1.5s。
 *
 * 不做的事:
 * - 不修改原始 Issue 字段(ADR-0021 决策 36:原始 Issue 保持不变)
 * - 不做语义合并(决策 23)
 * - 不按 metadata 排序或判定 Verdict(决策 33)
 * - 不持久化 Issue,只读 `props.issues`
 */

import { useCallback, useEffect, useMemo, useRef, type Ref } from 'react'
import type { AnalysisIssue, IssueMetadata, SourceRef } from '@ai-devspace/shared'
import type { AssetMeta, AuxFile } from '@ai-devspace/shared'
import type {
  PrdSourceRef,
  AuxSourceRef,
  AssetSourceRef,
} from '@/lib/analyzing'
import { IssueResponseEditor } from './issue-response-editor'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AnalysisIssueListProps {
  /** 当前 Run 已提交的 AnalysisIssue 列表(按 ordinal 升序) */
  issues: ReadonlyArray<AnalysisIssue>
  /** PRD 是否存在(用于缺失来源判定;用于 kind=requirement 引用) */
  prdExists: boolean
  /** 当前 Requirement 已存在的 AuxFile 列表(用于缺失判定) */
  auxFiles: ReadonlyArray<AuxFile>
  /** 当前 Requirement PRD 已引用的 Asset 列表(用于缺失判定) */
  assetList: ReadonlyArray<AssetMeta>
  /** SourceRef 点击回调;null → chip 不渲染为按钮(纯展示) */
  onSourceRefClick?: (ref: SourceRef) => void
  /** 父组件透传 ref(用于反向联动 scrollIntoView) */
  containerRef?: Ref<HTMLDivElement>
  /** 空数据时的提示文案(默认"暂无 Issue") */
  emptyMessage?: string
  /** 当前 Requirement id(传给 IssueResponseEditor · issue 04) */
  requirementId?: string
  /** 当前 Run id(传给 IssueResponseEditor · issue 04) */
  runId?: string
  /** issue 04:Editor 保存失败时回调(用于父组件禁用"开始分析"按钮) */
  onEditorError?: (issueId: string, message: string) => void
  /** issue 04:Editor flush() 引用注册器(用于父组件在开始分析前 flush 全部) */
  registerFlush?: (issueId: string, flush: () => Promise<void>) => () => void
}

// ---------------------------------------------------------------------------
// 缺失来源判定
// ---------------------------------------------------------------------------

/**
 * 判定一条 SourceRef 引用的资源是否仍可定位。
 *
 * - kind === 'requirement':要求 `prdExists === true`(本期不深入校验相对路径
 *   是否真实命中文件,只校验 Requirement 文档存在与否)
 * - kind === 'repository':返回 false(本期 Repository 不在阅读器内,等同缺失)
 * - kind === 'aux':要求 auxFiles 里有同 id
 * - kind === 'asset':要求 assetList 里有同 asset_id(name)
 */
export function isSourceRefMissing(
  ref: SourceRef,
  ctx: {
    prdExists: boolean
    auxFiles: ReadonlyArray<AuxFile>
    assetList: ReadonlyArray<AssetMeta>
  },
): boolean {
  switch (ref.kind) {
    case 'requirement':
      return !ctx.prdExists
    case 'repository':
      // Repository 不在 DocumentReaderPane 内 → 视为不可定位
      return true
    case 'aux':
      return !ctx.auxFiles.some((a) => a.id === ref.aux_id)
    case 'asset':
      return !ctx.assetList.some((a) => a.name === ref.asset_id)
    default:
      return true
  }
}

// ---------------------------------------------------------------------------
// SourceRef → web 端 SourceRef 转换
// ---------------------------------------------------------------------------

/**
 * 把 shared 包 SourceRef 转成 web 端阅读器可消费的 SourceRef。
 *
 * - kind === 'requirement' → 'prd',line_range → lineRange
 * - kind === 'aux'         → 'aux',aux_id → auxId,line_range → lineRange
 * - kind === 'asset'       → 'asset',asset_id → assetId
 * - kind === 'repository'  → null(本期不在阅读器内;Web 端展示为只读)
 *
 * 失败时返 null(caller 不消费 null 路径)。
 */
export function sharedSourceRefToWebRef(
  ref: SourceRef,
): PrdSourceRef | AuxSourceRef | AssetSourceRef | null {
  if (ref.kind === 'requirement') {
    if (!ref.line_range) return null
    return { kind: 'prd', lineRange: ref.line_range }
  }
  if (ref.kind === 'aux') {
    if (!ref.line_range) return null
    return { kind: 'aux', auxId: ref.aux_id, lineRange: ref.line_range }
  }
  if (ref.kind === 'asset') {
    return { kind: 'asset', assetId: ref.asset_id }
  }
  return null
}

// ---------------------------------------------------------------------------
// 元数据展示工具
// ---------------------------------------------------------------------------

/** metadata 单条 → 用户可读字符串 */
function formatMetadataValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null) return 'null'
  // 数组 → 拼接
  if (Array.isArray(value)) {
    return value.map((v) => formatMetadataValue(v)).join(', ')
  }
  // 极端:基础值以外的形态(本期 schema 已拒绝嵌套对象)→ 直接 JSON 化
  return JSON.stringify(value)
}

/**
 * metadata 数组 → 通用键值展示。
 *
 * 直接遍历元组数组,保留所有 entries(包括重复 key,后到的渲染在后);不再构造
 * 中间 `Record`,避免同名 key 静默覆盖导致数据丢失(spec: metadata 以通用
 * 键值形式展示,平台不负责合并重复键)。
 */
type MetadataEntry = readonly [
  string,
  string | number | boolean | null | ReadonlyArray<string | number | boolean | null>,
]
function metadataEntries(
  metadata: ReadonlyArray<MetadataEntry>,
): ReadonlyArray<MetadataEntry> {
  return metadata
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

export function AnalysisIssueList({
  issues,
  prdExists,
  auxFiles,
  assetList,
  onSourceRefClick,
  containerRef,
  emptyMessage = '暂无 Analysis Issue',
  requirementId,
  runId,
  onEditorError,
  registerFlush,
}: AnalysisIssueListProps) {
  // 派生每条 Issue 的缺失来源集合
  const ctx = useMemo(
    () => ({ prdExists, auxFiles, assetList }),
    [prdExists, auxFiles, assetList],
  )

  const handleSourceRefClick = useCallback(
    (ref: SourceRef) => {
      onSourceRefClick?.(ref)
    },
    [onSourceRefClick],
  )

  if (issues.length === 0) {
    return (
      <div
        data-testid="analysis-issue-list"
        data-empty="true"
        ref={containerRef}
        className="bg-bg-elevated border border-border rounded-lg p-6 text-center text-sm text-text-3"
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      data-testid="analysis-issue-list"
      data-empty="false"
      data-issue-count={issues.length}
      ref={containerRef}
      className="bg-bg-elevated border border-border rounded-lg overflow-hidden flex flex-col"
    >
      <div className="px-4 py-3 border-b border-border bg-bg-subtle flex items-center justify-between flex-shrink-0">
        <span className="text-md font-semibold flex items-center gap-2">
          📝 Analysis Issues
        </span>
        <span
          data-testid="analysis-issue-count"
          className="font-mono text-xs text-text-3"
        >
          共 {issues.length} 条
        </span>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3 flex flex-col gap-3">
        {issues.map((issue) => {
          // 派生每条 SourceRef 的缺失索引集合(原始下标,O(n) 一次扫描)
          const missingIndices = new Set<number>()
          for (let i = 0; i < issue.source_refs.length; i++) {
            const r = issue.source_refs[i]
            if (r && isSourceRefMissing(r, ctx)) missingIndices.add(i)
          }
          const allMissing =
            missingIndices.size === issue.source_refs.length &&
            issue.source_refs.length > 0
          return (
            <IssueCard
              key={issue.issue_id}
              issue={issue}
              missingIndices={missingIndices}
              allMissing={allMissing}
              onSourceRefClick={handleSourceRefClick}
              requirementId={requirementId ?? ''}
              runId={runId ?? ''}
              onEditorError={onEditorError}
              registerFlush={registerFlush}
            />
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 单条 Issue 卡
// ---------------------------------------------------------------------------

function IssueCard({
  issue,
  missingIndices,
  allMissing,
  onSourceRefClick,
  requirementId,
  runId,
  onEditorError,
  registerFlush,
}: {
  issue: AnalysisIssue
  missingIndices: ReadonlySet<number>
  allMissing: boolean
  onSourceRefClick: (ref: SourceRef) => void
  requirementId: string
  runId: string
  onEditorError?: (issueId: string, message: string) => void
  registerFlush?: (issueId: string, flush: () => Promise<void>) => () => void
}) {
  // 内部 ref:把 editor 的 flush 暴露给父组件的 registerFlush
  const editorFlushRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    if (!registerFlush) return
    const unregister = registerFlush(issue.issue_id, () => {
      const fn = editorFlushRef.current
      if (!fn) return Promise.resolve()
      return fn()
    })
    return unregister
  }, [registerFlush, issue.issue_id])
  return (
    <article
      data-testid="analysis-issue-card"
      data-issue-id={issue.issue_id}
      data-ordinal={issue.ordinal}
      data-all-sources-missing={allMissing ? 'true' : 'false'}
      className={`border rounded-lg p-3 flex flex-col gap-2 ${
        allMissing
          ? 'border-warn/40 bg-warn/5'
          : 'border-border bg-bg-elevated'
      }`}
    >
      {/* 头部:ordinal + 标题 */}
      <header className="flex items-start gap-2">
        <span
          data-testid="analysis-issue-ordinal"
          className="font-mono text-xs text-text-3 flex-shrink-0 mt-0.5"
        >
          #{issue.ordinal}
        </span>
        <h3
          data-testid="analysis-issue-title"
          className="flex-1 text-sm font-semibold leading-snug"
        >
          {issue.title}
        </h3>
        {allMissing && (
          <span
            data-testid="analysis-issue-missing-badge"
            className="text-[10px] px-1.5 py-0.5 rounded bg-warn/20 text-warn-700 border border-warn/40 font-medium"
          >
            ⚠️ 引用缺失
          </span>
        )}
      </header>

      {/* 描述 */}
      <p
        data-testid="analysis-issue-description"
        className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap"
      >
        {issue.description}
      </p>

      {/* metadata 键值展示 */}
      {issue.metadata.length > 0 && (
        <dl
          data-testid="analysis-issue-metadata"
          className="text-xs grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 border-t border-border pt-2"
        >
          {metadataEntries(issue.metadata).map((entry, idx) => {
            // idx + key 复合 key,保证重复 key 都能独立渲染(不静默覆盖)
            const k = entry[0]
            const v = entry[1]
            return (
              <div key={`${k}-${idx}`} className="contents">
                <dt className="text-text-3 font-mono">{k}</dt>
                <dd className="text-text-2 break-words">{formatMetadataValue(v)}</dd>
              </div>
            )
          })}
        </dl>
      )}

      {/* SourceRef 列表 */}
      <div
        data-testid="analysis-issue-source-refs"
        className="flex flex-wrap gap-1.5 pt-1"
      >
        {issue.source_refs.map((ref, idx) => {
          const missing = missingIndices.has(idx)
          return (
            <SourceRefChip
              key={`${issue.issue_id}-ref-${idx}`}
              sourceRef={ref}
              missing={missing}
              onClick={() => {
                if (!missing) onSourceRefClick(ref)
              }}
            />
          )
        })}
      </div>

      {/* issue 04:Issue Response 编辑器(自动保存;不修改原始 Issue) */}
      {requirementId && runId && (
        <IssueResponseEditor
          requirementId={requirementId}
          runId={runId}
          issueId={issue.issue_id}
          onFlushFailed={(msg) => onEditorError?.(issue.issue_id, msg)}
          flushRef={editorFlushRef}
        />
      )}
    </article>
  )
}

// ---------------------------------------------------------------------------
// SourceRef chip
// ---------------------------------------------------------------------------

function SourceRefChip({
  sourceRef,
  missing,
  onClick,
}: {
  sourceRef: SourceRef
  missing: boolean
  onClick: () => void
}) {
  const label = formatSourceRefLabel(sourceRef)
  const baseClass =
    'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border font-mono transition-colors'
  if (missing) {
    return (
      <span
        data-testid="analysis-issue-source-ref"
        data-source-kind={sourceRef.kind}
        data-missing="true"
        title="引用资源已不存在"
        className={`${baseClass} bg-warn/10 text-warn-700 border-warn/40 line-through opacity-70 cursor-not-allowed`}
      >
        <span aria-hidden>⚠️</span>
        <span>{label}</span>
      </span>
    )
  }
  return (
    <button
      type="button"
      data-testid="analysis-issue-source-ref"
      data-source-kind={sourceRef.kind}
      data-missing="false"
      onClick={onClick}
      title="点击定位文档"
      className={`${baseClass} bg-brand-50/40 text-brand-700 border-brand/40 hover:bg-brand-50 hover:border-brand cursor-pointer`}
    >
      <span aria-hidden>{kindToIcon(sourceRef.kind)}</span>
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function kindToIcon(kind: SourceRef['kind']): string {
  if (kind === 'requirement') return '📄'
  if (kind === 'repository') return '📦'
  if (kind === 'aux') return '📎'
  return '🖼️'
}

function formatSourceRefLabel(ref: SourceRef): string {
  if (ref.kind === 'requirement') {
    const path = ref.relative_path
    const lr = ref.line_range
    return lr ? `${path} [${lr[0] + 1}-${lr[1]})` : path
  }
  if (ref.kind === 'repository') {
    const lr = ref.line_range
    return lr
      ? `${ref.repo_name}:${ref.relative_path} [${lr[0] + 1}-${lr[1]})`
      : `${ref.repo_name}:${ref.relative_path}`
  }
  if (ref.kind === 'aux') {
    const lr = ref.line_range
    return lr ? `${ref.aux_id} [${lr[0] + 1}-${lr[1]})` : ref.aux_id
  }
  // asset
  return ref.asset_id
}