# AI-DevSpace 项目术语表（Glossary）

> 本文档是项目的"活字典"。所有领域名词在此有且仅有一个含义。修改任何产品设计前，请先来对照术语。
>
> 创建：2026-07-08  
> 当前版本：v1.0（产品形态定稿）

---

## AI 协作哲学

> **「不打扰，但陪伴；克制，在场」**

AI 在本平台不是工具栏、不是聊天窗口、不是工作流编排者——它是一个**始终在观察、关键时刻搭把手**的搭档。

### 核心信条

- **陪伴先于推动**：AI 始终"在场"（状态可见、行为可追），但**绝不**替用户决定"下一步该做什么"
- **不打扰**：默认静默；只在用户真需要时（AI 真在等 / 产物真完成 / 风险真出现）才浮现
- **人机合作感**：用户主导，AI 兜底；用户动脑，AI 跑腿
- **可审计**：每一次 AI 在场（候命、提问、推送、写入）都有据可查、可关、可回退

### 与传统设计哲学的区别

| 旧哲学 | 新哲学 |
|---|---|
| AI 是执行者 | AI 是搭档 |
| 默认隐身 | 默认在场但克制 |
| 主动推送"下一步建议" | 主动推送"我在等你回答" |
| 状态机驱动 | 用户意图驱动 |
| 6 阶段 Skill 流水线 | 上下文触发的能力集合 |
| 流程编排 | 上下文赋能 |

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

AI 提示词的可加载封装单元（Anthropic progressive disclosure 思想落地）。存放在 `~/.aidevspace/skills/`。

- **本质是文字**——一个 Skill = 一段可拼接到 system prompt 的指引片段（frontmatter 元信息 + 正文行为规范）
- **不是执行单元**——没有"启动 / 运行 / 停止"状态，没有"Skill A 执行中"这种概念
- 形态 = 目录 + `SKILL.md`（含 `triggers:` `arming:` `hint:` `artifacts:` 等 frontmatter + 正文）
- 内置示例：requirement-clarify / requirement-brainstorm / requirement-critique / schema-design / api-design / ddl-index-suggest / code-review / test-gen / commit-message-draft ...
- 用户可自由新增 Skill（`skills/user/`），可改写 / 禁用任意内置 Skill

**装填深度（Arming Level）**——决定 Skill 在 LLM system prompt 里的"重量"：

| 档位 | 注入内容 | 类比 |
|---|---|---|
| **Always-on** | 完整 SKILL.md 正文进 system prompt | 身体一部分，永久在场 |
| **On-arming**（默认） | 仅 name + 1 句描述进 system prompt | 装在枪套里，看得见摸不到 |
| **Dormant** | 0 注入；只在 Cmd+K 出现 | 锁柜子里，要去拿 |

**触发（Trigger）**——决定 Skill 是否进入"候命"（On-arming 或更高）：

- 声明式规则，写在 SKILL.md 的 `triggers:` 字段：文件 glob、视图聚焦态、工程物料类型、项目状态谓词
- **零 LLM 推理**——前端纯函数评估，不调用 LLM
- 用户始终可通过 Cmd+K 显式唤起任意 Skill（不依赖触发匹配）

**显式加载**——用户输入 `/skill-name` 或 UI 点击 → 临时把该 Skill 完整正文抬到 system prompt 顶层

- LLM 不得仅因"用户消息像某个 Skill 的领域"就自主加载该 Skill 全文
- LLM 可见 armed Skill 的元数据；回应用户时可**建议**"这事 X Skill 适合，要加载吗？"，**不自动**执行

---

## 流程术语

### Vibecoding 场景（用户故事的原始描述）

Vibecoding 是一种典型开发场景：拿 PRD → 澄清 → 设计 → 计划 → 编码 → 测试 → 提交。

- 这**不是**产品内置的状态机——只是用户在使用中可能经历的一种活动序列
- 7 步中每一步都对应**若干 Skill**（非 1:1）：例如"澄清"对应 requirement-clarify / requirement-brainstorm / requirement-critique；"编码"对应 code-scaffold / code-review / test-gen
- 用户**可任意跳、漏、重排**这些步骤；可只做其中一步
- AI **不主动推动**这条线——它只让相关 Skill 处于候命，由用户自己点
- 上下文绑定在 Requirement 上（仍 true）

### Focus（当前关注点，替代旧"Stage"概念）

需求详情页"软标签"——用户在做的事，仅供 AI 参考。**不驱动 UI 流转、不构成状态机。**

- 形式：`meta.yaml.current_focus: "reading-prd"` / `"reviewing-schema"` / `"writing-code"` ...
- 来源：用户最近操作、用户主动设置
- 用法：AI 在装配上下文时可参考这个 hint，但**不**据此决定该跑哪个 Skill
- 不存在合法的"阶段转换"——用户从"看 PRD"切到"写代码"中间没有强制的"分析→设计"流程
- 旧 `status` 字段若保留，须明确为"软标签"，不与 UI 流程绑定

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
| 11 | AI 架构 = 单一通用 Agent + Skill 提示词封装；不引入多 Agent 编排 | — |
| 12 | 多会话 = 每需求独立 chat 窗口（一个 SDK 子进程） | — |
| 13 | 上下文 = 分层注入 + 阶段间自动压缩（可手动触发） | — |
| 14 | 任务粒度 = 一个会话够用（不"任务内再拆子会话"） | — |
| 15 | 流程 = **不写状态机**——AI 不推动流程；Skill 是"上下文触发的能力"，不构成阶段 | — |
| 16 | UI 打磨范围 v1.0 = 交互流畅度（③）+ 状态可视化（④） | — |
| 17 | UI 参考对象 = Linear（极简、克制、开发者向、Cmd+K 哲学） | — |
| 18 | 主题策略 = 跟随系统 + 手动覆盖（三档 System / Dark / Light），`config.yaml` 的 `theme` 字段 | — |
| 19 | 用户偏好：亮色为心智模型（暗色为次选） | — |
| 20 | 主色（Brand）= Linear 紫 #5e6ad2，**6 阶**：brand / brand-50 / brand-100 / brand-500 / brand-600 / brand-700（取代原"10 阶 50-900"字面） | [ADR-0005](docs/adr/0005-brand-palette-six-step.md) |
| 21 | 语义色：Success #16a34a / Warning #f59e0b / Error #ef4444 / Info #64748b | — |
| 22 | 需求状态色 = 分组共享色（4 色 + 灰）；CLARIFYING 特殊（紫+警告红点）；MVP 不带数字徽章 | — |
| 23 | AI 存在方式 = 形态 C（混合）：默认克制在场 + Cmd+K 唤起 + 极窄主动推送 + Inline 标记；**取消右栏常驻** | — |
| 24 | AI 出现哲学 = "**不打扰，但陪伴；克制，在场**"——始终可见、关键时刻搭把手，不替用户决定下一步 | — |
| 25 | AI 主动推送触发**只保留一类**：AI 提问等用户回答。完成 Skill / 错误 / 决策 / 下一步建议 → 全部不推 | — |
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
| 38 | **Skill 是提示词封装**（Anthropic progressive disclosure 模式落地），不是执行单元；没有"Skill 执行中"这种状态 | — |
| 39 | **Skill 触发信号 = 声明式规则**（SKILL.md frontmatter 的 `triggers:`），前端纯函数评估，**零 LLM 推理** | — |
| 40 | **Skill 装填深度三档**：Always-on（完整 SKILL.md 进 system prompt）/ On-arming（仅 name + 1 句描述进 system prompt，默认）/ Dormant（0 注入） | — |
| 41 | Always-on 数量**可配置上限**（默认 3，新增时二次确认），装填深度由用户在 Skill 管理页配置 | — |
| 42 | LLM 不得仅因"用户消息像某个 Skill 的领域"**自主加载该 Skill 全文**；只能基于元数据回应 + 显式建议由用户加载 | — |
| 43 | **陪伴哲学硬约束** = (a) AI 状态始终可见（idle / 观察中 / 思考中 / 等回答），但不抢焦；(b) AI 背景工作（读文件、检索知识、检查 git）以**活动流**形式记录可查，但不弹；(c) AI 完成产物以**文件标记**形式落位，不推 | — |
| 44 | **5 类必沉默** = ①用户在读（无输入 + 无滚动）②全屏沉浸模式 ③Web 标签不在前台 ④麦克风/摄像头激活 ⑤同 (skill, context) 被主动 dismiss ≥ 3 次。任一触发 → 连 Inline 提示栏都不出。**5 条 AI 主动关心红线** = ①凝视式"我看你停在 X 段"②"你刚删了 Y 是不是误删"③"你工作 X 小时了休息下"④"根据你的习惯下一步该 X"⑤跨项目推送 | — |
| 45 | **AI 静默 4 档** = 跟随（默认全开）/ 轻默（关 Inline 提示栏+5min Toast，StatusBar 仍显示状态）/ 沉默（StatusBar 简化成单徽章，活动流仍记录）/ 关闭（SDK 不调、活动流不记、平台退化文件浏览器）。切换 UX = StatusBar 单击循环 + `Cmd+Shift+A` 选档 + `[Shh Xh]` 定时 + Settings 精细规则 | — |
| 46 | **AI 翻车防线 5 层** = ①预（5 类高危操作默认阻止：删业务文件 / force-push / 推 main / 含敏感信息 / 跳 verify hook）②测（自动 linter + type-check + test + schema validate + openapi validate）③亮（4 级曝光：Inline 变体 / 强制 Toast / 模态 / 暂停所有 AI）④回（自动 snapshot + 1-click 回滚）⑤学（👎 反馈 → Skill `bad_feedback:` 字段） | [ADR-0009](docs/adr/0009-ai-failure-defense.md) |
| 47 | **自动 snapshot 机制** = 每次 AI 写入前自动快照到 `.aidevspace/snapshots/<req-id>/<ts>/`；保留 **30 天**后自动清理（可配）；UI 入口 = StatusBar 旁 `[↶ 回滚上次]` `[↶↶ 回滚本次会话全部]` `[查看 snapshot 列表]` | [ADR-0009](docs/adr/0009-ai-failure-defense.md) |
| 48 | **👎 反馈通道** = 任何 AI 输出旁有 👎 按钮 → 选 6 类原因（写错位置 / 内容错误 / 多此一举 / 没理解意图 / 违反规范 / 其他）→ 写入该 Skill `SKILL.md` 的 `bad_feedback:` 字段 → 下次跑同 Skill 时 AI 主动看此记录调整输出。`👍 还行` 也记录作正向强化 | [ADR-0009](docs/adr/0009-ai-failure-defense.md) |
| 49 | **StatusBar AI 区 4 指示器** = 状态（idle/观察中/思考中/等回答/出错，色码：灰/蓝脉动/黄/绿闪/红）/ 待回答 N / 候命 N / 最近写入 N；可点开看详情。**Inline 提示栏 UI 边界** = 12px 灰字 1 行 + 1px 顶部分隔线 + hover 浮 3 行能力卡（不用按钮/弹窗）；位置由 Skill `hint.anchor` 声明；同 (skill, context) 仅首次显示；进入显 → 30s 不动隐 → 见过不重 → 滚动过立即隐；关闭粒度 = 全局 + 单 Skill 双层 | — |

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
