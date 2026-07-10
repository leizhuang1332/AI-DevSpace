import Link from 'next/link';
import { repositories, repoDetails, EMPTY_REPO_DETAIL, type WorktreeBadgeTone } from '@/app/(workspace)/data/mock';

// 映射 HTML 原型中的标签 tone
const TAG_TONE: Record<WorktreeBadgeTone, string> = {
  succ:  'bg-[#dcfce7] text-[#166534]',
  warm:  'bg-[#fef3c7] text-[#92400e]',
  plain: 'bg-bg-subtle text-text-2',
};

const TAG_DOT: Record<WorktreeBadgeTone, string> = {
  succ:  'bg-success',
  warm:  'bg-warning',
  plain: 'bg-brand',
};

export default function ReposPage() {
  const totalWorktrees = Object.values(repoDetails).reduce((s, r) => s + r.repoStats.worktrees, 0);

  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold tracking-tight">仓库</h1>
          <div className="text-text-2 text-md mt-1">
            全局仓库池 · {repositories.length} 个仓库 · {totalWorktrees} 个 worktree · 多个需求共享一份 clone（ADR-0003）
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative w-80">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-3">🔍</span>
            <input
              type="text"
              placeholder="搜索仓库名 / URL / 分支…"
              className="w-full h-8 pl-8 pr-3 bg-bg-elevated border border-border-strong rounded-md text-md outline-none"
            />
          </div>
          <button className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600">
            + 添加仓库
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {repositories.map((r) => {
          const detail = repoDetails[r.name] ?? EMPTY_REPO_DETAIL;
          const stats = detail.repoStats;
          const tags = detail.tags;
          return (
            <Link
              key={r.name}
              href={`/repos/${r.name}`}
              className="bg-bg-elevated border border-border rounded-lg p-5 hover:border-border-strong hover:shadow-[0_2px_4px_rgba(0,0,0,0.06)] hover:-translate-y-px transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md bg-bg-subtle flex items-center justify-center text-xl">📦</div>
                  <div>
                    <div className="text-lg font-semibold font-mono">{r.name}</div>
                    <div className="font-mono text-xs text-text-3 mt-0.5">git@github.com:company/{r.name}.git</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 py-3 border-t border-b border-border my-3">
                <div>
                  <div className="text-xs text-text-3 mb-0.5">分支</div>
                  <div className="text-md font-medium font-mono text-sm">main</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 mb-0.5">Worktrees</div>
                  <div className="text-md font-medium">{stats.worktrees}</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 mb-0.5">关联需求</div>
                  <div className="text-md font-medium">{stats.linkedReqs}</div>
                </div>
                <div>
                  <div className="text-xs text-text-3 mb-0.5">最近 Fetch</div>
                  <div className="text-md font-medium">{stats.fetchText}</div>
                </div>
              </div>

              {tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-3">
                  {tags.map((t) => (
                    <span
                      key={t.label}
                      className={`h-5 px-2 rounded-sm text-xs flex items-center gap-1 ${TAG_TONE[t.tone]}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${TAG_DOT[t.tone]}`} />
                      {t.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-text-3">
                <span>
                  <span className="font-mono">{r.branch.split('/')[0]}</span> · {stats.ahead}
                </span>
                <span>{detail.date}</span>
              </div>
            </Link>
          );
        })}

        {/* Add card */}
        <div className="border-[1.5px] border-dashed border-border-strong rounded-lg flex flex-col items-center justify-center text-text-3 min-h-[200px] hover:border-brand-500 hover:text-brand-700 hover:bg-brand-50 transition-colors">
          <div className="text-[36px] mb-2">＋</div>
          <div className="text-md font-medium">添加仓库</div>
          <div className="text-sm mt-1">支持 SSH / HTTPS / 本地路径</div>
        </div>
      </div>

      <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
        <strong>设计说明：</strong>仓库是<b>全局共享</b>的（每个仓库只 clone 一次到 <code className="font-mono">~/.aidevspace/repos/</code>）。
        需求通过 git worktree 引用，零冲突。点击仓库 → 进入详情（页面 09）查看所有 worktree 列表。
        空态：刚启动时显示「📦 克隆仓库开始 · + 添加仓库」。<b>拖拽 Git URL 到虚线框</b>也能添加。
      </div>
    </main>
  );
}
