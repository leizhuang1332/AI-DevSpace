import { requirements, sessions, inbox } from '@/app/(workspace)/data/mock';
import { StatCard } from '@/components/stat-card';
import { RequestCard } from '@/components/request-card';
import { ActiveSessionCard } from '@/components/active-session-card';
import { InboxItem as InboxItemComp } from '@/components/inbox-item';
import { NewRequirementButton } from '@/components/new-requirement-button';

export default function DashboardPage() {
  const ongoing = requirements.filter(r => r.status !== 'done' && r.status !== 'archived');
  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">概览</h1>
          <div className="text-text-2 text-md mt-1">下午好，<strong className="text-text-1 font-medium">李雷</strong> · 当前 {ongoing.length} 个进行中需求，{sessions.length} 个 AI 会话活跃</div>
        </div>
        <div className="flex gap-2">
          <button className="h-8 px-3 rounded-md text-md font-medium bg-bg-elevated text-text-1 border border-border-strong hover:bg-bg-subtle">查看历史</button>
          <NewRequirementButton />
        </div>
      </div>

      {/* 4 个 Stat */}
      <section className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="进行中" value={ongoing.length} delta="+2 本周" deltaTone="up" />
        <StatCard label="已完成" value={23} delta="本月" />
        <div className="bg-bg-elevated border border-border rounded-lg p-5">
          <div className="text-text-3 text-sm mb-2">待回答</div>
          <div className="text-[32px] font-semibold tracking-tight leading-none">
            <span style={{ color: 'hsl(var(--warning))' }}>3</span>
          </div>
          <div className="text-xs mt-2 text-text-3">AI 提问</div>
        </div>
        <StatCard label="知识沉淀" value={47} delta="+5 自动" deltaTone="up" />
      </section>

      {/* 进行中需求 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">进行中的需求</h2>
          <span className="text-text-3 text-sm">{ongoing.length} 个 · {sessions.length} 个 AI 活跃</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {ongoing.map(r => <RequestCard key={r.id} requirement={r} />)}
        </div>
      </section>

      {/* 当前活跃会话 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">当前活跃会话</h2>
          <span className="text-text-3 text-sm">来自 {new Set(sessions.map(s => s.requirementId)).size} 个需求的 AI 子进程</span>
        </div>
        <div className="flex flex-col gap-2">
          {sessions.map(s => <ActiveSessionCard key={s.id} session={s} />)}
        </div>
      </section>

      {/* 待办 */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold tracking-tight">待办</h2>
          <span className="text-text-3 text-sm">{inbox.length} 项 · 按时间倒序</span>
        </div>
        <div className="flex flex-col gap-2">
          {inbox.map(i => <InboxItemComp key={i.id} item={i} />)}
        </div>
      </section>

      <div className="mt-4 p-4 bg-[#fffbeb] border border-[#fde68a] rounded-md text-sm text-[#78350f]">
        <strong className="text-[#451a03]">设计说明：</strong>Dashboard 是首屏，遵循 Linear「3 段信息密度」—— 统计 → 进行中需求 → 活跃会话 → 待办。所有数字都是 mock 数据（[P1+ 接 SSE](file:///d:/TraeProject/AI-DevSpace/.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md)）。
      </div>
    </main>
  );
}