# ADR-0031: `branchName` 与 upstream 默认分支同名时前置校验

**Status:** Accepted
**Date:** 2026-08-15
**Deciders:** 项目负责人
**Implements:** `.scratch/repo-registry-clone/issues/12-branch-name-vs-default-branch.md`
**Supersedes:** [ADR-0030](0030-repo-registry-and-per-requirement-clone.md) D5 决策 111(部分)
**关联 ticket:** Issue 03 / 09 / 10 / 11(兜底层修复)

---

## Context

[ADR-0030 D3](0030-repo-registry-and-per-requirement-clone.md#d3-需求关联--独立-git-clone) + Issue 03 实现 `git clone + git checkout -b` 流程:

1. `git clone <gitUrl> <codebasePath>` —— 完整 clone + checkout HEAD
2. `git -C <codebasePath> checkout -b <branchName>` —— 在 HEAD 上创建新分支

第 2 步在「`branchName` 与 upstream 默认分支同名」(典型:用户填 `main` 或 `master`)时**必败**:

```
fatal: A branch named 'main' already exists.
```

ADR-0030 D5 决策 111 注释「全新 clone 不可能撞本地分支」边界理解错误:

- `git clone` 本身不撞本地分支(全新仓库,本地无分支)
- 但 `git checkout -b <branchName>` **会撞** —— 因为 clone 后本地默认分支已经存在

## Decision

1. **新增错误码 `E_BRANCH_EXISTS`** —— `RepoAttachErrorCode` 联合扩展(包名 `@ai-devspace/shared`)
2. **`RequirementService.attachRepo`** 入口先跑 `git ls-remote --symref <gitUrl> HEAD`,与 `branchName` 比对;同名 → 返 `E_BRANCH_EXISTS`,**不调 git clone**(避免产生孤儿 .git)
3. **ls-remote 失败**(网络 / 鉴权 / 仓库空 / stdout 无 symref 行)→ 返回 `null`,不阻断 attach —— 降级策略:让原 `git checkout -b` 失败路径处理(与现有 `E_NETWORK` 等错误码语义一致)
4. **未注入 `git`** 的 RequirementService(测试场景常见)→ 跳过前置校验,走原 clone 路径(向后兼容)

`RepoAttachErrorCode.E_BRANCH_EXISTS` 加进 `PER_REPO_ERROR_CODES`(per-repo 结果允许返),前端 `attach-repos-dialog.tsx` 在拿到这个 code 时显示红色 banner「分支名与上游默认分支冲突,请改名」。

`mapCloneError` 不再生成 `E_BRANCH_EXISTS`(由前置校验处理,不依赖 stderr 文本固定格式)。

## Consequences

### 正面
- 用户输入 `branchName: "main"` 立刻看到 `E_BRANCH_EXISTS` 红色 banner,而不是先看到「cloning」再失败
- 日志不再出现 `safeRm gave up after 3 retries`(因为根本不调 clone)
- Issue 09/10/11 的「兜底自愈」链路不再被这条路径触发 —— 根治而非治标

### 代价
- `attachRepo` 多一次 `git ls-remote --symref` 网络调用 (~200ms);attach 是低频操作(< 10 次/用户/天),总延迟影响可忽略
- `RepoAttachErrorCode` 联合扩展 —— 前端必须新增 case 处理,否则显示「未分类错误」
- `ls-remote` 在仓库私密 / 鉴权失败时可能 hang —— 由 `createDefaultGitExec` 强制 env(Issue 05)+ 5min timeout 兜底

### 兼容性
- happy path 完全不变(branchName 与 default 不同名 → 走原 clone 路径)
- 未注入 `git` 的旧测试 / 旧调用方零改动

## Alternatives Considered

### A. 前端拦截 `BRANCH_FORBIDDEN_RE` 加 `main`/`master`
**否决:** 多语言 / 多平台 default 分支名(main / master / develop / trunk / default 等)穷举会漏,且与 SSR + 后端兜底契约冲突。

### B. 用 `git init` + 手工 fetch + checkout,完全跳过 clone 默认分支
**否决:** 偏离 ADR-0030 D3 决策「独立 git clone」语义,实现复杂度高,无明显收益。

### C. 在 `CodebaseManager.clone()` 内用 try/catch + stderr 文本匹配「already exists」
**否决:** 依赖 stderr 文本固定格式(易碎,git 版本差异大),且走到了必败路径才 fail —— 不符合 Issue 09 的「safeRm 兜底」目标。

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3 / D5](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- Issue 03(checkout -b 流程初版)
- Issue 09 / 10 / 11(兜底层修复,本 issue 是根治)