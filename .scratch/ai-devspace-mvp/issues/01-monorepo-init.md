---
Status: ready-for-agent
Type: task
Stage: 1
---

# 01 - 初始化 Monorepo（pnpm + Turborepo）

## 目标

建立 `apps/web` + `apps/agent` + `packages/shared` 的 monorepo 骨架。

## 范围

- [ ] `package.json`（root）+ `pnpm-workspace.yaml` + `turbo.json`
- [ ] `apps/web/`：Next.js 14 + TypeScript + Tailwind + shadcn/ui 初始化
- [ ] `apps/agent/`：Node.js 20 + TypeScript + Fastify 初始化
- [ ] `packages/shared/`：跨端共享类型（Requirement、Repository、Artifact、Skill 等 TS 类型）
- [ ] 根 `tsconfig.base.json` 共享
- [ ] `.gitignore`、`.editorconfig`、ESLint + Prettier
- [ ] README 顶层写明项目结构与启动方式

## 验收

- `pnpm install` 成功
- `pnpm dev` 同时起 Web（3333）和 Agent（7777）
- `pnpm build` 全部构建通过

## 依赖

无
