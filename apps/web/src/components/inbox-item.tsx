import type { InboxItem as InboxItemT } from '@/app/(workspace)/data/mock';

const KIND_ICON: Record<InboxItemT['kind'], { char: string; bg: string }> = {
  question: { char: '?', bg: 'bg-warning' },
  error:    { char: '!', bg: 'bg-error' },
  todo:     { char: '☐', bg: 'bg-info' },
};

export function InboxItem({ item }: { item: InboxItemT }) {
  const ic = KIND_ICON[item.kind];
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4 grid grid-cols-[24px_1fr_auto] gap-4 items-start">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[13px] ${ic.bg}`}>{ic.char}</div>
      <div>
        <div className="text-sm text-text-3 mb-1">{item.requirementTitle} · {item.kind === 'error' ? '错误' : 'AI 提问'}</div>
        <div className="text-md leading-snug">{item.message}</div>
      </div>
      <div className="text-xs text-text-3">{item.agoMinutes < 60 ? `${item.agoMinutes} 分钟前` : `${Math.floor(item.agoMinutes / 60)} 小时前`}</div>
    </div>
  );
}