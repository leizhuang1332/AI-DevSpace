# AI DevSpace — 初版页面设计索引

> 本目录是 PRD v1.0 + UI-POLISH-SPEC v1.0 定稿后的**初版 HTML 设计稿**。
> 每个页面一个独立 HTML 文件，可直接在浏览器打开预览。
>
> 范围：MVP 前端落地用。所有页面遵循 UI-POLISH-SPEC §1 的设计令牌（Linear 紫 #5e6ad2 / Inter + JetBrains Mono / Linear 紧凑型）。

---

## 页面清单（12 + 3 个层叠）

| # | 文件 | 路由 | 一句话 |
|---|---|---|---|
| 01 | [pages/01-dashboard.html](pages/01-dashboard.html) | `/` | 概览：进行中需求 + 活跃会话 + 待办 |
| 02 | [pages/02-requirements.html](pages/02-requirements.html) | `/requirements` | 需求列表（Linear 风格表） |
| 03 | [pages/03-requirement-workspace.html](pages/03-requirement-workspace.html) | `/requirements/:id` | 需求详情·工作区（三栏布局） |
| 04 | [pages/04-requirement-repos.html](pages/04-requirement-repos.html) | `/requirements/:id/repos` | 需求详情·关联仓库 |
| 05 | [pages/05-requirement-artifacts.html](pages/05-requirement-artifacts.html) | `/requirements/:id/artifacts` | 需求详情·产物 |
| 06 | [pages/06-requirement-history.html](pages/06-requirement-history.html) | `/requirements/:id/history` | 需求详情·对话与变更 |
| 07 | [pages/07-requirement-settings.html](pages/07-requirement-settings.html) | `/requirements/:id/settings` | 需求详情·设置 |
| 08 | [pages/08-repos.html](pages/08-repos.html) | `/repos` | 全局仓库池 |
| 09 | [pages/09-repo-detail.html](pages/09-repo-detail.html) | `/repos/:name` | 仓库详情（含 worktree 列表） |
| 10 | [pages/10-knowledge.html](pages/10-knowledge.html) | `/knowledge` | 知识库（domain / patterns / bugs） |
| 11 | [pages/11-skills.html](pages/11-skills.html) | `/skills` | Skill 管理（内置 + 用户） |
| 12 | [pages/12-settings.html](pages/12-settings.html) | `/settings` | 全局设置（主题 / 打字机 / 静默） |
| — | [pages/13-command-palette.html](pages/13-command-palette.html) | 层叠（`Cmd+K`） | 命令面板·三段式（命令/AI/历史） |
| — | [pages/14-shortcuts-cheatsheet.html](pages/14-shortcuts-cheatsheet.html) | 层叠（`Cmd+/`） | 快捷键速查面板 |
| — | [pages/15-new-requirement-modal.html](pages/15-new-requirement-modal.html) | 层叠（`Cmd+N`） | 新建需求弹窗 |

---

## 设计原则（贯穿所有页面）

1. **AI 隐身**（范式 A）：右栏**无 AI 助手**，AI 仅在命令面板、Toast、Inline 浮窗中出现
2. **顶部 StatusBar 常驻**（每个页面都带）：当前 Tab + AI 实时状态
3. **左侧一级导航**：`🏠 概览 / 📌 需求 / 📦 仓库 / 📚 知识 / 🤖 Skill / ⚙️ 设置`
4. **Linear 紧凑型**：行高 32px / 字号 13px 默认 / 卡片 8px 圆角 / 按钮 6px 圆角
5. **暗色为次选**：亮色为心智模型，但所有页面都出暗色变体预览
6. **三态齐全**：每页都标注"空态/加载/错误"的形式

---

## 与 UI-POLISH-SPEC 的关系

| UI-POLISH-SPEC 章节 | 在本目录的体现 |
|---|---|
| §1 设计令牌 | 所有页面共享同一套 CSS variables |
| §2 状态色 | StatusBadge 组件贯穿页面 03/05/06 |
| §3 AI 状态 6 态 | AIStatusDot 组件贯穿 StatusBar |
| §4 页面布局 | 12 个页面布局图 |
| §5 组件 API | 每个页面内联标注组件使用 |
| §10 三态 | 每页标注了空/加载/错误的形式 |
| §11 文件组织 | 12 个页面 = 未来 `apps/web/src/app/` 路由 |

---

## 下一步

1. 进入实现阶段：`apps/web/src/app/` 按本目录的 12 个页面一一落地
2. 共享组件（StatusBar / Sidebar / CommandPalette）抽到 `apps/web/src/components/`
3. 每页实现后回来对比 HTML 稿，微调即可