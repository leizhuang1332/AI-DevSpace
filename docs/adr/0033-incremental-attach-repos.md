# ADR-0033: 追加仓库 = 增量追加(已关联视觉锁定 + submit filter)

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** 项目负责人
**Implements:** `.scratch/repo-registry-clone/issues/18-incremental-attach-repos.md`
**关联 ADR:** [ADR-0016 D7](0016-attach-repos-real-pool.md#d7--添加新仓库粘贴-git-url-入口过渡期处理-保留--hint) / [ADR-0030](0030-repo-registry-and-per-requirement-clone.md) D5 / 决策 109

---

## Context

[attach-repos-dialog.tsx](apps/web/src/components/attach-repos-dialog.tsx) 在 `mode='append'` 下:

- 渲染 `availableRepos` 全集(全部注册表仓库),checkbox 全可勾
- `pickedRepoNames` 默认勾选已关联仓库(`new Set(pickedRepoNames)`,line 137)
- `handleToggleRepo` 允许 toggle 任何仓库(用户可取消勾选已关联的)
- `handleSubmit` 原样 `Array.from(selectedNames)` 上送

后端 [CodebaseManager.ts:266-277](apps/agent/src/codebase/CodebaseManager.ts#L266) 已有 `E_REPO_ALREADY_ATTACHED` 幂等校验(决策 109),即后端会拒绝重复关联。

### 问题

- 用户在 append 模式看到「已关联的仓库还显示在可选列表里」,认知负担:"我能再点它吗?再点会发生什么?"
- 取消勾选已关联的仓库 + 提交 → 后端过滤掉(`E_REPO_ALREADY_ATTACHED` 错误)→ 用户看不到结果(前端只显示"关联中...",实际部分失败被吞掉)
- 后端 `E_REPO_ALREADY_ATTACHED` 错误路径从未真正到达用户(前端未渲染 per-repo 错误详情),后端日志有噪音

### 用户原始诉求

> 追加仓库改为增量追加,而不是全量追加,已经关联的仓库,追加时复选框选中但置灰不允许再次操作,说明已经关联了,无需重复追加

## Decision

### 1. 同列表混合渲染(已关联与未关联同段,不分组)

`availableRepos` 仍渲全集,不分段;每行根据 `mode === 'append' && pickedRepoNames.includes(repo.name)` 决定状态。

理由:用户视角"我关联了哪些"和"还能加哪些"是一件事两面,分两段割裂信息;决策 17 Linear 紧凑型倾向单列表密度高。

### 2. 已关联行 = 排序置顶 + checkbox disabled + "✓ 已关联" 徽章

```tsx
const isAlreadyAttached = mode === 'append' && pickedRepoNames.includes(repo.name)

// 排序:已关联置顶,同段内保持 pickedRepoNames 顺序(用户最早关联的在最前)
const sortedRepos = [
  ...pickedRepoNames
    .map(n => availableRepos.find(r => r.name === n))
    .filter(Boolean),
  ...availableRepos.filter(r => !pickedRepoNames.includes(r.name)),
]
```

渲染:

- checkbox `checked={true}`(始终)
- checkbox `disabled={true}`(无法 toggle)
- input `disabled={isAlreadyAttached || inFlight}`(合并 in-flight 兜底)
- 行末追加 `<span className="...">✓ 已关联</span>` 徽章

理由:置顶暗示"这些不能再加",核对现状优先于"还能加哪些"(决策 17 + 决策 19 中文优先)。

### 3. selectedNames = "本次新增" 容器,submit 时 filter

**保留现状**:`selectedNames` 初始 `new Set(pickedRepoNames)`(已关联包含在内),`handleToggleRepo` 仅在用户能 toggle 的仓库上调用(disabled input 不触发 onChange)。

**submit 时 filter**:

```ts
const finalRepoNames = Array.from(selectedNames).filter(
  (name) => !pickedRepoNames.includes(name),
)
```

理由:

- **深度防御**:React state 可能因重渲染 / 异步数据漂移出现 pickedRepoNames 与 selectedNames 不一致(典型:用户打开弹层时 SSR 未拿到最新 pickedRepoNames,后端已经新关联一个);前端过滤保证后端永远收不到已关联 name
- **后端日志干净**:`E_REPO_ALREADY_ATTACHED` 不再产生(决策 109 退化用于后端 bug 防御)
- **selectedNames 不收缩**:UI 状态保留"用户点过什么"全集,未来若加"批量取消关联"功能可直接复用;filter 是"提交时推导值",单一职责

### 4. footer 数字 = 本次新增数

```ts
const newPickCount =
  [...selectedNames].filter((n) => !pickedRepoNames.includes(n)).length
```

footer 左文案从 `追加 ${pickedRepoCount} 个仓库` 改为 `追加 ${newPickCount} 个仓库 · 沿用 ${lockedBranchName}`。

理由:"追加 N 个"语义指向"新增 N 个",与 submit payload 严格一致;已关联数从置顶区一眼可数,footer 不必重复。

### 5. 全已关联态 = 顶部绿色提示 banner

```tsx
{isAllAttached && (
  <div className="...绿色 banner...">
    ✓ 本需求已关联全部 {availableRepos.length} 个仓库,无需追加
  </div>
)}
```

`isAllAttached = mode === 'append' && availableRepos.every(r => pickedRepoNames.includes(r.name))`。

checkbox 列表仍渲染(全置灰),让用户能再次核对 gitUrl / description;submit 按钮 disable + 文案改 "已全部关联"。

理由:

- 给"我没事可做"明确反馈,避免用户疑惑"是不是 bug"
- 完全去掉列表会丢失已关联的 gitUrl / description 信息(用户可能想再次核对);点击「追加仓库」就是为了"看一眼当前状态"也是合法用途

## Consequences

### 正面

- 用户认知清晰:看到「✓ 已关联」就知道不能再点,不会产生"再点会发生什么"疑问
- 后端 `E_REPO_ALREADY_ATTACHED` 错误码路径不再走(噪声减少)
- 全已关联态有明确反馈,不是空白弹层
- 与决策 17 Linear 紧凑型 + 决策 19 中文优先契合

### 代价

- 前端组件复杂度上升:`isAlreadyAttached` 派生 + 排序 + filter + 数字重算 4 处逻辑
- 父组件 caller 需保证 append 模式 `pickedRepoNames` 是当前已关联 name 列表(已实现,契约不变)
- 新增测试覆盖(append 模式已关联 disabled / 置顶 / 徽章 / filter / 全已关联 banner)

### 兼容性

- first 模式零改动(`mode !== 'append'` 时 `isAlreadyAttached` 全 false,等价旧行为)
- `pickedRepoNames=[]` 时的 append 模式零改动
- 后端契约零改动(仍然接受任意 `repoNames[]`,前端过滤保证不含已关联)

## Alternatives Considered

### A. 分两段(已关联只读列表 + 可选 checkbox 列表)

**否决:**

- 上下两段割裂信息,用户需左右扫视才能拼出完整关联视图
- 信息密度低,与决策 17 Linear 紧凑型相悖
- N 大时分段优势才显著,而仓库注册表 < 100(决策 74)

### B. selectedNames 同步收缩(去掉已关联)

**否决:**

- checkbox 的 `checked={selectedNames.has(name)}` 依赖 selectedNames 包含已关联才能渲染为 checked
- 收缩后需另写 `isAlreadyAttached` 派生逻辑("checked" 真相源分裂到两处),与"submit 单一职责 filter"方案相比更绕
- 提交时仍需 filter(因 selectedNames 已不含已关联,filter 退化为 no-op) — 表面"省一行"实则换来状态真相源分裂

### C. footer 显示双数("新增 X · 已关联 Y")

**否决:**

- 已关联数从置顶区一眼可数,footer 重复冗余
- 双数稀释"我刚点了几个"的动作感,与决策 15 用户意图驱动相悖

### D. 不特殊处理全已关联态(让置灰列表自然表达)

**否决:**

- 缺乏"我没事可做"的明确反馈,用户需要自己数"几个全灰了",违反决策 43"AI 状态始终可见"的「出错也要让人懂」哲学延伸

## 引用

- [ADR-0016 D7](0016-attach-repos-real-pool.md#d7--添加新仓库粘贴-git-url-入口过渡期处理-保留--hint)
- [ADR-0030 D5 / 决策 109](0030-repo-registry-and-per-requirement-clone.md)
- [Issue 18](../.scratch/repo-registry-clone/issues/18-incremental-attach-repos.md)
- [apps/web/src/components/attach-repos-dialog.tsx](../apps/web/src/components/attach-repos-dialog.tsx)
- [apps/agent/src/codebase/CodebaseManager.ts:266-277 E_REPO_ALREADY_ATTACHED](../apps/agent/src/codebase/CodebaseManager.ts#L266)