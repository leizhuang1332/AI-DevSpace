'use client';

import type { PrdSection } from '@/lib/drafting';
import type { WrapupTreeSummary } from '@/lib/wrapup';

interface Props {
  requirementId: string;
  /**
   * DRAFTING 工位专用:PRD 章节大纲(由父组件 server 端预解析后传入)。
   * 传入时,资源树顶部展示"PRD 大纲"section,覆盖默认的"概览 / 设计 / 计划 / 产物 / 对话"等静态 sections。
   */
  prdSections?: PrdSection[];
  /**
   * WRAP-UP 工位专用(issue 22):产物 / PR / 决策摘要(由父组件从 WrapupData 派生)。
   * 传入时,资源树切换到"回顾摘要"视图:产物清单 / PR / 决策 3 个 section。
   * 优先级:wrapupSummary 存在时优先于 prdSections(避免两个特殊视图同时显示)。
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
 * - DRAFTING 工位:显示 PRD 章节大纲(从父组件 server 端预解析的 PrdSection[]),
 *   节点点击由 host(ZoneShell 父级)消费(本期 mock,只展示)。
 * - 其它工位:回退到 TREE_SECTIONS 默认静态结构,匹配 prototype。
 */
export function ResourceTree({ requirementId, prdSections, wrapupSummary }: Props) {
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

  if (prdSections) {
    return (
      <aside
        data-testid="resource-tree"
        data-tree-mode="drafting-prd"
        data-requirement-id={requirementId}
        data-section-count={prdSections.length}
        className="bg-bg-elevated border-r border-border py-3 overflow-auto"
      >
        <DraftingPrdTreeView sections={prdSections} />
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
// DRAFTING 专用视图:PRD 章节大纲(issue 18 · ADR-0011 §5 R2 资源树按工位)
// ============================================================================

const LEVEL_INDENT: Record<number, string> = {
  1: 'pl-2',
  2: 'pl-5',
  3: 'pl-8',
};

const LEVEL_PREFIX: Record<number, string> = {
  1: 'H1',
  2: 'H2',
  3: 'H3',
};

function DraftingPrdTreeView({ sections }: { sections: PrdSection[] }) {
  return (
    <div
      data-testid="resource-tree-drafting-prd"
      className="px-3"
    >
      <div className="flex items-center justify-between px-2 py-2 text-xs uppercase tracking-wider text-brand-600 font-medium">
        <span>PRD 章节大纲</span>
        <span
          data-testid="resource-tree-drafting-prd-count"
          data-count={sections.length}
          className="px-1.5 py-px rounded-sm bg-brand-50 text-brand-600 font-mono"
        >
          {sections.length}
        </span>
      </div>
      {sections.length === 0 ? (
        <p
          data-testid="resource-tree-drafting-prd-empty"
          className="px-2 py-3 text-xs text-text-3"
        >
          PRD 暂无 H1/H2/H3 标题。
          在主区编辑器中用 <code className="font-mono"># / ## / ###</code> 添加章节,
          资源树会实时同步。
        </p>
      ) : (
        <ul
          data-testid="resource-tree-drafting-prd-list"
          className="flex flex-col gap-0.5"
        >
          {sections.map((s, i) => (
            <li
              key={`${s.line}-${s.title}`}
              data-testid="resource-tree-drafting-prd-item"
              data-level={s.level}
              data-line={s.line}
              className={[
                'flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-text-2 hover:bg-bg-subtle cursor-pointer',
                LEVEL_INDENT[s.level] ?? 'pl-2',
              ].join(' ')}
            >
              <span className="font-mono text-[10px] text-text-3 w-6 shrink-0">
                {LEVEL_PREFIX[s.level] ?? `H${s.level}`}
              </span>
              <span className="truncate">{s.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
