'use client'

/**
 * /repos/[name] 详情页 client 组件 —— issue 07 / ADR-0030 D6
 *
 * 职责(纯展示):
 * - 仓库名 / gitUrl / 描述 / Crumbs
 * - 「关联需求 (N)」section:列出每个 usage(reqId link + branch + codebasePath)
 *
 * 数据来源:由 RSC `page.tsx` SSR 拉好通过 props 传入。
 *
 * 与 mock 时代对比:
 * - 旧:从 repoDetails[repo.name] 拿 worktree + commits + tags 等「仓库详情」字段
 * - 新:每个需求独立 clone(ADR-0030 D3),无 worktree 概念,改为「关联需求列表」
 */

import Link from 'next/link'
import { EmptyState } from '@/components/empty-state'
import type { RepoRegistryEntry } from '@/lib/repo-attach'
import type { CodebaseUsageEntry } from '@ai-devspace/shared'

interface Props {
  repo: RepoRegistryEntry
  usage: CodebaseUsageEntry[]
}

export function RepoDetailView({ repo, usage }: Props) {
  return (
    <main className="p-6 lg:p-8 overflow-auto max-w-[1400px]">
      {/* Crumbs */}
      <div data-testid="repo-detail-crumbs" className="mb-5">
        <div className="text-sm text-text-3 mb-1.5">
          <Link href="/repos" className="hover:text-text-1">仓库</Link>
          <span className="mx-1.5">/</span>
          <span className="text-text-1">{repo.name}</span>
        </div>
        <h1
          data-testid="repo-detail-title"
          className="text-[24px] font-semibold tracking-tight flex items-center gap-3 mb-0.5"
        >
          <span>📦</span>
          <span>{repo.name}</span>
        </h1>
        <div
          data-testid="repo-detail-giturl"
          className="font-mono text-sm text-text-3"
        >
          {repo.gitUrl}
        </div>
        {repo.description && (
          <p
            data-testid="repo-detail-description"
            className="text-sm text-text-2 mt-2"
          >
            {repo.description}
          </p>
        )}
      </div>

      {/* 关联需求 */}
      <section className="mb-6">
        <h2
          data-testid="repo-detail-usage-heading"
          className="text-lg font-semibold mb-3 flex items-center gap-2"
        >
          关联需求
          <span className="text-xs text-text-3 bg-bg-subtle px-2 py-0.5 rounded-xl font-medium">
            {usage.length}
          </span>
        </h2>

        {usage.length === 0 ? (
          <div data-testid="repo-detail-usage-empty">
            <EmptyState
              icon="🗂️"
              title="尚无需求关联此仓库"
              subtitle="在 DRAFTING 工位选择此仓库即可建立关联"
            />
          </div>
        ) : (
          <div
            data-testid="repo-detail-usage-list"
            className="bg-bg-elevated border border-border rounded-lg overflow-hidden"
          >
            <div className="grid grid-cols-[1fr_200px_1fr] items-center h-8 px-4 bg-bg-subtle text-xs text-text-3 uppercase tracking-wider font-medium">
              <div>需求</div>
              <div>分支</div>
              <div>本地路径</div>
            </div>
            {usage.map((u) => (
              <div
                key={u.requirementId}
                data-testid={`repo-detail-usage-row-${u.requirementId}`}
                className="grid grid-cols-[1fr_200px_1fr] items-center h-10 px-4 border-t border-border text-md hover:bg-bg-subtle"
              >
                <div>
                  <Link
                    href={`/requirements/${u.requirementId}`}
                    className="text-brand-700 hover:underline font-mono text-sm"
                  >
                    {u.requirementId}
                  </Link>
                </div>
                <div>
                  <code className="font-mono text-sm text-text-1">
                    {u.branch || '—'}
                  </code>
                </div>
                <div>
                  <code className="font-mono text-xs text-text-2 truncate block">
                    {u.codebasePath}
                  </code>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
