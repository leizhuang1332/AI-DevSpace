'use client';

import type { WrapupTreeSummary } from '@/lib/wrapup';

interface Props {
  requirementId: string;
  /**
   * WRAP-UP 工位专用(issue 22):产物 / PR / 决策摘要(由父组件从 WrapupData 派生)。
   * 传入时,资源树切换到"回顾摘要"视图:产物清单 / PR / 决策 3 个 section。
   */
  wrapupSummary?: WrapupTreeSummary;
}

type TreeNode = {
  icon: string;
  label: string;
  status?: string;
  href?: string;
};

type TreeSection = {
  label: string;
  nodes: TreeNode[];
};

const TREE_SECTIONS: TreeSection[] = [
  {
    label: '概览',
    nodes: [
      { icon: '📋', label: '需求文档', href: '' },
      { icon: '📊', label: '进度概览', href: '?progress' },
    ],
  },
  {
    label: '设计',
    nodes: [
      { icon: '🗄️', label: '01-database', status: 'success' },
      { icon: '🔌', label: '02-api', status: 'success' },
      { icon: '⚙️', label: '03-service', status: 'planning' },
    ],
  },
  {
    label: '计划',
    nodes: [{ icon: '📝', label: 'tasks.md' }],
  },
  {
    label: '产物',
    nodes: [
      { icon: '📄', label: 'refund.sql', status: 'success' },
      { icon: '📄', label: 'refund-api.yaml', status: 'success' },
      { icon: '📄', label: 'apollo.yaml', status: 'warning' },
    ],
  },
  {
    label: '对话',
    nodes: [
      { icon: '💬', label: '001-analyze', status: 'success' },
      { icon: '💬', label: '002-design', status: 'success' },
      { icon: '💬', label: '003-code', status: 'active' },
    ],
  },
  {
    label: '仓库',
    nodes: [
      { icon: '📦', label: 'refund-service' },
      { icon: '📦', label: 'order-service' },
    ],
  },
];

const STATUS_COLOR: Record<string, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  planning: '#a5b4fc',
  active: 'var(--brand)',
};

/**
 * 资源树。
 *
 * - WRAP-UP 工位:显示回顾摘要(产物 / PR / 决策,issue 22)
 * - 其它工位(含 EXECUTING):回退到 TREE_SECTIONS 默认静态结构,匹配 prototype
 *
 * 注意(issue 01 后):DRAFTING 工位不再渲染资源树 —— 该工位的 has_resource_tree
 * 已切换为 false,ZoneShell 不会挂载本组件;DRAFTING 的 PRD 章节大纲改由主区顶部
 * 锚点栏(issue 03)+ Inline 栏(候命 Skill)承载。
 */
export function ResourceTree({ requirementId, wrapupSummary }: Props) {
  if (wrapupSummary) {
    return (
      <aside
        data-testid="resource-tree"
        data-tree-mode="wrapup-summary"
        data-requirement-id={requirementId}
        className="bg-bg-elevated border-r border-border py-3 overflow-auto"
      >
        <WrapupSummaryTreeView summary={wrapupSummary} />
      </aside>
    );
  }

  return (
    <aside
      data-testid="resource-tree"
      data-tree-mode="default"
      data-requirement-id={requirementId}
      className="bg-bg-elevated border-r border-border py-3 overflow-auto"
    >
      {TREE_SECTIONS.map((section) => (
        <div key={section.label} className="px-3 mb-4">
          <div className="flex items-center justify-between px-2 py-2 text-xs uppercase tracking-wider text-text-3 font-medium">
            <span>{section.label}</span>
            <span className="cursor-pointer">+</span>
          </div>
          {section.nodes.map((node) => (
            <div
              key={node.label}
              className="flex items-center gap-2 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle hover:text-text-1 cursor-pointer"
            >
              <span className="text-sm w-4 text-center text-text-3">{node.icon}</span>
              <span>{node.label}</span>
              {node.status && (
                <span
                  className="ml-auto w-1.5 h-1.5 rounded-full"
                  style={{ background: STATUS_COLOR[node.status] }}
                />
              )}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

// ============================================================================
// WRAP-UP 专用视图:回顾摘要(issue 22 · ADR-0011 §5 R2 资源树按工位)
// ============================================================================

const WRAPUP_STATUS_COLOR: Record<'ok' | 'warn', string> = {
  ok: 'var(--success)',
  warn: 'var(--warning)',
};

/**
 * WRAP-UP 工位资源树展示。
 *
 * 3 个 section:
 * - 产物清单(N 条):文件名 + 状态点(ok/warn)
 * - 关联 PR(N 条):commit sha 短码 + 标题(截断)
 * - 关键决策回顾(N 条):Q-id + 提问(截断)
 *
 * 与主区 WrapupZone 保持同步:由 WrapupZone → page.tsx → ZoneShell → ResourceTree
 * 派生并透传,本组件纯渲染。
 */
function WrapupSummaryTreeView({ summary }: { summary: WrapupTreeSummary }) {
  return (
    <div
      data-testid="resource-tree-wrapup-summary"
      data-artifact-count={String(summary.artifactCount)}
      data-pr-count={String(summary.prCount)}
      data-decision-count={String(summary.decisionCount)}
      className="px-3"
    >
      <div className="px-2 py-2 text-xs uppercase tracking-wider text-[#15803d] font-medium flex items-center justify-between">
        <span>回顾摘要</span>
        <span className="font-mono text-text-3 text-[10px]">
          {summary.artifactCount + summary.prCount + summary.decisionCount}
        </span>
      </div>

      {/* 产物清单 */}
      <WrapupTreeSection
        testId="resource-tree-wrapup-artifacts"
        label="产物清单"
        count={summary.artifactCount}
      >
        {summary.artifacts.length === 0 ? (
          <p className="px-2 py-2 text-xs text-text-3">暂无产物</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {summary.artifacts.map((a) => (
              <li
                key={a.id}
                data-testid="resource-tree-wrapup-artifact-item"
                data-artifact-id={a.id}
                data-status={a.status}
                className="flex items-center gap-2 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle cursor-pointer"
              >
                <span className="text-sm w-4 text-center text-text-3">📄</span>
                <span className="truncate flex-1">{a.name}</span>
                <span
                  aria-hidden
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: WRAPUP_STATUS_COLOR[a.status] }}
                />
              </li>
            ))}
          </ul>
        )}
      </WrapupTreeSection>

      {/* 关联 PR/Commit */}
      <WrapupTreeSection
        testId="resource-tree-wrapup-prs"
        label="关联 PR"
        count={summary.prCount}
      >
        {summary.prs.length === 0 ? (
          <p className="px-2 py-2 text-xs text-text-3">暂无 PR</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {summary.prs.map((p) => (
              <li
                key={p.sha}
                data-testid="resource-tree-wrapup-pr-item"
                data-sha={p.sha}
                className="flex items-center gap-2 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle cursor-pointer"
              >
                <span className="text-sm w-4 text-center text-text-3">📤</span>
                <span className="font-mono text-xs text-text-3 shrink-0">
                  {p.sha.slice(0, 7)}
                </span>
                <span className="truncate">{p.title}</span>
              </li>
            ))}
          </ul>
        )}
      </WrapupTreeSection>

      {/* 关键决策回顾 */}
      <WrapupTreeSection
        testId="resource-tree-wrapup-decisions"
        label="决策回顾"
        count={summary.decisionCount}
      >
        {summary.decisions.length === 0 ? (
          <p className="px-2 py-2 text-xs text-text-3">暂无决策记录</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {summary.decisions.map((d) => (
              <li
                key={d.id}
                data-testid="resource-tree-wrapup-decision-item"
                data-decision-id={d.id}
                className="flex items-center gap-2 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle cursor-pointer"
              >
                <span className="font-mono text-[10px] text-brand-600 bg-brand-50 px-1 rounded shrink-0">
                  {d.id}
                </span>
                <span className="truncate">{d.question}</span>
              </li>
            ))}
          </ul>
        )}
      </WrapupTreeSection>
    </div>
  );
}

function WrapupTreeSection({
  testId,
  label,
  count,
  children,
}: {
  testId: string
  label: string
  count: number
  children: React.ReactNode
}) {
  return (
    <div data-testid={testId} data-count={String(count)} className="mb-3">
      <div className="flex items-center justify-between px-2 py-2 text-xs uppercase tracking-wider text-text-3 font-medium">
        <span>{label}</span>
        <span
          data-testid={`${testId}-count`}
          className="font-mono text-text-3 text-[10px]"
        >
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}