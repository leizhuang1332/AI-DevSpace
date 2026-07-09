'use client';
import { useState } from 'react';

interface Props {
  requirementId: string;
}

interface RailCard {
  type: 'tip' | 'warn' | 'err' | 'plain';
  title: string;
  body: React.ReactNode;
  action?: string;
}

const CARDS_BY_REQ: Record<string, RailCard[]> = {
  'req-001': [
    {
      type: 'tip',
      title: '✨ 缺索引建议',
      body: (
        <>
          检测到 <code className="font-mono">WHERE user_id + status</code> 查询无合适索引,建议在{' '}
          <code className="font-mono">refund_order</code> 表加{' '}
          <code className="font-mono">idx_user_status_created</code>
        </>
      ),
      action: '应用建议 →',
    },
    {
      type: 'warn',
      title: '⚠ 待回答',
      body: '退款失败时是否要回滚已扣减的优惠券额度?',
      action: '⌘K 去回答 →',
    },
    {
      type: 'plain',
      title: '📊 进度',
      body: '设计阶段 100% · 计划阶段 100% · 实施阶段 62% (12/19 tasks)',
    },
    {
      type: 'err',
      title: '🚨 Skill 阻塞',
      body: 'code-stage 等待 3 个澄清问题的回复',
    },
  ],
};

const BORDER_COLOR: Record<RailCard['type'], string> = {
  tip: 'var(--brand)',
  warn: 'var(--warning)',
  err: 'var(--error)',
  plain: 'var(--border)',
};

export function InlineRail({ requirementId }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const cards = CARDS_BY_REQ[requirementId] ?? [];

  if (collapsed) {
    return (
      <aside className="bg-bg-subtle border-l border-border p-3 w-12 flex flex-col items-center">
        <button
          onClick={() => setCollapsed(false)}
          className="text-text-3 hover:text-text-1 text-xs"
          aria-label="展开 AI 提示栏"
        >
          ⟩
        </button>
      </aside>
    );
  }

  return (
    <aside className="bg-bg-subtle border-l border-border p-3 overflow-auto w-60">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-text-3 font-medium">AI 提示</span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-text-3 text-xs hover:text-text-1"
          aria-label="折叠 AI 提示栏"
        >
          ⟨ 折叠
        </button>
      </div>
      {cards.map((c, i) => (
        <div
          key={i}
          className="bg-bg-elevated rounded-md p-3 mb-2 text-sm relative"
          style={{ borderLeft: `3px solid ${BORDER_COLOR[c.type]}` }}
        >
          <div className="font-medium mb-1">{c.title}</div>
          <div className="text-text-2 leading-relaxed">{c.body}</div>
          {c.action && (
            <button className="mt-2 text-xs text-brand-600 hover:underline">{c.action}</button>
          )}
        </div>
      ))}
    </aside>
  );
}