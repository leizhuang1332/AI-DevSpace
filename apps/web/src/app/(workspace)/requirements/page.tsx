import Link from 'next/link';
import type { Requirement, RequirementStatus } from '@/app/(workspace)/data/mock';
import { requirements } from '@/app/(workspace)/data/mock';
import { StatusBadge } from '@/components/status-badge';

const STATUS_FILTERS: RequirementStatus[] = [
  'draft', 'analyzing', 'designing', 'planning', 'implementing', 'submitting', 'done', 'archived', 'clarifying',
];

function ago(iso: string) {
  const m = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} 分钟前`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / 60 / 24)} 天前`;
}

export default function RequirementsPage() {
  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">需求</h1>
          <div className="text-text-2 text-md mt-1">{requirements.length} 个需求 · 按更新时间倒序</div>
        </div>
        <div className="flex gap-2">
          <input className="h-8 px-3 rounded-md border border-border bg-bg-elevated text-sm" placeholder="搜索…" />
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">+ 新建需求</button>
        </div>
      </div>

      <div className="flex gap-2 mb-4 text-sm">
        {STATUS_FILTERS.map(s => (
          <button key={s} className="h-7 px-3 rounded-md bg-bg-elevated border border-border text-text-2 hover:bg-bg-subtle hover:text-text-1">
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-border border border-border rounded-lg overflow-hidden">
        {requirements.map((r: Requirement) => (
          <Link key={r.id} href={`/requirements/${r.id}`}
            className="grid grid-cols-[120px_1fr_120px_80px] items-center gap-4 h-12 px-4 hover:bg-bg-subtle text-sm">
            <StatusBadge status={r.status} />
            <div className="text-text-1 font-medium">{r.title}</div>
            <div className="flex gap-1 flex-wrap">
              {r.repos.map(p => <span key={p} className="h-[18px] px-1.5 bg-bg-subtle rounded-sm font-mono text-[11px] text-text-2 flex items-center">{p}</span>)}
            </div>
            <div className="text-xs text-text-3 text-right">{ago(r.updatedAt)}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
