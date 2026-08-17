---
Status: ready-for-agent
Type: task
Created: 2026-08-17
Feature: workspace-root-editable
Parent: .scratch/workspace-root-editable/PRD.md
Blocked by: 03
Blocks: 07
ADR: docs/adr/0037-editable-workspace-root.md
Supersedes: 无
---

# Issue 05: web workspace section 行内编辑 v2 + useValidateWorkspaceRoot hook

## 背景

ADR-0037 D5: settings workspace section 当前 readOnly, 需要行内编辑 v2(readOnly + hover [✏️] → 编辑 → debounce 校验 → 保存 → restart banner)。

## 目标

替换 `apps/web/src/app/(workspace)/settings/sections/workspace.tsx` 全部内容;新增 `useValidateWorkspaceRoot` hook。

## 改动清单

### apps/web

| # | 文件 | 改动 |
|---|---|---|
| 1 | [apps/web/src/lib/config-hooks.ts](../../apps/web/src/lib/config-hooks.ts) | 新增 `useValidateWorkspaceRoot()` mutation: 调 `agentFetch('/api/workspace/validate-path', { method: 'POST', body: { path } })` |
| 2 | [apps/web/src/app/(workspace)/settings/sections/workspace.tsx](../../apps/web/src/app/(workspace)/settings/sections/workspace.tsx) | 重写: 接收 `info: WorkspaceInfo` (现含 `configDir` + `dataRoot`, 来自 issue 02); 三状态机: readOnly / editing / saving; editing 态下 input 自动 focus 全选 + debounce 300ms 调 validate hook + inline 三档提示色 (红/黄/绿) |
| 3 | 同上 | 保存成功 → 切回 readOnly + 显示 inline banner 「✓ 已保存 · 待重启 · [↻ 重启 Agent]」 (按钮调 `agentFetch('/api/agent/restart', { method: 'POST' })`) |
| 4 | [apps/web/src/__tests__/settings/workspace-section-inline-edit.test.tsx](../../apps/web/src/__tests__/settings/workspace-section-inline-edit.test.tsx) | 新建: 12 case (默认 readOnly / hover ✏️ / 编辑模式 focus / debounce validate / 红黄绿三档 / 保存 200 / 保存 400 errorCode / banner 出现 / 点 restart / 取消编辑回滚) |

### 不动(明确)

- `apps/web/src/app/(workspace)/settings/sections/{appearance,ai-experience,agent,danger}.tsx`
- `apps/web/src/lib/agent-client.ts`(沿用 `agentFetch`)
- `WorkspaceInfo` schema (issue 02 已扩字段, 本 issue 消费)

## 验收

- [ ] web 编译通过
- [ ] 新单测 12 case 全过
- [ ] web 全套件零 regression
- [ ] 手动跑 `pnpm dev` → 进 /settings → workspace section → hover → ✏️ → 编辑 → 三档提示分别验证 → 保存 → banner → 点 restart → 见 issue 06 banner