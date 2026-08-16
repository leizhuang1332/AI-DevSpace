---
Status: ready-for-agent
Type: task
Created: 2026-08-16
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 无
ADR: docs/adr/0033-incremental-attach-repos.md
Supersedes: 无
---

# Issue 18: 追加仓库 = 增量追加(已关联视觉锁定 + submit filter)

## 背景

[apps/web/src/components/attach-repos-dialog.tsx](apps/web/src/components/attach-repos-dialog.tsx) 在 `mode='append'` 下:

- 渲染 `availableRepos` 全集(全部注册表仓库),checkbox 全可勾
- `pickedRepoNames` 默认勾选已关联仓库
- `handleToggleRepo` 允许 toggle 任何仓库
- `handleSubmit` 原样 `Array.from(selectedNames)` 上送

后端 [CodebaseManager.ts:266-277](apps/agent/src/codebase/CodebaseManager.ts#L266) 已有 `E_REPO_ALREADY_ATTACHED` 幂等校验,但用户从未真正收到这条错误(前端未渲染 per-repo 详情)。

## 用户原始诉求

> 追加仓库改为增量追加,而不是全量追加,已经关联的仓库,追加时复选框选中但置灰不允许再次操作,说明已经关联了,无需重复追加

## 目标

1. append 模式下,已关联仓库 = checkbox checked + disabled + 末尾「✓ 已关联」徽章 + 置顶排序
2. selectedNames 保留 pickedRepoNames 初值(UI 真相源);submit 时 filter 排除已关联
3. footer 数字 = 本次新增数(不含已关联)
4. 全已关联态 = 顶部绿色 banner「✓ 本需求已关联全部 N 个仓库,无需追加」

## 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `apps/web/src/components/attach-repos-dialog.tsx` | (a) 新增 `isAlreadyAttached = mode === 'append' && pickedRepoNames.includes(repo.name)` 派生;(b) 仓库列表排序:已关联置顶,同段内按 `pickedRepoNames` 顺序;(c) checkbox `disabled={isAlreadyAttached || inFlight}`;(d) 行末追加「✓ 已关联」徽章;(e) `handleSubmit` 加 filter:`Array.from(selectedNames).filter(n => !pickedRepoNames.includes(n))`;(f) 新增 `newPickCount = selectedNames - pickedRepoNames` 派生,footer 改用之;(g) `isAllAttached` 派生 + 顶部绿色 banner |
| 2 | `apps/web/src/components/__tests__/attach-repos-dialog.test.tsx` | 加测试:append 模式已关联仓库 disabled + 置顶 + 徽章 + 不在 onSubmit repoNames 里;footer 数字 = 新增数(不含已关联);全已关联态 banner + submit disable |

## 验收

- [ ] append 模式 + 已关联仓库 A → 渲染顺序 A 在最前,checkbox checked + disabled,行末「✓ 已关联」徽章
- [ ] append 模式 + 勾选新仓库 B → submit 携带 `repoNames: ['B']`(过滤掉 A)
- [ ] append 模式 + 仅已关联仓库 + 不勾任何新 → submit 按钮 disabled
- [ ] append 模式 + 注册表全已关联 → 顶部绿色 banner「✓ 本需求已关联全部 N 个仓库,无需追加」 + submit disable + 文案改「已全部关联」
- [ ] first 模式零改动(`isAlreadyAttached` 全 false)
- [ ] `web` 端 `pnpm test` 通过
- [ ] `pnpm tsc --noEmit` 通过

## 不做

- 「取消关联」功能(用户原始诉求明确"无需重复追加",不在本期范围)
- 自动去重已关联后剩余仓库全选(用户保留挑选权)