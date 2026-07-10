# AI DevSpace

> 本机运行的「AI 原生软件工程工作台」——以"需求"为工作单位，用文件系统统一管理多仓库、产物、知识与 AI 会话。AI 智能外包给 Claude Code SDK，平台只做"状态编排 + 上下文装配 + UI 协同"。

详细产品定义见 [`.scratch/ai-devspace-mvp/PRD.md`](.scratch/ai-devspace-mvp/PRD.md)，UI 打磨设计稿见
[`.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md`](.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md)，架构决策见 [`docs/adr/`](docs/adr/)。

## 项目简介

AI DevSpace 是一个 pnpm + Turborepo 管理的 monorepo，由以下子包组成：

| 子包              | 角色                                                 | 端口   | 状态                   | 技术栈                                                      |
| ----------------- | ---------------------------------------------------- | ------ | ---------------------- | ----------------------------------------------------------- |
| `apps/web`        | Web 工作台（UI、交互、状态镜像）                     | `3333` | 已可启动               | Next.js 14 (App Router) · TypeScript · Tailwind · shadcn/ui |
| `apps/agent`      | 本机 Agent 守护进程（SDK 调度、FS、git、Skill 加载） | `7777` | 骨架已落地（issue 01） | Node.js 20 · TypeScript · Fastify v5                        |
| `packages/shared` | 跨端共享类型（SSE 事件、REST 契约、状态枚举）        | —      | 占位（待 issue 03+）   | TypeScript                                                  |

Web 与 Agent 通过 localhost 上的 **HTTP REST + SSE** 通信：客户端 → Agent 走 REST，Agent → 客户端走 SSE
长连推送 AI 输出 / 状态变更 / 错误。鉴权由 issue 03 引入（动态 Token + Origin 校验）。

## 目录结构

```
.
├── apps/
│   ├── web/                # Next.js 14 Web 工作台（端口 3333）
│   └── agent/              # Fastify 守护进程（端口 7777）
├── packages/
│   └── shared/             # 跨端共享类型（SSE 事件、REST 契约、状态枚举）
├── docs/
│   ├── adr/                # 架构决策记录
│   ├── design/             # 设计相关文档
│   └── superpowers/        # 计划与规范
├── .scratch/
│   └── ai-devspace-mvp/    # 产品 PRD、设计稿、issue 与 ADR 草稿
├── turbo.json              # Turborepo 任务编排
├── pnpm-workspace.yaml     # pnpm workspace 定义
├── tsconfig.base.json      # 共享 TypeScript 配置
├── eslint.config.js        # 顶层 ESLint flat config（v9）
├── .prettierrc             # Prettier 配置
├── .editorconfig           # 编辑器基础风格（LF / UTF-8 / 2 空格）
└── package.json            # 根脚本与 devDeps
```

## 启动方式

环境要求：**Node.js ≥ 20**、**pnpm ≥ 9**。

```bash
# 1. 安装依赖（首次或依赖变更后）
pnpm install

# 2. 同时启动 Web（3333）和 Agent（7777）
pnpm dev
```

`pnpm dev` 同时拉起两个进程（用 `pnpm -r --parallel --filter=./apps/*`），输出会交错。只想跑单个：

```bash
pnpm dev:web     # 仅 Web（端口 3333）
pnpm dev:agent   # 仅 Agent（端口 7777）
```

启动后访问 `http://localhost:3333`。Agent 健康检查：

```bash
curl http://localhost:7777/api/health
# → {"ok":true,"name":"agent"}
```

## 测试与构建命令

| 命令                | 说明                                                    |
| ------------------- | ------------------------------------------------------- |
| `pnpm typecheck`    | 跨所有 workspace 跑 `tsc --noEmit`（由 Turborepo 编排） |
| `pnpm test`         | 跨所有 workspace 跑测试（agent 用 vitest）              |
| `pnpm build`        | 跨所有 workspace 构建产物                               |
| `pnpm lint`         | 跨所有 workspace 跑 ESLint（顶层 flat config）          |
| `pnpm format`       | 用 Prettier 格式化仓库内可解析文件                      |
| `pnpm format:check` | 仅检查不写入（CI 友好）                                 |

## 当前进度

按 issue 顺序落地，地基阶段（`apps/*` 骨架 + monorepo 工具链）见
[`.scratch/ai-devspace-mvp/issues/`](.scratch/ai-devspace-mvp/issues/)。

本仓库本次变更对应 issue 01，覆盖：

- 新建 `apps/agent/`（Fastify v5 + `/api/health` 占位）
- 顶层 `turbo.json` + `dev` / `dev:web` / `dev:agent` / `build` / `typecheck` / `test` / `lint` / `format` 脚本
- 顶层 `.editorconfig` + ESLint v9 flat config + Prettier
- 顶层 README

后续 issue（Agent SSE / workspace 初始化 / 需求 CRUD / 仓库 worktree / AI 对话面板 / 内置 Skill 等）按
PRD §11 实施路线推进。

## 许可

未指定。
