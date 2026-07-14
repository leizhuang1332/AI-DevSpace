import { DraftingPrdPane } from './drafting-prd-pane'
import type { DraftingData } from '@/lib/drafting'

/**
 * DRAFTING 工位组件(ADR-0011 §6 DRAFTING 布局 · issue 02)
 *
 * 视觉对照基线:[docs/design/pages/19-final-drafting.html](docs/design/pages/19-final-drafting.html)
 * 的"PRD 顶置"区域;其他区域(锚点条 / 辅助材料卡片 / 仓库底部条)由后续
 * issue 03 / 04 / 08 引入,本期不渲染。
 *
 * 布局(由 ZoneShell 提供右栏 Inline 栏,这里只渲染主区 PRD 卡片):
 * ┌────────────────────────────────────────────────┐
 * │ Toolbar(面包屑 + 自动保存状态)                  │
 * ├────────────────────────────────────────────────┤
 * │ 主区:PRD 卡片(单列)                              │
 * │  - 标题 input                                     │
 * │  - PRD Markdown 编辑器                            │
 * │  - 底部单一动作 [▶ 进入 ANALYZING]              │
 * └────────────────────────────────────────────────┘
 *
 * 数据全部由 props 注入;交互逻辑委托给 DraftingPrdPane('use client')。
 * Inline 栏(候命 Skill)由 ZoneShell 通过 inlineRailSlot 注入 DraftingSkillRail。
 *
 * 设计要点(与 issue 18 形态的差异):
 * - 删除:AC 结构化 checklist / 关联仓库多选 / [💾 保存草稿] 按钮 / 旧"创建并启动
 *   AI 分析"按钮 → 全部被新 PRD 卡片 + 自动保存 + [▶ 进入 ANALYZING] 取代
 * - 顶部 toolbar 保留(面包屑导航一致性);状态文本保留但已无内容指示价值
 * - 主区 1 列 + 右侧 Inline 栏(继承 issue 01:不再渲染左 240px 资源树)
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
        <div className="max-w-[1080px] mx-auto h-full flex flex-col">
          <DraftingPrdPane data={data} />
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
            data-testid={
              c.current ? 'drafting-crumb-current' : 'drafting-crumb-item'
            }
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
      </div>
    </div>
  )
}