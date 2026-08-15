'use client'

/**
 * /repos 列表页 client 组件 —— issue 07 / ADR-0030 D6
 *
 * 职责:
 * - 客户端搜索过滤(name / gitUrl / description)
 * - hover 显示「编辑 / 删除」按钮
 * - 「+ 添加仓库」→ AddRepoModal
 * - 「删除」→ DeleteRepoDialog(二次确认)→ deleteRepo
 *
 * 数据来源:由 RSC `page.tsx` SSR 拉好通过 props 传入,这里**不**自己 fetch。
 *
 * 设计选择:
 * - 卡片 hover 用 React state(useState)而非纯 CSS `:hover`,便于单测验证
 * - 删除走 `deleteRepo(name, { force: true })` —— usageCount>0 时 dialog 文案已告知用户,
 *   这里直接强制删除(决策 Q7「二次确认后强制」)
 */

import { useState } from 'react'
import Link from 'next/link'
import type { RepoRegistryEntry } from '@/lib/repo-attach'
import type { CodebaseUsageEntry } from '@ai-devspace/shared'
import { deleteRepo } from '@/lib/repo-attach'
import { AddRepoModal } from '@/components/repos/AddRepoModal'
import { DeleteRepoDialog } from '@/components/repos/DeleteRepoDialog'

interface Props {
  repos: RepoRegistryEntry[]
  /** name → usage[](空数组=未被使用) */
  usageByName: Record<string, CodebaseUsageEntry[]>
}

function matchSearch(
  repo: RepoRegistryEntry,
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return true
  return (
    repo.name.toLowerCase().includes(q) ||
    repo.gitUrl.toLowerCase().includes(q) ||
    repo.description.toLowerCase().includes(q)
  )
}

export function ReposList({ repos, usageByName }: Props) {
  const [search, setSearch] = useState('')
  const [hoveredName, setHoveredName] = useState<string | null>(null)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<RepoRegistryEntry | null>(null)
  const [localRepos, setLocalRepos] = useState<RepoRegistryEntry[]>(repos)

  const filtered = localRepos.filter((r) => matchSearch(r, search))
  const totalCount = localRepos.length

  function handleAdded(entry: RepoRegistryEntry) {
    // 新增条目默认 usage=0(刚注册未关联任何需求)
    setLocalRepos((prev) => [...prev, entry])
  }

  async function handleConfirmDelete(repo: RepoRegistryEntry) {
    // 删除走 force=true —— dialog 文案已告知用户「codebase/ 不会被删」
    try {
      await deleteRepo(repo.name, { force: true })
      setLocalRepos((prev) => prev.filter((r) => r.name !== repo.name))
      setDeleteTarget(null)
    } catch {
      // 失败保留卡片,让用户可重试(详细错误展示留给未来的 toast/banner)
      setDeleteTarget(null)
    }
  }

  return (
    <main className="p-6 lg:p-8 overflow-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1
            data-testid="repos-page-title"
            className="text-[24px] font-semibold tracking-tight"
          >
            仓库
          </h1>
          <div
            data-testid="repos-page-summary"
            className="text-text-2 text-md mt-1"
          >
            {totalCount} 个仓库
          </div>
        </div>
        <div className="flex gap-2">
          <div className="relative w-80">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-text-3">🔍</span>
            <input
              type="text"
              data-testid="repos-page-search"
              placeholder="搜索仓库名 / 地址 / 描述…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 bg-bg-elevated border border-border-strong rounded-md text-md outline-none"
            />
          </div>
          <button
            data-testid="repos-page-add"
            onClick={() => setAddModalOpen(true)}
            className="h-8 px-3 rounded-md text-md font-medium bg-brand text-white hover:bg-brand-600"
          >
            + 添加仓库
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {filtered.map((r) => {
          const usage = usageByName[r.name] ?? []
          const usageCount = usage.length
          const isHovered = hoveredName === r.name
          return (
            <div
              key={r.name}
              data-testid={`repo-card-${r.name}`}
              className="relative bg-bg-elevated border border-border rounded-lg p-5 hover:border-border-strong hover:shadow-[0_2px_4px_rgba(0,0,0,0.06)] hover:-translate-y-px transition-all"
              onMouseEnter={() => setHoveredName(r.name)}
              onMouseLeave={() =>
                setHoveredName((h) => (h === r.name ? null : h))
              }
            >
              {isHovered && (
                <div className="absolute top-2 right-2 flex gap-1">
                  <button
                    data-testid={`repo-card-edit-${r.name}`}
                    className="h-6 px-2 rounded-md text-xs bg-bg-subtle text-text-2 border border-border hover:bg-bg-elevated hover:text-text-1"
                    aria-label="编辑"
                  >
                    ✏️ 编辑
                  </button>
                  <button
                    data-testid={`repo-card-delete-${r.name}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDeleteTarget(r)
                    }}
                    className="h-6 px-2 rounded-md text-xs bg-[#fef2f2] text-error border border-[#fecaca] hover:bg-error hover:text-white"
                    aria-label="删除"
                  >
                    🗑️ 删除
                  </button>
                </div>
              )}
              <Link
                href={`/repos/${r.name}`}
                className="block"
              >
                <div className="flex items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-md bg-bg-subtle flex items-center justify-center text-xl">📦</div>
                    <div>
                      <div className="text-lg font-semibold font-mono">{r.name}</div>
                      <div className="font-mono text-xs text-text-3 mt-0.5">{r.gitUrl}</div>
                    </div>
                  </div>
                </div>
                {r.description && (
                  <p className="text-sm text-text-2 mb-3">{r.description}</p>
                )}
                <div className="flex items-center gap-3 py-2 border-t border-border text-sm text-text-2">
                  <span
                    data-testid={`repo-card-usage-${r.name}`}
                    className="flex items-center gap-1.5"
                  >
                    <span className="text-text-3">被</span>
                    <strong className="font-mono text-text-1">{usageCount}</strong>
                    <span className="text-text-3">个需求使用</span>
                  </span>
                </div>
              </Link>
            </div>
          )
        })}

        {/* Add card — 点击打开 AddRepoModal */}
        <button
          data-testid="repos-page-add-card"
          onClick={() => setAddModalOpen(true)}
          className="border-[1.5px] border-dashed border-border-strong rounded-lg flex flex-col items-center justify-center text-text-3 min-h-[180px] hover:border-brand-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
        >
          <div className="text-[36px] mb-2">＋</div>
          <div className="text-md font-medium">添加仓库</div>
          <div className="text-sm mt-1">支持 SSH / HTTPS / 本地路径</div>
        </button>
      </div>

      {/* Empty state:搜索无结果 */}
      {filtered.length === 0 && search.trim().length > 0 && (
        <div className="mt-8 text-center text-text-3 text-sm">
          没有匹配「{search.trim()}」的仓库。
        </div>
      )}

      {/* Modals */}
      <AddRepoModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onAdded={handleAdded}
      />
      {deleteTarget && (
        <DeleteRepoDialog
          open={true}
          repo={deleteTarget}
          usageCount={(usageByName[deleteTarget.name] ?? []).length}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </main>
  )
}
