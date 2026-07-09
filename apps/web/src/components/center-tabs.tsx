'use client';
import { useRouter, useSearchParams } from 'next/navigation';

type Tab = 'markdown' | 'diff' | 'files' | 'chat';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'markdown', label: 'Markdown', icon: '📄' },
  { key: 'diff', label: 'Diff', icon: '🔀' },
  { key: 'files', label: '文件树', icon: '📁' },
  { key: 'chat', label: '本次对话', icon: '💬' },
];

interface Props {
  defaultTab?: Tab;
}

export function CenterTabs({ defaultTab = 'markdown' }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const active = (params.get('tab') as Tab | null) ?? defaultTab;
  return (
    <div className="flex items-center h-10 px-4 gap-0.5 border-b border-border bg-bg-subtle">
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => router.replace(`?tab=${t.key}`)}
          className={`flex items-center gap-1.5 h-7 px-3 text-sm rounded-md ${
            active === t.key
              ? 'bg-bg-elevated text-text-1 font-medium shadow-sm'
              : 'text-text-2 hover:bg-bg-elevated'
          }`}
        >
          <span>{t.icon}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}