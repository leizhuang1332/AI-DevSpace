'use client'

/**
 * ANALYZING 工位 · 技术概要面板(issue 19e · VS5 · ADR-0013 D8)
 *
 * 视觉对照基线:`docs/design/pages/11h-A-zone-multisession-tabs.html`
 * 顶部"📊 生成"按钮位(右对齐);本 slice 在 SessionTabs 行右侧添加主 CTA。
 *
 * 行为(对照 issue 19e 验收):
 * - [📊 生成技术概要] 按钮 brand 色 + 始终可见(verdict 任意状态都可点)
 * - 点击 → 按钮 spinner + disabled + 调 generateTechBrief
 * - 成功 → 渲染产物预览区(双 Tab:📄 Markdown / 📋 YAML)+ 文件路径 + 时间戳
 * - 失败 → 错误 toast + "已自动回滚"提示
 * - [🔄 重扫] 按钮 disabled + tooltip "VS6 待裁决面板启用"(VS6 占位)
 *
 * 设计要点:
 * - 'use client':点击 / 状态切换 / Tab 切换都是客户端交互
 * - 父级传入 preview / modulesPreview / generatedAt(RSC 注入);组件内部维护
 *   isGenerating / activeTab / error 本地状态
 * - 按钮成功后 → 不调 router.refresh;由 revalidatePath 触发父级 RSC 重读
 *   (本期通过父级 setState 立刻显示 preview + 后续 RSC 重读保持一致)
 */

import { useCallback, useState } from 'react'
import {
  generateTechBrief,
  type GenerateBriefResult,
} from '@/lib/tech-brief-actions'
import type { TechBriefModulesFile } from '@/lib/tech-brief'

export interface TechBriefPanelProps {
  requirementId: string
  sessionId: string
  /** RSC 注入的 brief 文本(若存在) */
  preview: string | null
  /** RSC 注入的 modules(若存在) */
  modulesPreview: TechBriefModulesFile | null
  /** 最近生成时间(ISO 8601) */
  generatedAt: string | null
}

type TabKey = 'brief' | 'modules'

interface LocalPreview {
  brief: string
  modules: TechBriefModulesFile
  generatedAt: string
}

export function TechBriefPanel({
  requirementId,
  sessionId,
  preview,
  modulesPreview,
  generatedAt,
}: TechBriefPanelProps) {
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('brief')
  const [error, setError] = useState<string | null>(null)
  // 客户端本地的预览(成功生成后立即显示,不依赖 SSR 重读)
  const [localPreview, setLocalPreview] = useState<LocalPreview | null>(
    preview !== null && modulesPreview !== null && generatedAt !== null
      ? { brief: preview, modules: modulesPreview, generatedAt }
      : null,
  )

  const onGenerate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result: GenerateBriefResult = await generateTechBrief(requirementId, sessionId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setLocalPreview({
        brief: result.brief,
        modules: result.modules,
        generatedAt: result.generatedAt,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败')
    } finally {
      setLoading(false)
    }
  }, [requirementId, sessionId])

  const hasPreview = localPreview !== null

  return (
    <div
      data-testid="tech-brief-panel"
      className="flex flex-col items-stretch gap-2"
    >
      <div className="flex items-center gap-3 flex-wrap">
        {loading && (
          <div
            data-testid="tech-brief-loading"
            role="status"
            aria-live="polite"
            className="text-sm text-text-2 bg-bg-subtle border border-border rounded-md px-3 py-1.5 inline-flex items-center gap-2"
          >
            <span
              data-testid="tech-brief-spinner"
              className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin"
            />
            正在生成…
          </div>
        )}
        {error && (
          <div
            data-testid="tech-brief-error"
            role="alert"
            className="text-sm text-error bg-error/10 border border-error rounded-md px-3 py-1.5"
          >
            生成失败 · 已自动回滚:{error}
          </div>
        )}
        <button
          type="button"
          data-testid="tech-brief-generate-btn"
          data-loading={loading ? 'true' : 'false'}
          onClick={onGenerate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {loading ? <>正在生成…</> : <>📊 生成技术概要</>}
        </button>
        <button
          type="button"
          data-testid="tech-brief-rescan-btn"
          disabled
          title="由待裁决面板启用(VS6)"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium bg-bg-elevated text-text-3 border border-border disabled:opacity-50"
        >
          🔄 重扫
        </button>
        {hasPreview && (
          <span
            data-testid="tech-brief-timestamp"
            className="text-xs text-text-3 font-mono"
          >
            最近生成:{formatTimestamp(localPreview!.generatedAt)}
          </span>
        )}
      </div>
      {hasPreview && (
        <div
          data-testid="tech-brief-preview"
          className="w-full border border-border rounded-md bg-bg-elevated"
        >
          <div
            data-testid="tech-brief-tabs"
            className="flex items-center gap-1 px-3 py-2 border-b border-border bg-bg-subtle"
          >
            <button
              type="button"
              data-testid="tech-brief-tab-brief"
              data-active={activeTab === 'brief' ? 'true' : 'false'}
              onClick={() => setActiveTab('brief')}
              className={`h-7 px-3 rounded-md text-sm font-medium ${
                activeTab === 'brief'
                  ? 'bg-brand text-white'
                  : 'bg-bg-elevated text-text-2 hover:bg-bg-subtle border border-border'
              }`}
            >
              📄 technical-brief.md
            </button>
            <button
              type="button"
              data-testid="tech-brief-tab-modules"
              data-active={activeTab === 'modules' ? 'true' : 'false'}
              onClick={() => setActiveTab('modules')}
              className={`h-7 px-3 rounded-md text-sm font-medium ${
                activeTab === 'modules'
                  ? 'bg-brand text-white'
                  : 'bg-bg-elevated text-text-2 hover:bg-bg-subtle border border-border'
              }`}
            >
              📋 modules.yaml
            </button>
          </div>
          {activeTab === 'brief' ? (
            <div
              data-testid="tech-brief-view-brief"
              className="p-4 prose prose-sm max-w-none text-sm font-mono whitespace-pre-wrap text-text-1"
            >
              {localPreview!.brief}
            </div>
          ) : (
            <div
              data-testid="tech-brief-view-modules"
              className="p-4 flex flex-col gap-3"
            >
              {localPreview!.modules.modules.length === 0 && (
                <div className="text-text-3 text-sm">(无模块)</div>
              )}
              {localPreview!.modules.modules.map((m) => (
                <div
                  key={m.id}
                  data-testid="tech-brief-module"
                  data-module-id={m.id}
                  data-complexity={m.complexity}
                  className="border border-border rounded-md p-3 bg-bg-elevated"
                >
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm font-semibold">{m.id}</span>
                    <span className="text-sm text-text-2">{m.name}</span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        m.complexity === 'high'
                          ? 'bg-error/10 text-error'
                          : m.complexity === 'medium'
                            ? 'bg-warning/10 text-warning'
                            : 'bg-success/10 text-success'
                      }`}
                    >
                      {m.complexity}
                    </span>
                  </div>
                  {m.description && (
                    <div className="text-sm text-text-2 mb-2">{m.description}</div>
                  )}
                  {m.deps.length > 0 && (
                    <div className="text-xs text-text-3 mb-1">
                      deps: <span className="font-mono">{m.deps.join(', ')}</span>
                    </div>
                  )}
                  {m.clarifying_questions && m.clarifying_questions.length > 0 && (
                    <ul className="text-xs text-text-2 list-disc pl-4 mt-1">
                      {m.clarifying_questions.map((q) => (
                        <li key={q.id}>
                          <span className="font-mono">{q.id}</span> · {q.question}
                          {q.options && q.options.length > 0 && (
                            <span className="text-text-3">
                              {' '}
                              (选项:{q.options.join(' / ')})
                            </span>
                          )}
                          {q.required && <span className="text-error"> *必答</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
  } catch {
    return iso
  }
}