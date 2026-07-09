import type { Requirement, AIStatus } from '@/app/(workspace)/data/mock';

interface Props {
  tabs: Requirement[]; // 当前工作空间的需求集
  currentId: string | null;
  aiStatus: AIStatus;
}

const STATUS_TO_LABEL: Record<AIStatus, string> = {
  idle: '空闲',
  thinking: '思考中',
  tool_calling: '工具调用中',
  writing: '正在写入',
  awaiting_user: '等待回答',
  error: '错误',
};

export function StatusBar({ tabs, currentId, aiStatus }: Props) {
  const current = tabs.find(t => t.id === currentId);
  return (
    <header className="sticky top-0 z-50 bg-bg-elevated border-b border-border">
      <div className="flex items-center h-10 px-4 gap-0.5 overflow-x-auto">
        {tabs.map(t => (
          <div key={t.id} className={`flex items-center gap-2 h-7 px-3 text-sm rounded-md cursor-pointer whitespace-nowrap
            ${t.id === currentId ? 'bg-brand-50 text-brand-700 font-medium' : 'text-text-2 hover:bg-bg-subtle'}`}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background:
              t.status === 'implementing' ? 'var(--brand)' :
              t.status === 'clarifying' ? 'var(--warning)' :
              t.status === 'done' ? 'var(--success)' : 'var(--info)' }} />
            {t.title} · {t.status}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between h-8 px-4 border-t border-border bg-bg-subtle text-sm text-text-2">
        <div className="flex items-center gap-3">
          {current && <>
            <strong className="text-text-1 font-medium">{current.title}</strong>
            <span className="text-text-3">·</span>
            <span>{current.currentStage ?? current.status}</span>
            {current.currentTask && <>
              <span className="text-text-3">·</span>
              <span>Task #{current.currentTask}</span>
            </>}
          </>}
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              aiStatus === 'thinking' ? 'bg-brand animate-pulse' :
              aiStatus === 'tool_calling' ? 'bg-brand animate-spin' :
              aiStatus === 'error' ? 'bg-error animate-pulse' :
              'bg-text-3'
            }`} />
            {STATUS_TO_LABEL[aiStatus]}
          </span>
          <span className="text-text-3 text-xs">⌘K 命令</span>
        </div>
      </div>
    </header>
  );
}
