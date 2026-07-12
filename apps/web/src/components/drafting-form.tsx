'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  extractPrdOutline,
  validateDraftingForm,
  type AcceptanceCriterion,
  type DraftingAction,
  type DraftingData,
  type DraftingRepo,
} from '@/lib/drafting'

/**
 * DRAFTING 工位的交互表单(issue 18)。
 *
 * 与 EXECUTING 工位的差异:DRAFTING 主要是用户主动**创作**而非观察 AI,
 * 因此需要交互式表单(标题 / PRD / AC 增删 / 仓库多选 / 自动保存 / 提交)。
 *
 * 设计要点:
 * - 受控组件:title / prdMarkdown / acceptanceCriteria / repos 全部 useState
 * - 自动保存:setInterval 周期写入 meta.yaml + PRD(本期 mock,只更新 UI 状态)
 * - PRD 大纲实时派生:extractPrdOutline(prdMarkdown) → 资源树展示
 * - 按钮交互:[💾 保存草稿] / [🚀 创建并启动 AI 分析] 触发不同 action
 *   - launch → 跳到 ANALYZING 工位路由(本期 mock,直接 router.push)
 */
export interface DraftingFormProps {
  data: DraftingData
}

export function DraftingForm({ data }: DraftingFormProps) {
  const router = useRouter()

  // -------------------------------------------------------------------------
  // 受控状态
  // -------------------------------------------------------------------------
  const [title, setTitle] = useState(data.title)
  const [prdMarkdown, setPrdMarkdown] = useState(data.prdMarkdown)
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<AcceptanceCriterion[]>(
    data.acceptanceCriteria,
  )
  const [repos, setRepos] = useState<DraftingRepo[]>(data.repos)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(data.lastSavedAt)
  const [previewing, setPreviewing] = useState(false)

  // -------------------------------------------------------------------------
  // 派生:大纲、校验
  // -------------------------------------------------------------------------
  const prdOutline = useMemo(() => extractPrdOutline(prdMarkdown), [prdMarkdown])
  const validity = useMemo(
    () => validateDraftingForm({ title, prdMarkdown, acceptanceCriteria }),
    [title, prdMarkdown, acceptanceCriteria],
  )

  // -------------------------------------------------------------------------
  // 自动保存(每 N ms;本期只更新 UI 时间戳,mock 写)
  // -------------------------------------------------------------------------
  const saveDraft = useCallback(() => {
    // mock:实际项目会 POST 到 /api/requirements/<id>/draft 保存 meta.yaml + PRD
    setLastSavedAt(new Date().toISOString())
  }, [])

  useEffect(() => {
    const intervalMs = data.autosaveIntervalMs
    if (intervalMs <= 0) return
    const id = window.setInterval(() => {
      // 仅在表单有内容时才自动保存
      if (title.trim() || prdMarkdown.trim()) {
        saveDraft()
      }
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [data.autosaveIntervalMs, title, prdMarkdown, saveDraft])

  // -------------------------------------------------------------------------
  // 交互:AC 增删改
  // -------------------------------------------------------------------------
  const addAc = useCallback(() => {
    // id 用 crypto.randomUUID 避免删除中间项后再添加时撞 id
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `ac-${crypto.randomUUID()}`
        : `ac-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    setAcceptanceCriteria((prev) => [
      ...prev,
      { id, text: '', checked: false },
    ])
  }, [])

  const updateAc = useCallback((id: string, patch: Partial<AcceptanceCriterion>) => {
    setAcceptanceCriteria((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    )
  }, [])

  const removeAc = useCallback((id: string) => {
    setAcceptanceCriteria((prev) => prev.filter((a) => a.id !== id))
  }, [])

  // -------------------------------------------------------------------------
  // 交互:仓库多选
  // -------------------------------------------------------------------------
  const toggleRepo = useCallback((name: string) => {
    setRepos((prev) =>
      prev.map((r) => (r.name === name ? { ...r, selected: !r.selected } : r)),
    )
  }, [])

  // -------------------------------------------------------------------------
  // 交互:底部动作
  // -------------------------------------------------------------------------
  const handleAction = useCallback(
    (action: DraftingAction) => {
      if (action.id === 'save') {
        saveDraft()
        return
      }
      if (action.id === 'launch') {
        if (!validity.canSubmit) return
        saveDraft()
        router.push(`/requirements/${data.requirementId}/analyzing/`)
      }
    },
    [saveDraft, validity.canSubmit, router, data.requirementId],
  )

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------
  return (
    <form
      data-testid="drafting-form"
      data-requirement-id={data.requirementId}
      onSubmit={(e) => e.preventDefault()}
      className="bg-bg-elevated border border-border rounded-xl shadow-md p-6"
    >
      {/* 表单标题 */}
      <header
        data-testid="drafting-form-head"
        className="mb-5 border-b border-border pb-4"
      >
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span aria-hidden>📝</span>
          <span>{data.empty ? '新建需求' : '编辑需求'}</span>
        </h2>
        <p className="text-text-3 text-sm mt-1.5">
          填写 PRD 与验收标准 —— 提交后 AI 将据此进入「分析 → 澄清」阶段
        </p>
      </header>

      {/* 标题 */}
      <Field label="标题" required>
        <input
          type="text"
          data-testid="drafting-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="一句话描述这个需求(如:退款功能优化)"
          className="w-full h-10 px-3 border border-border-strong rounded-md text-md bg-bg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-50"
        />
      </Field>

      {/* PRD Markdown */}
      <Field label="PRD（Markdown）" required>
        <div
          data-testid="drafting-editor"
          className="border border-border-strong rounded-md overflow-hidden"
        >
          <div
            data-testid="drafting-editor-toolbar"
            className="flex items-center gap-3 px-3 py-1.5 bg-bg-subtle border-b border-border text-sm text-text-3"
          >
            <b>B</b>
            <b>
              <i>I</i>
            </b>
            <b>H1</b>
            <b>&lt;/&gt;</b>
            <span>· 列表</span>
            <span className="ml-auto font-mono text-xs flex items-center gap-3">
              <span data-testid="drafting-markdown-chars" data-chars={prdMarkdown.length}>
                {prdMarkdown.length} chars
              </span>
              <button
                type="button"
                data-testid="drafting-preview-toggle"
                data-active={previewing ? 'true' : 'false'}
                onClick={() => setPreviewing((p) => !p)}
                className={[
                  'h-6 px-2 rounded-sm text-xs',
                  previewing
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-text-2 hover:bg-bg-elevated',
                ].join(' ')}
                aria-pressed={previewing}
              >
                {previewing ? '✏️ 编辑' : '👁 预览'}
              </button>
            </span>
          </div>
          {previewing ? (
            <PrdPreview markdown={prdMarkdown} />
          ) : (
            <textarea
              data-testid="drafting-prd"
              value={prdMarkdown}
              onChange={(e) => setPrdMarkdown(e.target.value)}
              placeholder="# 需求标题\n\n## 背景\n...\n\n## 目标\n...\n\n## 验收标准\n- [ ] ..."
              className="w-full min-h-[190px] border-none p-3 font-mono text-sm leading-relaxed text-text-1 bg-bg-elevated resize-y focus:outline-none"
            />
          )}
        </div>
      </Field>

      {/* AC 结构化 checklist */}
      <Field
        label="验收标准（AC · 结构化）"
        hint="资源树会按章节大纲实时同步 PRD 标题层级"
      >
        <div data-testid="drafting-ac" className="flex flex-col gap-2">
          {acceptanceCriteria.length === 0 ? (
            <p className="text-text-3 text-sm">尚无 AC,点击下方添加</p>
          ) : (
            acceptanceCriteria.map((ac) => (
              <AcItem
                key={ac.id}
                ac={ac}
                onToggle={() => updateAc(ac.id, { checked: !ac.checked })}
                onTextChange={(text) => updateAc(ac.id, { text })}
                onRemove={() => removeAc(ac.id)}
              />
            ))
          )}
          <button
            type="button"
            data-testid="drafting-ac-add"
            onClick={addAc}
            className="self-start text-sm text-brand-600 font-medium py-1 hover:underline"
          >
            ＋ 添加验收标准
          </button>
        </div>
      </Field>

      {/* 关联仓库多选 */}
      <Field label="关联仓库（多选）">
        <div
          data-testid="drafting-repos"
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="关联仓库"
        >
          {repos.length === 0 ? (
            <p className="text-text-3 text-sm">暂无仓库可关联</p>
          ) : (
            repos.map((r) => (
              <RepoChip key={r.name} repo={r} onToggle={() => toggleRepo(r.name)} />
            ))
          )}
        </div>
      </Field>

      {/* 底部操作 */}
      <footer
        data-testid="drafting-form-foot"
        className="flex items-center gap-2 border-t border-border pt-4 mt-2"
      >
        <button
          type="button"
          className="h-8 px-3 text-sm text-text-2 hover:text-text-1 hover:bg-bg-subtle rounded-md"
          onClick={() => router.back()}
          data-testid="drafting-action-cancel"
        >
          取消
        </button>
        <span className="flex-1" />
        {validity.missing.length > 0 && (
          <span
            data-testid="drafting-form-missing"
            className="text-xs text-text-3"
            data-missing={validity.missing.join(',')}
          >
            缺少 {validity.missing.length} 项必填
          </span>
        )}
        {lastSavedAt && (
          <span
            data-testid="drafting-autosaved"
            data-saved-at={lastSavedAt}
            className="text-xs text-text-3 font-mono"
          >
            已自动保存 · {formatRelativeTime(lastSavedAt)}
          </span>
        )}
        {data.actions.map((a) => (
          <button
            key={a.id}
            type="button"
            data-testid={a.testId}
            data-variant={a.variant}
            disabled={a.id === 'launch' && !validity.canSubmit}
            onClick={() => handleAction(a)}
            className={[
              'inline-flex items-center gap-1.5 rounded-md text-sm font-medium',
              a.variant === 'primary'
                ? 'h-10 px-5 bg-brand text-white hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed'
                : 'h-8 px-3 bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle',
            ].join(' ')}
          >
            {a.label}
          </button>
        ))}
      </footer>
    </form>
  )
}

// ============================================================================
// 子组件
// ============================================================================

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div data-testid="drafting-field" data-field-label={label} className="mb-5">
      <label className="block text-sm font-semibold text-text-2 mb-2">
        {label}
        {required && (
          <span aria-label="必填" className="text-error ml-1">
            *
          </span>
        )}
      </label>
      {children}
      {hint && <p className="text-xs text-text-3 mt-1">{hint}</p>}
    </div>
  )
}

function AcItem({
  ac,
  onToggle,
  onTextChange,
  onRemove,
}: {
  ac: AcceptanceCriterion
  onToggle: () => void
  onTextChange: (text: string) => void
  onRemove: () => void
}) {
  return (
    <div
      data-testid="drafting-ac-item"
      data-ac-id={ac.id}
      data-checked={ac.checked ? 'true' : 'false'}
      className="flex items-center gap-2"
    >
      <button
        type="button"
        data-testid="drafting-ac-toggle"
        onClick={onToggle}
        aria-pressed={ac.checked}
        className={[
          'w-[18px] text-center text-base',
          ac.checked ? 'text-brand' : 'text-text-3',
        ].join(' ')}
      >
        {ac.checked ? '☑' : '☐'}
      </button>
      <input
        type="text"
        data-testid="drafting-ac-input"
        value={ac.text}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="可量化的验收标准(如:退款成功率 ≥ 99%)"
        className="flex-1 h-8 px-3 border border-border-strong rounded-md text-sm bg-bg focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand-50"
      />
      <button
        type="button"
        data-testid="drafting-ac-remove"
        onClick={onRemove}
        aria-label="删除该 AC"
        className="h-7 w-7 text-text-3 hover:text-error rounded-md hover:bg-bg-subtle"
      >
        ✕
      </button>
    </div>
  )
}

function RepoChip({
  repo,
  onToggle,
}: {
  repo: DraftingRepo
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`drafting-repo-chip-${repo.name}`}
      data-repo={repo.name}
      data-selected={repo.selected ? 'true' : 'false'}
      onClick={onToggle}
      aria-pressed={repo.selected}
      className={[
        'inline-flex items-center gap-1 h-8 px-3 rounded-full text-sm border',
        repo.selected
          ? 'bg-brand-50 border-brand text-brand-700 font-medium'
          : 'bg-bg border-border-strong text-text-2 hover:bg-bg-subtle',
      ].join(' ')}
    >
      {repo.selected ? '✓' : '＋'}
      <span aria-hidden>{repo.icon ?? '📦'}</span>
      <span>{repo.name}</span>
    </button>
  )
}

/**
 * PRD 预览(本期简化:不做完整 Markdown 渲染,只展示原文 + 行数 / 章节数)。
 * 后续接入 react-markdown 或 marked 时只需替换此处。
 */
function PrdPreview({ markdown }: { markdown: string }) {
  const outline = useMemo(() => extractPrdOutline(markdown), [markdown])
  return (
    <div
      data-testid="drafting-preview"
      className="p-3 font-mono text-xs leading-relaxed bg-bg-elevated min-h-[190px]"
    >
      <div className="text-text-3 mb-2">
        共 {outline.length} 个章节 · {markdown.length} 字符
      </div>
      {outline.length === 0 ? (
        <p className="text-text-3">暂无标题层级</p>
      ) : (
        <ol className="list-decimal pl-5 space-y-0.5 text-text-2">
          {outline.map((s, i) => (
            <li key={`${s.title}-${i}`} data-testid="drafting-preview-section" data-level={s.level}>
              {repeat('  ', s.level - 1)}H{s.level} {s.title}
            </li>
          ))}
        </ol>
      )}
      <p className="text-text-3 mt-3">（本期为简化预览 · 完整 Markdown 渲染后续接入）</p>
    </div>
  )
}

// ============================================================================
// 工具
// ============================================================================

function repeat(s: string, n: number): string {
  return s.repeat(Math.max(0, n))
}

/**
 * 简单的"x 秒前 / x 分钟前"格式化。
 * mock 用,实际项目可替换为 dayjs / date-fns。
 */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (diff < 0) return '刚刚'
  if (diff < 5_000) return '刚刚'
  if (diff < 60_000) return `${Math.round(diff / 1000)} 秒前`
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`
  return new Date(iso).toLocaleTimeString()
}