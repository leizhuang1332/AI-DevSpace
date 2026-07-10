---
Status: resolved
Type: task
Stage: 1
---

# 01 - 初始化 Monorepo（pnpm + Turborepo）

## 目标

建立 `apps/web` + `apps/agent` + `packages/shared` 的 monorepo 骨架。

## 范围

- [x] `package.json`（root）+ `pnpm-workspace.yaml` + `turbo.json`
- [x] `apps/web/`：Next.js 14 + TypeScript + Tailwind + shadcn/ui 初始化
- [x] `apps/agent/`：Node.js 20 + TypeScript + Fastify 初始化
- [x] `packages/shared/`：跨端共享类型（Requirement、Repository、Artifact、Skill 等 TS 类型）
- [x] 根 `tsconfig.base.json` 共享
- [x] `.gitignore`、`.editorconfig`、ESLint + Prettier
- [x] README 顶层写明项目结构与启动方式

## 验收

- `pnpm install` 成功
- `pnpm dev` 同时起 Web（3333）和 Agent（7777）
- `pnpm build` 全部构建通过

## 依赖

无

## Comments

- 2026-07-10：issue 落地完成。**Commit sha：未 commit**（用户硬约束禁止 `git add/commit/push`）。所有变更位于 working tree，基线为 `87e39ba`，相对基线修改/新增见 PR 描述草稿中的「Files changed」一节。摘要：`apps/agent` 骨架（Fastify v5 + `/api/health`，含 vitest + tsx + cross-platform isMain）、顶层 `turbo.json`（build/dev/typecheck/test/lint）+ 根脚本（`dev` 并行 web+agent、`dev:web`、`dev:agent`、lint/format/format:check）、顶层 ESLint v9 flat config（排除 `apps/web/**` 以遵守不冲突约束）+ Prettier + `.editorconfig`、顶层 README。四 slice 全部 TDD red→green 通过；`/code-review` 两轮后 Critical=0 / Important=0 / Minor=1（`pnpm dev` 一次性 Ctrl+C 退两进程的 trade-off 已在 README 间接说明，未直白写出，Minor 可接受）。
