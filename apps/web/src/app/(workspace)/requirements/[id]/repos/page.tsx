import { requirements, reposFor } from '@/app/(workspace)/data/mock';

interface Props { params: { id: string }; }

export default function RequirementReposPage({ params }: Props) {
  const req = requirements.find(r => r.id === params.id) ?? requirements[0];
  const repos = reposFor(params.id);

  return (
    <section className="flex flex-col bg-bg-elevated overflow-hidden">
      <div className="flex items-center h-10 px-4 border-b border-border bg-bg-subtle text-xs text-text-3 gap-2">
        <span className="font-mono">📄 {req.title}</span>
        <span>/</span>
        <span className="text-text-1 font-medium">📦 仓库</span>
      </div>

      <div className="flex items-center justify-between h-10 px-6 border-b border-border bg-bg-elevated">
        <div className="flex items-center gap-3 text-sm text-text-3">
          <span>{repos.length} 个关联仓库</span>
          <span>·</span>
          <span>基于 git worktree 隔离 · 与全局仓库池共享磁盘</span>
        </div>
        <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">+ 添加仓库</button>
      </div>

      <main className="p-6 px-8 overflow-auto h-[calc(100vh-120px)]">
        <div className="flex flex-col gap-3">
          {repos.map((r) => (
            <div
              key={r.name}
              className="bg-bg-elevated border border-border rounded-lg p-5"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-bg-subtle flex items-center justify-center text-xl">📦</div>
                  <div>
                    <div className="text-lg font-semibold">
                      {r.name}
                      <span className="font-mono text-sm text-text-2 font-normal ml-2">· branch: {r.branch}</span>
                    </div>
                    <div className="font-mono text-xs text-text-3 mt-0.5">git@github.com:company/{r.name}.git</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">⌘⇧E 打开 IDEA</button>
                  <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">⌘⇧D 查看 Diff</button>
                  <button className="h-7 px-3 bg-bg-subtle border border-border rounded-md text-sm text-text-2 hover:bg-bg-elevated hover:text-text-1">⌘⇧C 最新 Commit</button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 py-3 border-t border-border border-b border-border mb-4">
                <div>
                  <div className="text-xs text-text-3 uppercase tracking-wider font-medium mb-1">Worktree</div>
                  <div className="text-lg font-medium text-text-1 font-mono text-md">{r.worktreeShort}</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 uppercase tracking-wider font-medium mb-1">变更文件</div>
                  <div className="text-lg font-medium text-text-1">{r.changedFiles}</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 uppercase tracking-wider font-medium mb-1">新增</div>
                  <div className="text-lg font-medium text-success">+{r.added}</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 uppercase tracking-wider font-medium mb-1">删除</div>
                  <div className="text-lg font-medium text-error">−{r.removed}</div>
                </div>
              </div>

              <div className="text-sm text-text-3 mb-2 font-medium uppercase tracking-wider">最近 {r.commits.length} 次 Commit</div>
              <div>
                {r.commits.map((c) => (
                  <div
                    key={c.sha}
                    className="grid grid-cols-[60px_1fr_auto] gap-3 items-center py-2 text-sm border-b border-border last:border-b-0"
                  >
                    <div className="font-mono text-brand-600 font-medium">{c.sha}</div>
                    <div className="text-text-1">{c.msg}</div>
                    <div className="text-text-3 text-xs">{c.meta}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-3 bg-bg-subtle rounded-md font-mono text-xs text-text-2 flex items-center gap-2">
                <span>📂</span>
                <span>~/.aidevspace/requirements/{r.branch}/repos/</span>
                <span className="text-text-1">{r.name}</span>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-center p-8 border-2 border-dashed border-border-strong rounded-lg text-text-3 text-md bg-bg-elevated">
            + 拖拽仓库 URL 到此处,或 <strong className="text-brand-600 font-medium ml-1">从全局仓库池选择</strong>
          </div>
        </div>

        <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
          <strong>设计说明:</strong>本 Tab 展示该需求下所有关联仓库的 worktree。每个仓库独立 branch,互不冲突。
          <code className="font-mono">⌘⇧E</code> 调用 IDEA 打开 worktree 路径。
        </div>
      </main>
    </section>
  );
}
