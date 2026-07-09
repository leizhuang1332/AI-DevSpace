'use client';

interface Props {
  requirementId: string;
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

export function ResourceTree({ requirementId }: Props) {
  return (
    <aside className="bg-bg-elevated border-r border-border py-3 overflow-auto">
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