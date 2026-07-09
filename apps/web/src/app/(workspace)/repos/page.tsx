import Link from 'next/link';
import { repositories } from '@/app/(workspace)/data/mock';

// 映射 HTML 原型中的标签 tone
const TAG_TONE = {
  succ: 'bg-[#dcfce7] text-[#166534]',
  warm: 'bg-[#fef3c7] text-[#92400e]',
  plain: 'bg-bg-subtle text-text-2',
} as const;

const REPO_TAGS: Record<string, { label: string; tone: keyof typeof TAG_TONE }[]> = {
  'refund-service':  [
    { label: '退款功能优化', tone: 'succ'  },
    { label: '退款链路 v2',  tone: 'plain' },
    { label: '退款幂等性修复', tone: 'warm' },
  ],
  'order-service':   [
    { label: '退款功能优化', tone: 'succ'  },
    { label: '订单导出（CSV）', tone: 'plain' },
  ],
  'member-service':  [
    { label: '会员等级体系重构', tone: 'warm' },
  ],
  'pay-gateway':     [
    { label: '支付链路灰度切流',   tone: 'plain' },
    { label: '风险决策引擎接入', tone: 'warm' },
  ],
  'risk-service':    [
    { label: '风险决策引擎接入', tone: 'plain' },
  ],
  'coupon-service':  [
    { label: '优惠券叠加规则', tone: 'plain' },
  ],
  'cart-service':    [],
  'seckill-service': [],
};

const REPO_STATS: Record<string, { worktrees: number; linkedReqs: number; fetchText: string; ahead: string }> = {
  'refund-service':  { worktrees: 3, linkedReqs: 2, fetchText: '5 分钟前',  ahead: '12 commits ahead' },
  'order-service':   { worktrees: 2, linkedReqs: 2, fetchText: '2 小时前',  ahead: 'synced'          },
  'member-service':  { worktrees: 1, linkedReqs: 1, fetchText: '昨天',      ahead: '3 commits behind' },
  'pay-gateway':     { worktrees: 2, linkedReqs: 2, fetchText: '3 小时前',  ahead: 'synced'          },
  'risk-service':    { worktrees: 1, linkedReqs: 1, fetchText: '5 小时前',  ahead: 'synced'          },
  'coupon-service':  { worktrees: 1, linkedReqs: 1, fetchText: '2 天前',    ahead: '1 commit behind' },
  'cart-service':    { worktrees: 1, linkedReqs: 1, fetchText: '昨天',      ahead: 'synced'          },
  'seckill-service': { worktrees: 1, linkedReqs: 1, fetchText: '1 周前',    ahead: 'synced'          },
};

const REPO_DATES: Record<string, string> = {
  'refund-service':  '2026-07-08',
  'order-service':   '2026-07-08',
  'member-service':  '2026-07-07',
  'pay-gateway':     '2026-07-09',
  'risk-service':    '2026-07-08',
  'coupon-service':  '2026-07-07',
  'cart-service':    '2026-07-08',
  'seckill-service': '2026-07-05',
};

export default function ReposPage() {
  const totalWorktrees = Object.values(REPO_STATS).reduce((s, r) => s + r.worktrees, 0);

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
          const stats = REPO_STATS[r.name] ?? { worktrees: 1, linkedReqs: 1, fetchText: '—', ahead: 'synced' };
          const tags = REPO_TAGS[r.name] ?? [];
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
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          t.tone === 'succ' ? 'bg-success' : t.tone === 'warm' ? 'bg-warning' : 'bg-brand'
                        }`}
                      />
                      {t.label}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-text-3">
                <span>
                  <span className="font-mono">{r.branch.split('/')[0]}</span> · {stats.ahead}
                </span>
                <span>{REPO_DATES[r.name] ?? '—'}</span>
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