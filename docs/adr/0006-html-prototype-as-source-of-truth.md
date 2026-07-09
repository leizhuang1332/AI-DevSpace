# ADR-0006: HTML 原型仓（docs/design/pages/）作为 MVP 前端落地的单一视觉对照标准

**Status:** Accepted  
**Date:** 2026-07-09  
**Deciders:** 项目负责人

## Context

仓库内"原型 / spec / mock / 设计稿"分散在多处，造成实施 agent 决策漂移：

| 文档 | 形态 | 用途 |
|---|---|---|
| [`PRD.md`](.scratch/ai-devspace-mvp/PRD.md) | 文字 | "为什么做" |
| [`UI-POLISH-SPEC.md`](.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md) | 43KB 文字 + ASCII | 设计令牌、组件 API、状态机 |
| [`docs/design/pages/01..15-*.html`](docs/design/README.md) | 15 页成品 HTML + 自带 CSS variables | "长什么样" |
| [`AI-DevSpace-Design.md`](AI-DevSpace-Design.md) | ASCII + 早期探索稿 | 部分概念（如 NestJS、多 Provider、团队协作）已被 [CONTEXT.md](CONTEXT.md) v1.0 排除 |
| [`用户故事.md`](用户故事.md) | 用户原话 | 史料，原型溯源 |

约束与权衡：

1. 用户对 Step 1 的反馈 = **"我以为开发出来的就是 docs/design 下的原型真实落地的样子"**。原型文件即存在，但实施侧未将其作为单一对照标准落进 Step 2 范围。
2. [`docs/design/README.md`](docs/design/README.md) 第 55–61 行已隐式写出 Step 2 的工作模式："`apps/web/src/app/` 按本目录的 12 个页面一一落地;共享组件 (StatusBar / Sidebar / CommandPalette) 抽到 `apps/web/src/components/`;每页实现后回来对比 HTML 稿,微调即可"。
3. 15 页 HTML 都是自包含（每页自带 tokens 变量），可单独浏览器打开预览。这意味着每页是**可机器验证**的视觉回归基线。
4. `AI-DevSpace-Design.md` 与 `用户故事.md` 早期已制定；这两份是 **DEPRECATED/史料**，不应再作为实施侧对照。

## Decision

**三件套分层单一事实源**：

| 层 | 文档 | 唯一职责 |
|---|---|---|
| 需求层 | `PRD.md` | 为什么做 / 范围 / 边界 |
| 设计规范层 | `UI-POLISH-SPEC.md` | 设计 token、组件 API、状态机描述 |
| 视觉落地层 | `docs/design/pages/<NN>-<slug>.html` | 长什么样 —— Next.js App Router 12 路由 1:1 对应 |

**路由对照**：

- 12 个 HTML 路由 → 12 个 React route（`/` → `01-dashboard.html`；`/requirements/:id` → `03-requirement-workspace.html`）
- 3 个层叠 HTML（`13-command-palette / 14-shortcuts-cheatsheet / 15-new-requirement-modal`）→ 不占 React route，作为全局 overlay（`Cmd+K` / `Cmd+/` / `Cmd+N`）由根 layout 管控

**早期文档定位**：

- `AI-DevSpace-Design.md` → DEPRECATED；首位加 banner 指向 [CONTEXT.md](CONTEXT.md) 与本 ADR
- `用户故事.md` → 史料保留，作为产品最初的"用户原话"溯源

**实施 agent 守则**：开始任何 UI 实现前，先 grep `docs/design/pages/` 找到对应路由的 HTML 作为比对基线；交付前用浏览器视觉对照，并通过文字 spec （UI-POLISH-SPEC）核对组件 API / 状态机语义。

## Consequences

### 正面

- 决策漂移面由 5 份文档收窄到 3 份明确分工的文档。
- 每页 HTML 自带 CSS variables 即可成为"视觉验收单"，实施 agent 无须再问"我做得对不对"，打开 HTML 比对即可。
- 设计 token 漂移会在 HTML 与 UI-POLISH-SPEC 不一致时立即浮现（如本会话发现的 Brand 6 阶 vs 50-900 不一致 → 已通过 [ADR-0005](0005-brand-palette-six-step.md) 锁死）。
- 后续 Step 2+ 范围可明确表达为"实现 docs/design/pages/*.html 一一对应"。

### 负面 / 代价

- HTML 与 UI-POLISH-SPEC 需手动保持同步。当 UI-POLISH-SPEC 改了 token，HTML 必须同步改。
- 早期 `AI-DevSpace-Design.md` 的若干 ASCII mock 与 HTML 不完全一致 —— 需显式说明谁的优先级更高（明确：HTML）。

### 拒绝方案

- **让 [AI-DevSpace-Design.md](AI-DevSpace-Design.md) 作为视觉对照标准**：该文档已部分被 v1.0 锁定决策排除，引入它会污染视觉与产品哲学的一致性。
- **让 [`UI-POLISH-SPEC.md`](.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md) 单独作为对照标准**：该文档是文字 + ASCII，无视觉验收能力。
- **以 React Storybook 替代 HTML**：属于"未来 P1+ 的 Storybook-driven 设计"范畴；MVP 不上。

## Alternatives Considered

- 用 shadcn/ui 的默认主题 + Tailwind config 作为唯一真相：偏离 [AI-DevSpace-Design.md](AI-DevSpace-Design.md) 与 [`docs/design/pages/`](docs/design/README.md) 的 Linear 哲学。
- 用 React Storybook + Chromatic 做视觉回归：MVP 过重，工程量显著高于 HTML 比对。
