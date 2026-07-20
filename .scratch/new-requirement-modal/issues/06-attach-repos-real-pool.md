---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 06 — 关联仓库弹层对接真实仓库池(GET /api/repos)

**What to build:**

兑现 [`new-requirement-modal/PRD.md`](../PRD.md) §12 验收清单中"资源树 `[+]` → 弹 480px 关联仓库弹层 → 勾选 repo"的 read 侧最后一公里。当前 [`apps/web/src/lib/drafting.ts`](../../../apps/web/src/lib/drafting.ts) 的 `GLOBAL_REPO_POOL` + `REFUND_DRAFTING.repos` 是写死 mock,需要换成从 Agent 实时拉到的真实仓库池。

### 1. Agent 端:新增 `GET /api/repos` 端点

- 路径:`apps/agent/src/routes/repos.ts`(新建)
- 行为:每次请求 `readdirSync('~/.aidevspace/repos/', { withFileTypes: true })`,取所有子目录
- 转换:每个 `dirent.name` → `{id: 'repo-' + dirent.name, name: dirent.name}`(决策 α / 沿用现有 slug)
- **不**校验 `.git/`(决策 α)
- 目录不存在 → 返 `{repos: []}` 200(决策 x);**不** 404
- 读取失败(权限等) → 返 500 + `{error: 'E_REPO_DIR_READ_FAILED'}`
- 注册:在 `apps/agent/src/server.ts` 的路由聚合里挂上(参考现有 `workspace.ts` / `requirement.ts` 的挂法)

### 2. shared 包:新增 `ReposResponseSchema`

- 路径:`packages/shared/src/repos.ts`(新建)
- 导出:`ReposResponseSchema` = `z.object({ repos: z.array(z.object({id: z.string(), name: z.string()})) })`
- 在 `packages/shared/src/index.ts` re-export

### 3. web 端 `lib/repo-attach.ts`:补 `fetchRepoPool()` API wrapper

- 在已有 `attachReposToRequirement()` 旁边新增 `fetchRepoPool(opts?: {signal?: AbortSignal}): Promise<ReposResponse>`
- 入参 / 出参 schema 双重校验(沿用既有模式)
- 错误透传 `AgentError`(非 2xx 抛)

### 4. web 端 `lib/drafting.ts`:`getDraftingData()` 注入真实仓库池

- `emptyDrafting()`:把 `repos: [...GLOBAL_REPO_POOL]` 改成 `repos: await fetchRepoPool().then(r => r.repos).catch(() => [])`
- `REFUND_DRAFTING.repos`:**保留**为 mock fallback(开发环境断网时仍能演示);在 `getDraftingData()` 里走 try/catch:fetchRepoPool 成功 → 用真实数据;失败 → fallback 到 `REFUND_DRAFTING.repos`
- `GLOBAL_REPO_POOL` 常量**保留**(被 `emptyDrafting` 用作失败 fallback 与单测 fixture)

### 5. web 端 `drafting-zone.tsx`:弹层打开时 refetch 兜底

- 在 `AttachReposDialog` 实例化处加 `useEffect`:`open === true` 时调 `fetchRepoPool()` → 更新 `data.repos`
- 弹层组件本身**不改**(决策 iii — 数据来源切换发生在父组件)
- 错误处理:refetch 失败 → 沿用当前 `data.repos`(决策 iii 的"初始集保底")

### 6. web 端 `attach-repos-dialog.tsx`:"+ 添加新仓库(粘贴 Git URL)" 入口收尾

- 在 `showNewRepo` 展开的 input 下方新增一行灰色 hint:`📋 粘贴 Git URL · 即将上线`(决策 u)
- 当 `newRepoUrl.trim() !== ''` 时:`canSubmit` 强制为 false(决策 u 禁用提交)
- 后续 ticket 接入 `POST /api/repos`(create + clone)后,移除禁用逻辑并把 URL 真传给后端

---

**Blocked by:** None — 可独立起,优先级排在 issue 02 后(沿用同一份 agent service 拓扑)。

**依赖关系图:**

```
issue 01(弹层 UI)        ─┐
issue 02(POST 端点 + worktree 实装) ─┐
                                    ├─→ 本 ticket(GET 端点 + 数据流)
issue 04(后端 API + 目录结构) ──────┘
```

---

**Status:** ready-for-agent

### 验收清单

- [ ] `GET /api/repos` 端点存在,返回 `{repos: [{id, name}]}` 形态
- [ ] 当 `~/.aidevspace/repos/` 不存在(全新安装)→ 返 `{repos: []}` 200,不报错
- [ ] 当 `~/.aidevspace/repos/` 存在但空 → 返 `{repos: []}` 200
- [ ] 当 `~/.aidevspace/repos/` 存在且有子目录 → 子目录名映射成 `{id: 'repo-<name>', name: '<name>'}`
- [ ] 单元测试覆盖:目录不存在 / 空目录 / 正常目录三种情形
- [ ] `getDraftingData()` 改为 `await fetchRepoPool()`,空草稿态默认有列表
- [ ] `getDraftingData()` 在 fetch 失败时 fallback 到 `REFUND_DRAFTING.repos`
- [ ] 弹层打开时 `useEffect` 触发 refetch,成功 → 列表刷新;失败 → 保持当前列表
- [ ] `attach-repos-dialog.tsx` 添加"📋 粘贴 Git URL · 即将上线" hint
- [ ] `newRepoUrl.trim() !== ''` 时 `[✓ 添加]` 按钮 disabled
- [ ] `DraftingRepo` 类型 / `GLOBAL_REPO_POOL` / 既有单测 fixture 保持兼容(无破坏性变更)
- [ ] E2E:`pnpm dev` 进入 DRAFTING → 顶部 banner `[+ 关联仓库]` → 弹层显示真实仓库(预先 `mkdir ~/.aidevspace/repos/foo bar baz` 三个文件夹) → 勾选提交 → RepoBar 显示对应 chips
- [ ] E2E:删除 `~/.aidevspace/repos/foo` → 刷新 DRAFTING → 弹层列表少一项