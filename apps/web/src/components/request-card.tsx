import Link from 'next/link';
import type { RequirementSummary } from '@ai-devspace/shared';
import { StatusBadge } from './status-badge';
import { ProgressBar } from './progress-bar';

const PROGRESS_COLOR = (status: RequirementSummary['status']): 'brand' | 'warning' | 'planning' => {
  if (status === 'clarifying') return 'warning';
  if (status === 'designing' || status === 'planning') return 'planning';
  return 'brand';
};

export function RequestCard({ requirement: r }: { requirement: RequirementSummary }) {
  return (
    <Link href={`/requirements/${r.id}`}
      className="block bg-bg-elevated border border-border rounded-lg p-4 hover:-translate-y-px hover:shadow-md hover:border-border-strong transition">
      <div className="flex items-center justify-between mb-3">
        <StatusBadge status={r.status} />
        <span className="text-text-3 text-xs">{new Date(r.updatedAt).toLocaleString('zh-CN', { hour: 'numeric', minute: 'numeric', hour12: false }) + ' 前'}</span>
      </div>
      <div className="text-md font-medium mb-2">{r.title}</div>
      <div className="flex gap-1 flex-wrap mb-3">
        {r.repos.map(repo => (
          <span key={repo} className="h-[18px] px-1.5 bg-bg-subtle rounded-sm font-mono text-xs text-text-2 flex items-center">{repo}</span>
        ))}
      </div>
      <ProgressBar percent={r.progress} color={PROGRESS_COLOR(r.status)} />
    </Link>
  );
}