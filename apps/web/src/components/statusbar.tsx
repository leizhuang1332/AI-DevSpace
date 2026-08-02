'use client';

import { usePathname } from 'next/navigation';
import type { RequirementSummary } from '@ai-devspace/shared';
import { STATUS_DOT } from './status-badge';

interface Props {
  tabs: RequirementSummary[]; // 当前工作空间的需求集
  currentId: string | null;
}

/**
 * StatusBar(issue 08 · ADR-0021 收缩)
 *
 * 旧版本曾订阅 SSE `analysis_chunk` 事件触发 snapshot 列表刷新,提供"↶ 回滚"
 * 入口对接 `/api/requirements/:id/analysis/snapshots` 与 `/restore`。这些端点
 * 与 `analysis-snapshot.ts` / `analysis.ts` 已随 issue 08 整体删除 —— 双 turn
 * 模型不再有效,Analysis Run 失败可由用户直接发起新 Run,不需要 turn-bounded
 * snapshot 兜底。
 *
 * 本组件现在只剩需求 Tab 列表渲染职责;回滚 / snapshot 相关字段、状态、effect
 * 与按钮全部移除。
 */
export function StatusBar({ tabs, currentId }: Props) {
  void usePathname();
  return (
    <header className="sticky top-0 z-50 bg-bg-elevated border-b border-border">
      <div className="flex items-center h-10 px-4 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-2 h-7 px-3 text-sm rounded-md cursor-pointer whitespace-nowrap
              ${t.id === currentId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-2 hover:bg-bg-subtle'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[t.status] }} />
            {t.title} · {t.status}
          </div>
        ))}
      </div>
    </header>
  );
}