import { DraftingForm } from './drafting-form'
import type { DraftingData } from '@/lib/drafting'

/**
 * DRAFTING 工位组件(ADR-0011 §6 DRAFTING 布局 · issue 18)
 *
 * 视觉对照基线:[11a-stage-adaptive-draft.html](../../../../docs/design/pages/11a-stage-adaptive-draft.html)
 *
 * 布局(由 ZoneShell 提供资源树 + Inline 栏,这里只渲染主区 Form):
 * ┌────────────────────────────────────────────────┐
 * │ Toolbar(面包屑 + 自动保存状态)                  │
 * ├────────────────────────────────────────────────┤
 * │ Form 居中(760px)                                │
 * │  - 标题                                          │
 * │  - PRD Markdown                                  │
 * │  - AC 结构化 checklist                           │
 * │  - 关联仓库多选                                  │
 * │  - 底部动作 [💾 保存草稿] [🚀 创建并启动 AI]   │
 * └────────────────────────────────────────────────┘
 *
 * 数据全部由 props 注入;交互逻辑委托给 DraftingForm('use client')。
 * 资源树 / Inline 栏的 DRAFTING 视图由 ZoneShell 通过 zone.has_resource_tree
 * / zone.has_inline_rail 决定是否渲染(资源树:PRD 大纲;Inline 栏:候命 Skill)。
 *
 * 设计要点(与 EXECUTING 样板的差异):
 * - 顶部 toolbar 没有 stage strip —— DRAFTING 没有"任务进度",只有状态文本
 * - Form 居中布局:max-w-[760px] mx-auto(对齐原型 .form 样式)
 * - 主区无 overflow 滚动条(表单自管理滚动;与 EXECUTING 整页滚动不同)
 */
export function DraftingZone({ data }: { data: DraftingData }) {
  return (
    <main
      data-testid="drafting-zone"
      data-requirement-id={data.requirementId}
      data-empty={data.empty ? 'true' : 'false'}
      className="flex flex-col h-full overflow-hidden bg-bg"
    >
      <DraftingToolbar toolbar={data.toolbar} />
      <div
        data-testid="drafting-main"
        className="flex-1 overflow-auto p-6 bg-bg"
      >
        <div className="max-w-[760px] mx-auto">
          <DraftingForm data={data} />
        </div>
      </div>
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
            data-testid={c.current ? 'drafting-crumb-current' : 'drafting-crumb-item'}
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
        <span className="font-mono text-xs text-text-3">
          形态:📝 Form
        </span>
      </div>
    </div>
  )
}