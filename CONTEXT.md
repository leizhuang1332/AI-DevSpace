# AI-DevSpace 项目术语表（Glossary）

> 本文档是项目的"活字典"。所有领域名词在此有且仅有一个含义。修改任何产品设计前，请先来对照术语。
>
> 创建：2026-07-08  
> 当前版本：v1.0（产品形态定稿）

---

## 核心对象

### Workspace（工作空间）

用户本机上的一个工作目录，物理根目录为 `~/.aidevspace/`，包含该用户所有的需求、仓库、知识、配置。是用户管理的最大边界。

- **单用户** 默认
- 可整体打包、迁移、备份
- 未来如需多用户协作，再做分层

### Requirement（需求）

开发的"工作单位"。对应一个完整的业务需求（如"订单退款功能优化"）。在文件系统中是 `~/.aidevspace/requirements/<req-id>/` 下的一个子目录。

- 拥有独立的 `meta.yaml`（状态、关联仓库、负责人）、分析、设计、计划、任务、产物、对话历史
- 一个 Requirement 可关联多个 Repository（微服务架构场景）
- **不是** Issue，也不是 Task，是它们的"父容器"

### Repository（仓库）

Git 仓库（一般是后端微服务），物理上存放在 `~/.aidevspace/repos/<repo-name>/`。

- **全局共享**：避免多需求重复 clone
- 通过 `git worktree` 在每个需求下创建独立工作副本：`requirements/<req-id>/repos/<repo-name>/`
- 多个需求可并发修改同一仓库的不同分支，互不冲突

### Task（任务）

AI 可执行的工作单元（如"设计退款表结构"、"开发 refund-service 接口"）。隶属于某个 Requirement，存放在 `requirements/<req-id>/plan/tasks.md`。

- Task 是 AI 的执行粒度
- 一个 Requirement 包含多个 Task

### Artifact（产物）

开发过程中 AI 产出的"可保存、可复用"的中间或最终结果。存放在 `requirements/<req-id>/artifacts/`。

- 包含但不限于：SQL 脚本、OpenAPI/接口定义、Apollo 配置、数据库设计文档、序列图、测试用例文件

### Knowledge（知识）

跨需求复用的领域知识、技术方案、Bug 经验、最佳实践。存放在 `~/.aidevspace/knowledge/`。

- 全局共享，所有需求可见
- 由 AI 自动从历史需求、代码、Review 记录中沉淀，也支持人工整理

### Local Agent（本地 Agent 守护进程）

运行在用户本机的后台服务（端口 7777），负责：

- 与 Web 工作台通信
- 操作本地 git（clone、worktree、commit、diff）
- 调用 Claude Code SDK（subprocess 池）
- 读取/写入本地文件
- 加载与执行 Skill

### Web Workbench（Web 工作台）

浏览器端单页应用（端口 3333，Next.js 14）。负责：

- 展示需求列表、详情、对话
- 与 Agent 通过 **HTTP REST + SSE** 通信（Client → Agent 走 REST POST；Agent → Client 走 SSE 长连推送，使用 `@fastify/sse`；见 [ADR-0001](docs/adr/0001-hybrid-web-agent-architecture.md) + 决策 31）
- **不**直连文件系统、**不**跑 git、**不**调 LLM

### Skill（技能）

定义"AI 在某阶段如何工作"的可加载单元。存放在 `~/.aidevspace/skills/`。

- 每个 Skill 是一个目录，含 `SKILL.md`（元信息 + 提示词模板）、上下文装配规则、期望产出物清单
- **流程不写死，由 Skill 驱动**——切换工作流 = 换 Skill 包
- 内置 6 个：analyze-stage / design-stage / plan-stage / code-stage / test-stage / submit-stage

---

## 流程术语

### Vibecoding 流程

用户故事中描述的 7 步开发流程：拿 PRD → AI 分析 → 澄清问题 → 生成设计 → 生成计划 → AI 开发和测试 → 提交代码。

- **AI 是执行者**，不是聊天工具
- 上下文始终绑定在 Requirement 上
- 每一步通过运行对应 Skill 触发

### Stage（阶段）

需求的生命周期阶段。当前由 Skill 包隐式定义（MVP 不写死状态机）。

- 至少包含：分析 → 澄清 → 设计 → 计划 → 实施（开发+测试）→ 提交 → 完成
- 阶段转换通过"运行下一阶段 Skill + 用户确认"完成
- 流程灵活性：未来可重排阶段、新增阶段

### AI 上下文装配（Context Assembly）

每次 AI 任务运行时，Agent 根据当前 Skill 的 `context:` 字段，从文件系统**按需加载**对应文件，注入 SDK 调用。

- 不累积上下文，**分层注入**
- 阶段切换时自动跑"上下文压缩"（生成 `99-summary.md`）

---

## 决策记录（已锁定 v1.0）

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 1 | 产品形态 = D. 混合（Web 工作台 + 本地 Agent 守护进程） | [ADR-0001](docs/adr/0001-hybrid-web-agent-architecture.md) |
| 2 | 数据存储 = 纯文件系统（markdown/yaml/json），必要时回退 sqlite3 | [ADR-0002](docs/adr/0002-filesystem-as-database.md) |
| 3 | 工作空间根目录 = `~/.aidevspace/` | — |
| 4 | 仓库管理 = 全局共享 + git worktree 隔离 | [ADR-0003](docs/adr/0003-git-worktree-isolation.md) |
| 5 | 部署模式 = 本机单用户（Web + Agent 分离） | [ADR-0001](docs/adr/0001-hybrid-web-agent-architecture.md) |
| 6 | Web 端口 = 3333 | — |
| 7 | Agent 端口 = 7777 | — |
| 8 | MVP 不做团队协作（P1+ 再考虑） | — |
| 9 | AI 推理 = 通过 Claude Code SDK / Codex SDK / Opencode SDK 调用，本平台不自建 LLM 集成 | [ADR-0004](docs/adr/0004-claude-code-sdk-as-ai-engine.md) |
| 10 | MVP 仅支持 Claude Code SDK | [ADR-0004](docs/adr/0004-claude-code-sdk-as-ai-engine.md) |
| 11 | AI 架构 = 单一通用 Agent + 阶段 Skill 模板；不引入多 Agent 编排 | — |
| 12 | 多会话 = 每需求独立 chat 窗口（一个 SDK 子进程） | — |
| 13 | 上下文 = 分层注入 + 阶段间自动压缩（可手动触发） | — |
| 14 | 任务粒度 = 一个会话够用（不"任务内再拆子会话"） | — |
| 15 | 流程 = 由 Skill 驱动（不写死状态机） | — |
| 16 | UI 打磨范围 v1.0 = 交互流畅度（③）+ 状态可视化（④） | — |
| 17 | UI 参考对象 = Linear（极简、克制、开发者向、Cmd+K 哲学） | — |
| 18 | 主题策略 = 跟随系统 + 手动覆盖（三档 System / Dark / Light），`config.yaml` 的 `theme` 字段 | — |
| 19 | 用户偏好：亮色为心智模型（暗色为次选） | — |
| 20 | 主色（Brand）= Linear 紫 #5e6ad2，**6 阶**：brand / brand-50 / brand-100 / brand-500 / brand-600 / brand-700（取代原"10 阶 50-900"字面） | [ADR-0005](docs/adr/0005-brand-palette-six-step.md) |
| 21 | 语义色：Success #16a34a / Warning #f59e0b / Error #ef4444 / Info #64748b | — |
| 22 | 需求状态色 = 分组共享色（4 色 + 灰）；CLARIFYING 特殊（紫+警告红点）；MVP 不带数字徽章 | — |
| 23 | AI 存在方式 = 形态 C（混合）：默认隐身 + Cmd+K 唤起 + 主动推送 + Inline 标记；**取消右栏常驻** | — |
| 24 | AI 出现三规矩：默认隐身 / 主动但克制 / 响应但精准 | — |
| 25 | AI 主动推送触发：完成 Skill / 需用户回答 / 错误或决策 | — |
| 26 | Cmd+K 命令面板：三段式（命令 + AI 提问 ⌘I 切换 + 历史）；`/` 搜索 / `>` 命令前缀；默认绑当前需求，`⌘⇧K` 切全局 | — |
| 27 | AI 回答形式：可执行结果卡片（落盘产物 + 摘要 + 动作按钮），不是聊天回复 | — |
| 28 | 信息密度 = Linear 紧凑型；字号 9 档（11-32）；间距 4 倍数（4-48）；Inter + JetBrains Mono | — |
| 29 | 快捷键 = Linear 风格（90% 走 Cmd+K）；发现性 3 层（UI 标注 / 命令面板搜 / `Cmd+/` 速查）；资源树用 `↑↓` | — |
| 30 | 三态：空态极简（icon+标题+CTA） / 加载混合（骨架屏+进度条+spinner） / 错误分层（内嵌+Toast+弹窗+状态条 L3）；骨架屏 shimmer 1.5s | — |
| 31 | 实时通信协议 = **SSE**（Server-Sent Events），不用 WebSocket；客户端→服务端走 REST POST；Agent 用 `@fastify/sse` | — |
| 32 | AI 输出打字机效果：流式 SSE 推送 chunk（10-100 字符），前端按字符打字（默认 20ms/字，可设 10/20/30/关），点击气泡跳过 | — |
| 33 | 需求列表 = 宽松风格（行高 48px / 字号 14px / 副标题 12px）；其他列表保持紧凑 32px；副标题格式 `N repo · N 天前更新` | — |
| 34 | Agent 鉴权 = 动态 Token（`~/.aidevspace/.agent-token` 0600/ACL）+ Origin 校验（仅 `localhost:3333`）；请求头 `X-AIDevSpace-Token` | — |
| 35 | AI 切换粒度 = 全局一个 Provider；`config.yaml` 加 `ai.provider` 字段；Agent 目录约定 `apps/agent/src/providers/`（**有 src**） | — |
| 36 | UI 实施对照标准（三件套单一事实源）：`PRD.md` 述"为什么" / `UI-POLISH-SPEC.md` 定"怎么做" / [`docs/design/pages/*.html`](docs/design/README.md) 定"长什么样"；12 路由 1:1 对应 React route，3 层叠（`Cmd+K` / `Cmd+/` / `Cmd+N`）作 overlay 不占 route；早期 [`AI-DevSpace-Design.md`](AI-DevSpace-Design.md) 已 DEPRECATED | [ADR-0006](docs/adr/0006-html-prototype-as-source-of-truth.md) |
| 37 | 前端目录结构 = Next.js 14 App Router 三层嵌套：(1) 根 `app/layout.tsx` 仅 ThemeProvider；(2) `(workspace)/layout.tsx` 包 StatusBar + Sidebar + `Cmd+K`/`Cmd+N`/`Cmd+/` 键盘监听 + 三个 overlay portal；(3) `(workspace)/requirements/[id]/layout.tsx` 仅在需求详情组 (03–07) 包资源树 + Inline 提示栏；dev group 维持现有 prod notFound | [ADR-0007](docs/adr/0007-workspace-route-group-shell.md) |

---

## 不在范围内（明确剔除 v1.0）

- 真实多用户/团队协作
- 云端 SaaS
- Web 端代码编辑
- 移动端
- 自建 LLM 推理
- 真实插件市场与远程安装
- 拖拽式流程编排
- 多 LLM Provider 切换（除 Claude Code SDK 外的 SDK）
