---
Status: ready-for-human
Type: prd
Created: 2026-07-08
Feature: ai-devspace-mvp
---

# AI DevSpace MVP — 产品形态定稿（PRD v1.0）

> 解决后端开发者在 Vibecoding 流程中"多项目切换、产物散落、规范缺失、知识无沉淀"等痛点的本机工作台。

---

## 1. 一句话定位

**AI DevSpace** 是一个**本机运行的「AI 原生软件工程工作台」**：以"需求"为工作单位，通过文件系统统一管理多仓库、产物、知识与 AI 会话，AI 智能完全外包给 Claude Code SDK，自己只做"状态编排 + 上下文装配 + UI 协同"。

---

## 2. 用户故事回顾

### 目标用户
后端开发者，全面使用 Vibecoding（AI 辅助编程），后端架构为微服务。

### 核心痛点
1. 多项目频繁切换 AI 上下文
2. 没有全局项目管理与进度跟踪
3. 无统一代码规范
4. 无统一测试规范
5. 无验收标准
6. 中间产物（SQL、Apollo 配置等）容易丢失
7. 同样的问题重复解决，知识无沉淀

### 期望
一个开发工作台，所有开发活动在此进行；以需求为单位组织；支持多需求并发；知识沉淀。

---

## 3. 核心架构

```
[浏览器 localhost:3333]
    ↓ HTTP/WS
[Next.js Web 工作台]
    ↓ HTTP/WS (localhost)
[Node Agent 守护进程 localhost:7777]
    ├─ 需求调度器
    ├─ Skill 加载器
    ├─ Git Worktree 管理
    └─ Claude Code SDK subprocess 池（每需求一个）
        ↓
    [~/.aidevspace/ 文件系统]
        ↓ HTTPS
    [Anthropic Claude Code API]
```

**职责划分**：

| 层 | 职责 | 不做什么 |
|---|---|---|
| Web | UI、交互、状态镜像 | 不直连 FS、不跑 git、不调 LLM |
| Agent | 调度 SDK、FS、git、Skill | 不做 UI、不直接推理 |
| Claude Code SDK | 真实 AI 智能 | 不感知"需求"概念 |
| FS | 所有数据持久化 | — |

---

## 4. 数据架构（`~/.aidevspace/`）

```
~/.aidevspace/
├── config.yaml
├── requirements/
│   └── req-<id>-<slug>/
│       ├── meta.yaml
│       ├── requirement.md
│       ├── analysis/        (01-understanding.md, 02-questions.md, 99-summary.md)
│       ├── design/          (01-database.md, 02-api.md, 03-service.md, 99-summary.md)
│       ├── plan/            (tasks.md)
│       ├── artifacts/       (schema.sql, openapi.yaml, apollo.yaml, ...)
│       ├── conversations/   (001-analyze.md, 002-design.md, 003-code.md, ...)
│       ├── notes/
│       └── repos/           (worktree 形式：<repo-name>/)
├── repos/                   (全局仓库池)
├── knowledge/               (domain/, patterns/, bugs/, index.yaml)
├── skills/
│   ├── _built-in/           (analyze-stage, design-stage, plan-stage, code-stage, test-stage, submit-stage)
│   └── user/
└── logs/
```

---

## 5. 信息架构（Web 工作台 IA）

### 一级导航
`🏠 概览` | `📌 需求` | `📦 仓库` | `📚 知识` | `🤖 Skill` | `⚙️ 设置`

### 页面树
```
/                         概览 Dashboard
/requirements             需求列表
/requirements/:id         需求详情页（核心）
  ├─ /workspace           工作区（默认）
  ├─ /repos               关联仓库
  ├─ /artifacts           产物
  ├─ /history             对话与变更
  └─ /settings            需求设置
/repos                    仓库列表
/repos/:name              仓库详情
/knowledge                知识库
/skills                   Skill 管理
/settings                 全局设置
```

---

## 6. 核心页面布局

### 6.1 概览 Dashboard

- 进行中需求（卡片网格）
- 当前活跃会话（带操作按钮：查看对话 / 打开 IDEA / 查看 Diff）
- 待办（AI 提问待回答 / 需用户决策）

### 6.2 需求详情页（核心，IDE + 项目管理混合）

**三栏布局**：
- **左 240px**：资源树（PRD / 分析 / 设计 / 计划 / 产物 / 对话 / 仓库）
- **中 flex**：主工作区（动态 Tab：Markdown 渲染、代码 Diff、文件树）
- **右 360px**：AI 助手（当前 Skill、对话气泡、工具调用、@引用、运行按钮）

### 6.3 AI 对话面板

- 展示真实工具调用（文件读取、shell 命令、git 操作）
- 每次 AI 行为必须产生文件产物
- `@引用语法`：`@file design/02-api.md` → 注入上下文
- `▶ 运行当前 Skill` 按钮 = 加载 Skill 提示词 + 注入上下文 + 跑 SDK + 落盘

---

## 7. 端到端核心流程

### 创建需求 → 完成需求

```
1. 首页 [+ 新建需求] → 弹窗：名称、关联 repo、粘贴 PRD
   ↓
   自动创建 requirements/req-xxx/ 结构 + git worktree
   ↓
2. 进入详情页 → 点击 [▶ 运行 analyze-stage]
   ↓ Agent 加载 Skill 提示词 + 注入 PRD + 启动 SDK 子进程
   ↓ 流式回传 → 落盘 analysis/*  → meta.yaml: status=CLARIFYING
   ↓
3. 用户回答 AI 问题 → 继续
   ↓
4. [▶ design-stage] → [▶ plan-stage] → [▶ code-stage] → [▶ test-stage] → [▶ submit-stage]
   ↓
5. submit 完成：AI 自动 commit + push（用户授权）
   ↓ status=DONE → 需求归档
```

### 多需求并发

- 每个需求 = 一个独立 Tab = 一个独立 SDK 子进程
- 切换 Tab = 切换会话（不丢失进度）
- 同时跑 ≥3 个 AI 任务（Agent 进程池管理）

---

## 8. MVP 范围

### ✅ P0 必做
- 工作空间初始化（`~/.aidevspace/`）
- 需求 CRUD + 详情页 + 状态切换 + 归档
- 仓库管理（全局池 + git worktree）
- AI 对话：Web 端 chat UI + Agent 端 SDK 子进程 + 流式回传
- Skill 加载：6 个内置 Skill（analyze/design/plan/code/test/submit）
- 产物管理：文件浏览 + @引用注入
- 知识库：浏览 + 新增 + AI 自动沉淀
- 规范中心：用户编写"代码规范.md"挂知识库

### ❌ P0 不做
- 团队协作
- 真实插件市场 / Skill 远程安装
- 拖拽式流程编排
- Web 端代码编辑
- 移动端
- 多 LLM Provider

### MVP 验收
- 一台本机跑通"创建需求 → AI 分析 → 设计 → 编码 → 提交"完整流程
- 同时管理 ≥3 个需求，各有独立 AI 会话
- 关闭 Web 再打开，所有状态、对话、产物完整恢复
- 删除 `~/.aidevspace/` 等同于完全卸载

---

## 9. 技术栈

| 层 | 技术 |
|---|---|
| Web | Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui |
| Web ↔ Agent | HTTP REST + WebSocket（原生 ws） |
| Agent | Node.js 20 + TypeScript + Fastify |
| AI | `@anthropic-ai/claude-code` SDK（subprocess） |
| Git | `simple-git` + 原生 `git worktree` |
| FS | 原生 fs + `gray-matter`（YAML frontmatter） |
| Markdown | `react-markdown` + `rehype-highlight` |
| Diff | `react-diff-viewer-continued` |
| Web 状态 | Zustand |
| 数据获取 | TanStack Query |
| Monorepo | pnpm + Turborepo（apps/web + apps/agent + packages/shared） |

---

## 10. 关键决策（11 条）

| # | 决策 |
|---|------|
| 1 | 产品形态 = D 混合（Web + 本机 Agent） |
| 2 | 存储 = 纯文件系统（必要时 sqlite3） |
| 3 | 工作空间根 = `~/.aidevspace/` |
| 4 | 仓库 = 全局共享 + git worktree 隔离 |
| 5 | 部署 = 本机单用户（Web 3333 + Agent 7777） |
| 6 | AI 推理 = Claude Code SDK（外包 harness） |
| 7 | AI 架构 = 单一 Agent + 阶段 Skill 模板 |
| 8 | 多会话 = 每需求独立 chat 窗口（独立子进程） |
| 9 | 上下文 = 分层注入 + 阶段间自动压缩 |
| 10 | 流程 = 由 Skill 驱动（不写死） |
| 11 | MVP 单用户、桌面优先 |

详细论证见 `.scratch/ai-devspace-mvp/decisions/` 下的 ADR。

---

## 11. 实施路线

### 阶段 1：地基（2 周）
- [01-monorepo-init.md](issues/01-monorepo-init.md)
- [02-workspace-init.md](issues/02-workspace-init.md)
- [03-agent-skeleton.md](issues/03-agent-skeleton.md)
- [04-web-skeleton.md](issues/04-web-skeleton.md)

### 阶段 2：核心闭环（3 周）
- [05-requirement-crud.md](issues/05-requirement-crud.md)
- [06-repo-worktree.md](issues/06-repo-worktree.md)
- [07-ai-chat-panel.md](issues/07-ai-chat-panel.md)
- [08-builtin-skills.md](issues/08-builtin-skills.md)

### 阶段 3：体验打磨（2 周）
- [09-knowledge-base.md](issues/09-knowledge-base.md)
- [10-coding-standards.md](issues/10-coding-standards.md)
- [11-dashboard.md](issues/11-dashboard.md)

### 阶段 4：MVP 验收（1 周）
- 端到端跑通 3 个真实需求
- 文档、README、Demo
- 打包发布

---

## 12. 不在范围内（明确剔除）

- 真实的多用户/团队协作
- 云端 SaaS
- Web 端代码编辑
- 移动端
- 自建 LLM 推理
- 真实插件市场与远程安装
- 拖拽式流程编排
- 多 LLM Provider 切换

## Comments
