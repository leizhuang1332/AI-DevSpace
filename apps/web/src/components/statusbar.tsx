import type { Requirement } from '@/app/(workspace)/data/mock';
import { STATUS_DOT } from './status-badge';

interface Props {
  tabs: Requirement[]; // 当前工作空间的需求集
  currentId: string | null;
}

export function StatusBar({ tabs, currentId }: Props) {
  return (
    <header className="sticky top-0 z-50 bg-bg-elevated border-b border-border">
      <div className="flex items-center h-10 px-4 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <div key={t.id} className={`flex items-center gap-2 h-7 px-3 text-sm rounded-md cursor-pointer whitespace-nowrap
            ${t.id === currentId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-2 hover:bg-bg-subtle'}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: STATUS_DOT[t.status] }} />
            {t.title} · {t.status}
          </div>
        ))}
      </div>
    </header>
  );
}
