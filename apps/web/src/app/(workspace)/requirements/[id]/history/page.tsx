import { requirements, historyFor, conversationsFor, type HistoryEvent } from '@/app/(workspace)/data/mock';

interface Props { params: { id: string }; }

const DOT_COLOR: Record<HistoryEvent['kind'], string> = {
  stage: 'bg-brand border-brand',
  commit: 'bg-success border-success',
  user: 'bg-warning border-warning',
};

export default function RequirementHistoryPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];
  const events = historyFor(params.id);
  const convs = conversationsFor(params.id);

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <div className="flex items-center h-10 px-4 border-b border-border bg-bg-subtle text-xs text-text-3 gap-2">
        <span className="font-mono">📄 {req.title}</span>
        <span>/</span>
        <span className="text-text-1 font-medium">💬 对话与变更</span>
      </div>

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm text-text-3">
          <span>{convs.length} 个会话 · {events.filter((e) => e.kind === 'commit').length} 个 commit</span>
          <span>·</span>
          <span>会话历史 + 文件变更 + Commit 流水</span>
        </div>
        <div className="flex gap-2">
          <button className="h-7 px-3 bg-bg-elevated border border-border-strong rounded-md text-sm text-text-1 hover:bg-bg-subtle">筛选</button>
          <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">⌘K 跳到命令面板</button>
        </div>
      </div>

      <main className="p-6 px-8 overflow-auto h-[calc(100vh-120px)]">
        <h1 className="text-2xl font-semibold tracking-tight">对话与变更</h1>
        <p className="text-text-2 text-md mt-1 mb-5">会话历史 + 文件变更 + Commit 流水</p>

        <div className="timeline relative pl-8">
          <div className="absolute left-[14px] top-2 bottom-2 w-0.5 bg-border" />
          {events.map((e) => (
            <div key={e.id} className="relative mb-5">
              <div
                className={`absolute -left-[29px] top-1.5 w-4 h-4 rounded-full bg-bg-elevated border-[3px] ${DOT_COLOR[e.kind]}`}
              />
              <div className="bg-bg-elevated border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`inline-flex items-center gap-1.5 h-5 px-2 rounded-sm text-xs font-medium ${e.stageTagBg} ${e.stageTagColor}`}
                  >
                    {e.stageTag}
                  </span>
                  <span className="text-xs text-text-3">{e.when}</span>
                </div>
                <div className="text-md font-medium mb-2">{e.title}</div>
                <div className="text-md text-text-2 leading-relaxed">{e.body}</div>
                {e.files && e.files.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-border">
                    {e.files.map((f) => (
                      <span
                        key={f}
                        className="font-mono text-xs text-text-2 bg-bg-subtle px-2 py-0.5 rounded"
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <h2 className="text-md font-semibold mt-6 mb-3 uppercase tracking-wider text-text-3 text-xs">会话列表 · {convs.length}</h2>
        <div className="grid grid-cols-3 gap-2">
          {convs.map((c) => (
            <div
              key={c.seq}
              className={
                c.active
                  ? 'bg-brand-50 border border-brand-500 rounded-md p-3'
                  : 'bg-bg-subtle border border-border rounded-md p-3'
              }
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-brand-600 font-medium">{c.seq}</span>
                <span className="text-xs text-text-3">{c.when}</span>
              </div>
              <div className="text-sm font-medium mb-1">{c.name}</div>
              <div className="text-xs text-text-2 leading-relaxed line-clamp-2 overflow-hidden">
                {c.preview}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明:</strong>时间轴 = 「会话 × 文件变更 × Commit」三流合一。紫色圆点 = Skill 阶段完成,绿色 = Commit,黄色 = 用户决策 / 问答。
          点击卡片 → 跳到对应会话的 markdown(资源树对话节点)或文件 Diff。
          本 Tab 是「历史回溯」,而 AI 实时的状态变化看 StatusBar / Inline 提示栏。
        </div>
      </main>
    </section>
  );
}
