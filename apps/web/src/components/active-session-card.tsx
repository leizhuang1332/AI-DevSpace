import type { Session } from '@/app/(workspace)/data/mock';
import { AIStatusDot } from './ai-status-dot';

const ICON_BG: Record<string, string> = { default: 'bg-brand-50 text-brand-700', warn: 'bg-[#fde68a] text-[#78350f]' };
const SESSION_ICON: Record<string, { text: string; bgKey: 'default' | 'warn' }> = {
  'req-001': { text: '退', bgKey: 'default' },
  'req-002': { text: '会', bgKey: 'warn' },
};

export function ActiveSessionCard({ session }: { session: Session }) {
  const icon = SESSION_ICON[session.requirementId] ?? { text: '·', bgKey: 'default' as const };
  return (
    <div className="bg-bg-elevated border border-border rounded-lg p-4 grid grid-cols-[1fr_auto] items-center gap-4">
      <div className="flex items-center gap-4">
        <div className={`w-9 h-9 rounded-md flex items-center justify-center font-semibold text-md ${ICON_BG[icon.bgKey]}`}>{icon.text}</div>
        <div>
          <div className="text-md font-medium mb-0.5">{session.title}</div>
          <div className="flex items-center gap-3 text-sm text-text-2">
            <AIStatusDot status={session.aiStatus} showLabel />
            <span className="w-1.25 h-1.25 rounded-full bg-text-3" />
            <span>{session.currentTask}</span>
            {session.filesRead != null && <>
              <span className="w-1.25 h-1.25 rounded-full bg-text-3" />
              <span>已读取 {session.filesRead} 个文件</span>
            </>}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">查看对话</button>
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">打开 IDEA</button>
        <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">查看 Diff</button>
        <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">▶ 继续</button>
      </div>
    </div>
  );
}