import Link from 'next/link';
import { repositories } from '@/app/(workspace)/data/mock';

interface Worktree {
  branch: string;
  meta: string;
  path: string;
  reqLink?: string;
  badgeTone: 'succ' | 'warm' | 'plain';
  badgeText: string;
}

const WT_BY_REPO: Record<string, Worktree[]> = {
  'refund-service': [
    { branch: 'main',                                   meta: '主分支 · 最新 commit 3 天前',                            path: '~/.aidevspace/repos/refund-service',                            badgeTone: 'succ',  badgeText: '干净' },
    { branch: 'req-2024-007-refund-optimize',           meta: '10 分钟前 · a8f3e21',                                    path: '~/.aidevspace/requirements/req-2024-007/refund-service',        reqLink: '退款功能优化', badgeTone: 'warm',  badgeText: '12 文件 · +847' },
    { branch: 'req-2024-002-refund-v2',                 meta: '2 天前 · e1b2c4d',                                       path: '~/.aidevspace/requirements/req-2024-002/refund-service',        reqLink: '退款链路 v2',   badgeTone: 'warm',  badgeText: '3 文件 · +124' },
  ],
  'order-service': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/order-service',                              badgeTone: 'succ',  badgeText: '干净' },
    { branch: 'req-2024-007-refund-optimize',           meta: '25 分钟前 · 9d2e0ab',                                     path: '~/.aidevspace/requirements/req-2024-007/order-service',         reqLink: '退款功能优化', badgeTone: 'warm',  badgeText: '4 文件 · +128' },
  ],
  'member-service': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/member-service',                             badgeTone: 'succ',  badgeText: '干净' },
    { branch: 'feature/member-tier',                    meta: '3 天前 · b1c7e22',                                       path: '~/.aidevspace/requirements/req-002-tier/member-service',        reqLink: '会员等级体系重构', badgeTone: 'warm',  badgeText: '3 文件 · +56' },
  ],
  'pay-gateway': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/pay-gateway',                                badgeTone: 'succ',  badgeText: '干净' },
    { branch: 'feature/gray-payment',                   meta: '1 小时前 · c4d9f30',                                      path: '~/.aidevspace/requirements/req-003-gray/pay-gateway',           reqLink: '支付链路灰度切流', badgeTone: 'warm',  badgeText: '7 文件 · +212' },
  ],
  'risk-service': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/risk-service',                               badgeTone: 'succ',  badgeText: '干净' },
  ],
  'coupon-service': [
    { branch: 'main',                                   meta: '主分支 · 1 commit behind',                                path: '~/.aidevspace/repos/coupon-service',                             badgeTone: 'succ',  badgeText: '干净' },
    { branch: 'feature/coupon-stack',                   meta: '5 天前 · f6b2c93',                                       path: '~/.aidevspace/requirements/req-005-coupon/coupon-service',      reqLink: '优惠券叠加规则', badgeTone: 'warm',  badgeText: '5 文件 · +189' },
  ],
  'cart-service': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/cart-service',                               badgeTone: 'succ',  badgeText: '干净' },
  ],
  'seckill-service': [
    { branch: 'main',                                   meta: '主分支 · synced',                                         path: '~/.aidevspace/repos/seckill-service',                            badgeTone: 'succ',  badgeText: '干净' },
  ],
};

const COMMITS_BY_REPO: Record<string, { sha: string; msg: string; author: string }[]> = {
  'refund-service': [
    { sha: 'a8f3e21', msg: 'feat(refund): 退款订单表索引优化',   author: '李雷 · 10 分钟前' },
    { sha: '9d2e0ab', msg: 'feat(order): 退款时回写订单状态',   author: '李雷 · 25 分钟前' },
    { sha: '7c91b44', msg: 'feat(refund): 添加退款状态机',      author: '李雷 · 1 小时前' },
    { sha: '3e0d9a1', msg: 'chore: 升级 spring-boot 3.2',      author: '李雷 · 昨天'     },
    { sha: '5b71f3c', msg: 'feat: 接入 Prometheus 监控',       author: '李雷 · 2 天前'   },
  ],
  'order-service': [
    { sha: '9d2e0ab', msg: 'feat(order): 退款时回写订单状态',   author: '李雷 · 25 分钟前' },
    { sha: '7c91b44', msg: 'feat(order): 订单导出 CSV',          author: '李雷 · 2 天前'   },
  ],
  'member-service': [
    { sha: 'b1c7e22', msg: 'feat(member): 等级体系重构',          author: '李雷 · 3 天前'   },
    { sha: '4b1cd09', msg: 'fix: 成长值并发更新',                author: '李雷 · 1 周前'   },
  ],
  'pay-gateway': [
    { sha: 'c4d9f30', msg: 'feat(pay): 灰度切流配置',             author: '李雷 · 1 小时前' },
    { sha: '8a7e6d5', msg: 'feat(pay): 风险引擎接入',            author: '李雷 · 2 天前'   },
  ],
  'risk-service': [
    { sha: 'e5a1b82', msg: 'feat(risk): 决策引擎 v2',             author: '李雷 · 5 小时前' },
  ],
  'coupon-service': [
    { sha: 'f6b2c93', msg: 'feat(coupon): 叠加规则配置化',       author: '李雷 · 5 天前'   },
  ],
  'cart-service': [
    { sha: '7d8e4a1', msg: 'feat(cart): 持久化 Redis',           author: '李雷 · 2 周前'   },
  ],
  'seckill-service': [
    { sha: '8e9f5b2', msg: 'chore: 压测报告归档',                author: '李雷 · 1 周前'   },
  ],
};

const STATS_BY_REPO: Record<string, { worktrees: number; linkedReqs: number; disk: string; fetchText: string }> = {
  'refund-service':  { worktrees: 3, linkedReqs: 2, disk: '128 MB', fetchText: '5 分钟前' },
  'order-service':   { worktrees: 2, linkedReqs: 2, disk: '92 MB',  fetchText: '2 小时前' },
  'member-service':  { worktrees: 2, linkedReqs: 1, disk: '64 MB',  fetchText: '昨天'    },
  'pay-gateway':     { worktrees: 2, linkedReqs: 2, disk: '156 MB', fetchText: '3 小时前' },
  'risk-service':    { worktrees: 1, linkedReqs: 1, disk: '48 MB',  fetchText: '5 小时前' },
  'coupon-service':  { worktrees: 2, linkedReqs: 1, disk: '72 MB',  fetchText: '2 天前'  },
  'cart-service':    { worktrees: 1, linkedReqs: 1, disk: '38 MB',  fetchText: '昨天'    },
  'seckill-service': { worktrees: 1, linkedReqs: 1, disk: '54 MB',  fetchText: '1 周前'  },
};

const BADGE_BG: Record<Worktree['badgeTone'], string> = {
  succ:  'bg-bg-subtle text-text-2',
  warm:  'bg-bg-subtle text-text-2',
  plain: 'bg-bg-subtle text-text-2',
};

const BADGE_DOT: Record<Worktree['badgeTone'], string> = {
  succ:  'bg-success',
  warm:  'bg-warning',
  plain: 'bg-brand',
};

interface Props { params: { name: string }; }

export default function RepoDetailPage({ params }: Props) {
  // Fallback pattern (同 Task 7)：找不到时回退到 repositories[0]
  const repo = repositories.find((r) => r.name === params.name) ?? repositories[0];
  const worktrees = WT_BY_REPO[repo.name] ?? [];
  const commits = COMMITS_BY_REPO[repo.name] ?? [];
  const stats = STATS_BY_REPO[repo.name] ?? { worktrees: 1, linkedReqs: 0, disk: '—', fetchText: '—' };

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
          { l: '磁盘占用', v: stats.disk },
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