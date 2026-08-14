---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 01, 03, 04
Blocks: 07, 08
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 06: web 端契约跟改 + DRAFTING 弹层收尾

## 目标

把 web 端所有引用 `repo-` 前缀 / `repoIds` / `worktreePath` 的代码全部跟改；兑现 ADR-0016 D7 留的「`+ 添加新仓库` 入口」欠账。

## 子项

### 6.1 类型契约跟改

#### `apps/web/src/lib/repo-attach.ts`

```typescript
// 旧
import { AttachReposRequestSchema, AttachReposResponseSchema } from '@ai-devspace/shared'
export type AttachReposRequest = z.infer<typeof AttachReposRequestSchema>  // { repoIds, branchName }
export type AttachReposResponse = z.infer<typeof AttachReposResponseSchema>  // 含 repoId, worktreePath

// 新
// { repoNames, branchName } + { repoName, codebasePath }
```

`fetchRepoPool()` 改 `fetchRepoRegistry()`，返回 `{repos: [{name, gitUrl, description}]}`。

#### `apps/web/src/lib/drafting.ts`

```typescript
interface DraftingRepo {
  name: string         // ← 替换 id: string
  gitUrl: string       // ← 新增（显示需要）
  description: string  // ← 新增
}

interface DraftingData {
  // ...
  repos: DraftingRepo[]
  selectedRepoNames: string[]  // ← 替换 selectedRepoIds
  // ...
}
```

**删除** `GLOBAL_REPO_POOL` mock（已无 fallback 必要——yaml 是真相源；若 `fetchRepoRegistry` 失败，沿用 SSR 已注入的 `data.repos`，不要再降级到 mock）。

`getDraftingData(reqId)` 重写：SSR 路径直接走 `getDraftingDataFromFs`（已在 `drafting.server.ts`，issue 08 调整路径），mock 路径仅保留 `req-001` 的 demo。

#### `apps/web/src/lib/drafting.server.ts`

```typescript
function readAttachedRepoNames(reqDir: string): string[] {
  // 旧：readAttachedRepoIds（读 repos/ 子目录，加 repo- 前缀）
  // 新：读 codebase/ 子目录，直接是 name（不加前缀）
  const dir = join(reqDir, 'codebase')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))  // 过滤 .pending-
    .map((e) => e.name)
}

function readWorkspaceRepoRegistry(root: string): DraftingRepo[] {
  // 旧：扫 <root>/repos/ 子目录
  // 新：读 <root>/repos.yaml
  const yamlPath = join(root, 'repos.yaml')
  if (!existsSync(yamlPath)) return []
  const text = readFileSync(yamlPath, 'utf8')
  const parsed = yaml.parse(text)
  return parsed?.repos ?? []
}
```

### 6.2 组件跟改

#### `apps/web/src/components/attach-repos-dialog.tsx`

```typescript
interface AttachReposDialogProps {
  // ...
  availableRepos: DraftingRepo[]   // 字段变
  pickedRepoNames: string[]        // 替换 pickedRepoIds
  // ...
}

function handleSubmit() {
  const repoNames = Array.from(pickedRepoNames)
  attachReposToRequirement(requirementId, { repoNames, branchName })
}
```

Git URL 入口**删除**整段代码（决策 Q14）——改为弹层底部一行链接「没找到？去仓库页添加 →」。

#### `apps/web/src/components/repo-bar.tsx`

```typescript
interface RepoBarProps {
  // ...
  repos: DraftingRepo[]                    // 字段变
  selectedRepoNames: string[]              // 替换 selectedRepoIds
  failedRepoNames?: string[]               // 替换 failedRepoIds
  onDetachRepo: (name: string) => void
  // ...
}
```

chip 显示从 `repo-<name>` 改为 `<name>`；过滤逻辑去 `PLACEHOLDER_PREFIX`。

### 6.3 DRAFTING 工位 SSE 订阅

`apps/web/src/components/drafting-zone.tsx`：

```typescript
// 新增：订阅 repo-clone-progress 事件
useEffect(() => {
  if (!requirementId) return
  const eventSource = new EventSource(`/api/requirement/${requirementId}/events`)
  eventSource.addEventListener('repo-clone-progress', (e) => {
    const data = JSON.parse(e.data)
    updateRepoChipStatus(data.repoName, data.status)
  })
  return () => eventSource.close()
}, [requirementId])
```

### 6.4 测试

- `apps/web/src/__tests__/lib/repo-attach.test.ts` 重写：调用 `fetchRepoRegistry` + `attachReposToRequirement` 用新契约
- `apps/web/src/__tests__/drafting-zone.test.tsx` 跟改：`selectedRepoNames` 替换
- `apps/web/src/__tests__/components/attach-repos-dialog.test.tsx`：弹层无 Git URL 入口 + 跳转引导
- `apps/web/src/components/__tests__/attach-repos-dialog.test.tsx`：删除「Git URL input」相关测试

## 验收清单

- [ ] `repo-attach.ts` 全部 API 跟改
- [ ] `drafting.ts` 删除 `GLOBAL_REPO_POOL`；`getDraftingData` 不再降级到 mock
- [ ] `drafting.server.ts` 读 `codebase/` 子目录（不加前缀）；读 `repos.yaml`
- [ ] `attach-repos-dialog.tsx` props 改 `repoNames`；Git URL 入口删除；底部加跳转引导
- [ ] `repo-bar.tsx` props 改 `repoNames`；chip 显示纯 name
- [ ] `drafting-zone.tsx` SSE 订阅 `repo-clone-progress`
- [ ] 所有引用旧字段名的 `.test.ts(x)` 全 RED 后被新测试替代
- [ ] `data/mock.ts`（在 issue 07 范围）只保留 `req-001` demo 用例

## 风险

- `repo-bar.tsx` chip id 从 `repo-<name>` 变 `<name>` 是**视觉破坏性变更**——任何动画/截图/设计稿引用旧形态的要更新
- SSE 订阅必须在 issue 03 的 `requirementEventsRoute` 推送事件实现后才有意义——先 mock 事件测试，本期不阻塞

## 引用

- [PRD FR-3.4 / FR-5](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3 / D7](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q4 / Q12 / Q14](../decisions.md)
