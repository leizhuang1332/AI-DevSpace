import Link from 'next/link';
import { repositories, repoDetails, EMPTY_REPO_DETAIL, type WorktreeBadgeTone } from '@/app/(workspace)/data/mock';

const BADGE_BG: Record<WorktreeBadgeTone, string> = {
  succ:  'bg-bg-subtle text-text-2',
  warm:  'bg-bg-subtle text-text-2',
  plain: 'bg-bg-subtle text-text-2',
};

const BADGE_DOT: Record<WorktreeBadgeTone, string> = {
  succ:  'bg-success',
  warm:  'bg-warning',
  plain: 'bg-brand',
};

interface Props { params: { name: string }; }

export default function RepoDetailPage({ params }: Props) {
  // Fallback pattern (同 Task 7)：找不到时回退到 repositories[0]
  const repo = repositories.find((r) => r.name === params.name) ?? repositories[0];
  const detail = repoDetails[repo.name] ?? EMPTY_REPO_DETAIL;
  const worktrees = detail.worktrees;
  const commits = detail.commits;
  const stats = detail.detailStats;

  return (
    <main className="p-6 lg:p-8 overflow-auto max-w-[1400px]">
      {/* Crumbs */}
      <div className="mb-5">
        <div className="text-sm text-text-3 mb-1.5">
          <Link href="/repos" className="hover:text-text-1">仓库</Link>
          <span className="mx-1.5">/</span>
          <span className="text-text-1">{repo.name}</span>
        </div>
        <h1 className="text-[24px] font-semibold tracking-tight flex items-center gap-3 mb-0.5">
          <span>📦</span>
          <span>{repo.name}</span>
        </h1>
        <div className="font-mono text-sm text-text-3">git@github.com:company/{repo.name}.git</div>
      </div>

      {/* Stats — 5 栏 */}
      <section className="grid grid-cols-5 gap-4 mb-6">
        {[
          { l: '分支', v: 'main', mono: true },
          { l: 'Worktrees', v: stats.worktrees },
          { l: '关联需求', v: stats.linkedReqs },
          { l: '磁盘占用', v: stats.disk ?? '—' },
          { l: '最近 Fetch', v: stats.fetchText },
        ].map((s) => (
          <div key={s.l} className="bg-bg-elevated border border-border rounded-lg p-4">
            <div className="text-[11px] text-text-3 uppercase tracking-wider font-medium mb-1.5">{s.l}</div>
            <div className={`text-xl font-semibold ${'mono' in s && s.mono ? 'font-mono' : ''}`}>{s.v}</div>
          </div>
        ))}
      </section>

      {/* Action bar */}
      <div className="flex gap-2 mb-5">
        <button className="h-7 px-3 bg-brand text-white rounded-md text-sm font-medium hover:bg-brand-600">
          + 新建 Worktree
        </button>
        <button className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium">
          ⤓ Fetch All
        </button>
        <button className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium">
          ⌘⇧E 在 IDEA 打开
        </button>
        <button className="h-7 px-3 bg-bg-elevated text-text-1 border border-border-strong rounded-md text-sm font-medium">
          ⌘⇧D 主分支 Diff
        </button>
        <span className="flex-1" />
        <button className="h-7 px-3 bg-[#fef2f2] text-error border border-[#fecaca] rounded-md text-sm font-medium">
          删除仓库
        </button>
      </div>

      {/* Worktree list */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          Worktree 列表
          <span className="text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded-xl font-medium">
            {worktrees.length}
          </span>
        </h2>
        <div className="bg-bg-elevated border border-border rounded-lg overflow-hidden">
          <div className="grid grid-cols-[1fr_200px_200px_140px_80px] items-center h-8 px-4 bg-bg-subtle text-xs text-text-3 uppercase tracking-wider font-medium">
            <div>Branch</div>
            <div>所在路径</div>
            <div>关联需求</div>
            <div>变更</div>
            <div></div>
          </div>
          {worktrees.map((w, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_200px_200px_140px_80px] items-center h-8 px-4 border-t border-border text-md hover:bg-bg-subtle"
            >
              <div>
                <div className="font-mono text-sm font-medium text-brand-700">{w.branch}</div>
                <div className="text-xs text-text-3">{w.meta}</div>
              </div>
              <div>
                <code className="font-mono text-xs text-text-2">{w.path}</code>
              </div>
              <div>
                {w.reqLink ? (
                  <span className="text-sm text-text-2">→ {w.reqLink}</span>
                ) : (
                  <span className="text-text-3 text-sm">— 无关联需求</span>
                )}
              </div>
              <div>
                <span className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-sm text-xs ${BADGE_BG[w.badgeTone]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${BADGE_DOT[w.badgeTone]}`} />
                  {w.badgeText}
                </span>
              </div>
              <div className="text-right text-text-3 text-base">···</div>
            </div>
          ))}
        </div>
      </section>

      {/* Commit list */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          主分支最近 Commit
          <span className="text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded-xl font-medium">
            {commits.length}
          </span>
        </h2>
        <div className="bg-bg-elevated border border-border rounded-lg p-4">
          {commits.map((c, i) => (
            <div
              key={i}
              className="grid grid-cols-[80px_1fr_200px] gap-3 py-2 border-b border-border last:border-b-0 items-center text-sm"
            >
              <div className="font-mono text-brand-700 font-medium text-xs">{c.sha}</div>
              <div className="text-text-1">{c.msg}</div>
              <div className="text-xs text-text-3 text-right">{c.author}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-5 p-4 bg-[#f0f9ff] border border-[#bae6fd] rounded-md text-sm text-[#075985]">
        <strong>设计说明：</strong>仓库详情展示一个全局仓库的<b>所有 worktree</b> + 主分支最新 commit。
        <b>每个 worktree = 一个独立 branch + 独立路径</b>，互不冲突。
        <code className="font-mono">⌘⇧E</code> 用 IDEA 打开主仓库；点 worktree 行的 <code className="font-mono">→ 关联需求</code> 跳到对应需求页。
        「新建 Worktree」= 选一个需求，把此仓库挂到该需求下。
      </div>
    </main>
  );
}
