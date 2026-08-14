---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 02, 06
Blocks: 无
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 07: `/repos` 列表 + 详情页重写 + mock 退场

## 目标

把 `apps/web/src/app/(workspace)/repos/page.tsx`、`apps/web/src/app/(workspace)/repos/[name]/page.tsx`、`apps/web/src/app/(workspace)/data/mock.ts` 三个文件全部从「物理目录 mock」改成「API + 注册表」驱动。

## 子项

### 7.1 列表页 `/repos/page.tsx` 重写

**删除**：`import { repositories, repoDetails, EMPTY_REPO_DETAIL } from '@/app/(workspace)/data/mock'`（mock 全部退场）

**新增**：

```typescript
async function ReposPage() {
  // SSR 拿注册表
  const registryRes = await fetch('http://localhost:7777/api/repos', { cache: 'no-store' })
  const { repos } = await registryRes.json()
  
  // 每个 repo 拿「被 N 个需求使用」—— 通过新端点 GET /api/repos/:name/usage
  // （issue 02 未实装，本期先用一个临时扫描接口，或在 issue 04 的 findCodebaseUsage 上加 HTTP 暴露）
  const usage = await Promise.all(
    repos.map((r) => fetch(`http://localhost:7777/api/repos/${r.name}/usage`).then((res) => res.json()))
  )
  
  return (
    <main>
      {/* 顶部：N 个仓库（去掉 · M 个 worktree） */}
      <header>
        <h1>仓库</h1>
        <div>注册表 · {repos.length} 个仓库</div>
        <div>
          <input placeholder="搜索仓库名 / 地址 / 描述…" />
          <button>+ 添加仓库</button>
        </div>
      </header>
      
      {/* 卡片网格：仓库名 + gitUrl + 描述 + 被 N 个需求使用 */}
      <div className="grid grid-cols-2 gap-4">
        {repos.map((r) => (
          <RepoCard key={r.name} repo={r} usageCount={usage[r.name]} />
        ))}
        <AddRepoCard onClick={openAddModal} />
      </div>
    </main>
  )
}
```

### 7.2 详情页 `/repos/[name]/page.tsx` 重写

**删除**：worktree 列表

**新增**：关联需求列表

```typescript
async function RepoDetailPage({ params }: { params: { name: string } }) {
  // 拿仓库本身
  const registry = await fetch(`http://localhost:7777/api/repos`).then((r) => r.json())
  const repo = registry.repos.find((r) => r.name === params.name)
  if (!repo) return notFound()
  
  // 拿被使用列表
  const usage = await fetch(`http://localhost:7777/api/repos/${params.name}/usage`).then((r) => r.json())
  
  return (
    <main>
      <header>
        <h1>{repo.name}</h1>
        <div className="font-mono text-xs">{repo.gitUrl}</div>
        <p>{repo.description}</p>
      </header>
      
      <section>
        <h2>关联需求 ({usage.length})</h2>
        {usage.length === 0 ? (
          <EmptyState text="尚无需求关联此仓库" />
        ) : (
          <ul>
            {usage.map((u) => (
              <li key={u.requirementId}>
                <Link href={`/requirements/${u.requirementId}`}>{u.requirementId}</Link>
                <span className="font-mono">{u.branch}</span>
                <span className="font-mono text-text-3">{u.codebasePath}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
```

### 7.3 新增「+ 添加仓库」弹层

```typescript
function AddRepoModal({ open, onClose, onAdded }) {
  const [name, setName] = useState('')
  const [gitUrl, setGitUrl] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('http://localhost:7777/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, gitUrl, description }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.message ?? '添加失败')
        return
      }
      onAdded(await res.json())
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSubmitting(false)
    }
  }
  
  // 校验：name 文件名安全；gitUrl 非空；description 任意
  // 提交期 ls-remote 跑 ~5-10s，按钮显示「正在验证可达…」
  // ...
}
```

### 7.4 卡片 hover「编辑 / 删除」

```typescript
function RepoCard({ repo, usageCount }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* ... 卡片内容 ... */}
      {hovered && (
        <div className="absolute top-2 right-2 flex gap-1">
          <button onClick={() => openEditModal(repo)}>✏️ 编辑</button>
          <button onClick={() => openDeleteDialog(repo, usageCount)}>🗑️ 删除</button>
        </div>
      )}
    </div>
  )
}
```

删除二次确认弹窗：

```typescript
function DeleteRepoDialog({ repo, usageCount, onConfirm, onCancel }) {
  return (
    <Dialog>
      <h2>删除仓库「{repo.name}」？</h2>
      {usageCount > 0 ? (
        <p>该仓库正被 <strong>{usageCount}</strong> 个需求使用。删除注册表条目后，这些需求的 <code>codebase/{repo.name}/</code> 不会被删除，但你无法再在 DRAFTING 关联此仓库。</p>
      ) : (
        <p>该仓库尚未被任何需求使用。</p>
      )}
      <button onClick={onConfirm}>确认删除</button>
      <button onClick={onCancel}>取消</button>
    </Dialog>
  )
}
```

### 7.5 `data/mock.ts` 退场

- 删除 `repositories` / `repoDetails` / `EMPTY_REPO_DETAIL` / `repoDetails` map
- 删除 `reposFor(reqId)` / `repoStats` / `WorktreeBadgeTone` 等仅 `/repos` 系列页面用的导出
- `refundDemos` / `REFUND_REPOS` 等 demo 用途保留（仍在其他页面作 fallback）

### 7.6 测试

- `apps/web/src/__tests__/app/repos-page.test.tsx` 新增：mock `fetch` → 渲染 3 个 repo card + 「被 N 个需求使用」数字
- `apps/web/src/__tests__/app/repos-detail.test.tsx`：详情页渲染仓库信息 + 关联需求列表
- `apps/web/src/__tests__/components/AddRepoModal.test.tsx`：表单校验 + 提交 + 错误显示
- `apps/web/src/__tests__/components/DeleteRepoDialog.test.tsx`：usageCount>0 / =0 文案差异

## 验收清单

- [ ] `/repos` 列表页：3 字段卡片 + 关联需求数 + 客户端搜索 + 添加按钮
- [ ] `/repos/[name]` 详情页：仓库信息 + 关联需求列表
- [ ] AddRepoModal：表单校验 + 提交 + ls-remote loading 态
- [ ] DeleteRepoDialog：usageCount>0 二次确认
- [ ] `data/mock.ts` 仓库相关常量删除；其他 demo 用 fallback 保留
- [ ] 列表页文案「N 个仓库 · M 个 worktree」→「N 个仓库」
- [ ] placeholder「搜索仓库名 / URL / **分支**…」→「搜索仓库名 / 地址 / 描述…」

## 风险

- SSR 在 Next.js dev 模式下跨进程访问 `localhost:7777` 可能慢——确保 dev server 启动顺序（先 agent 后 web）或用 `Suspense` + 骨架屏
- `AddRepoModal` 的 ls-remote 跑 5-10s——loading 态要明确，否则用户以为页面挂了

## 引用

- [PRD FR-4](../PRD.md#fr-4-repos-页面)
- [ADR-0030 D6](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q6 / Q7 / C2](../decisions.md)
