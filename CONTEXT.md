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

### RepoPool（仓库池）

Workspace 级的全局仓库集合——源自 `~/.aidevspace/repos/` 物理目录的**子目录列表**，由 Agent `GET /api/repos` 实时 readdir 暴露给前端。

- **目录即真相**：与决策 4 一致，**不**采用配置清单 / `config.yaml` 字段
- **每次 GET 实时扫**：无缓存；元数据（默认分支 / 语言 / SSH URL）暂不提供，留给后续 `.aidevspace/repo.yaml` 提案
- **id = `repo-<dirname>` slug**：与既有 `GLOBAL_REPO_POOL` 命名兼容，避免改 chip id
- **不校验 `.git/`**：误 `mkdir` 是用户自己的责任
- **目录不存在 = 合法空态**：返 `{repos: []}` 200，前端走"暂无可选仓库"分支
- 归属 ADR：[ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D1–D6

_Avoid_: 仓库列表 / 全局仓库集合（模糊概念，不指代具体落点）

### Task（任务）

AI 可执行的工作单元（如"设计退款表结构"、"开发 refund-service 接口"）。隶属于某个 Requirement，存放在 `requirements/<req-id>/plan/tasks.md`。

- Task 是 AI 的执行粒度
- 一个 Requirement 包含多个 Task

### Artifact（产物）

开发过程中 AI 产出的"可保存、可复用"的中间或最终结果。存放在 `requirements/<req-id>/artifacts/`。

- 包含但不限于：SQL 脚本、OpenAPI/接口定义、Apollo 配置、数据库设计文档、序列图、测试用例文件

### Asset（附件素材）

用户上传附件中的非代码资源（主要为 .docx 解出的图片或其他原始输入）。存放在 `requirements/<req-id>/assets/`。

- 与 artifact 区分：asset 是用户的**原始输入**，artifact 是 AI 的**中间或最终输出**
- markdown 中通过相对路径引用（例：`![](assets/prd-1.png)`），典型来源：[mammoth](https://github.com/mwilliamson/mammoth.js) 解 .docx 的内嵌图
- 资源树扫描忽略 `_` 前缀目录（沿用 `_archived/` 约定），但 `assets/` 不带下划线，因此纳入资源树
- 归属 ADR：[ADR-0015](docs/adr/0015-prd-file-upload-and-editing.md) D5

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

### 工位（Zone,需求工作台内的"工作环境"）

需求工作台（原"需求详情页"）内的**独立工作环境**——类比汽车维修车间，维修区 / 洗车区 / 检测区各自是工位，自带固定装备，无方向，可任意跳转。

- **6 工位 + 1 Overview 概览页 = 7 产品形态**
- 工位 = 独立路由 = 独立工作台（URL：`/requirements/[id]/[zone]/`）
- 工位**无方向**（不是流程节点，可任意跳转，包括反向 WRAP-UP → DRAFTING）
- 工位**不推动流程**（用户意图驱动，继承决策 15 不写状态机）
- **环境决定装备**：工位注册表 `default_arming` 字段决定该工位默认装填哪些 Skill
- 工位集合 = 声明式注册表（`~/.aidevspace/zones/*.yaml`，v1.0 不开放 user 自定义）

v1.0 工位清单：

| 工位 | 用户动作 | 资源树 | Inline 栏 |
|---|---|---|---|
| **DRAFTING** | 写需求 PRD | ✅ PRD 章节 + AC + 仓库 | ✅ 保留 |
| **ANALYZING** | PRD 准入校验 + 拆解聚合模块 | ❌ 主区全宽 | ❌ 无 |
| **CLARIFYING** | 澄清聚合模块落地细节 | ❌ 主区全宽 | ❌ 无 |
| **DESIGNING** | 评审候选方案 | ❌ 默认无 | ❌ 无 |
| **EXECUTING** | 监督 AI 实施 | ✅ 任务 DAG + Diff + 产物 | ✅ 保留 |
| **WRAP-UP** | 归档复盘 | ✅ 产物 + PR + 决策 | ❌ 无 |

详见 [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) · [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) · [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md)

### ANALYZING 工位(展开)

ANALYZING 工位的核心职责是 **PRD 准入校验 + 拆解聚合模块**——把 DRAFTING 产出的粗粒度 PRD(业务语言)转化为可指导开发的技术概要(技术语言)+ 聚合模块清单。

**与 CLARIFYING 的语义边界:**
- ANALYZING = 准入校验(业务/性能/架构/合规) + 拆解为聚合模块(粗粒度)
- CLARIFYING = 每个聚合模块的落地细节澄清(细粒度;定不下来就无法开发 / 开发会有 bug)

**4 核心职能:**
1. **解析参数配置面板**——启动前选 Skill / 选知识 / 选仓库分支 / 设优先级
2. **解析过程观察**——AI 思考流 + 实时打字机 + 上下文插话
3. **解析产物交互编辑**——识别子问题/风险/方案可编辑(增删改合并)
4. **多会话并行观察**——顶部 Tab 切换(详见 ADR-0013 D7)

**多会话:** 同个需求可开多个 ANALYZING 会话(不同 Skill 或不同角度,如架构/数据/接口),顶部 Tab 切换,每次只显示一个会话主区。

**产物(技术概要 + 聚合模块清单):**

```
requirements/<req-id>/analysis/
  ├─ technical-brief.md      ← 业务背景 + 架构叙述 + 技术栈说明(叙述性)
  └─ modules.yaml            ← 聚合模块清单(结构化,可被 CLARIFYING 直接消费)
```

**主区布局(5 块,顶到底):**
1. 准入仪表板(5 维度卡 + 总体结论) —— 详见 ADR-0013 D4
2. 会话 Tab 导航
3. 主区两列:思考流(左) + 识别产物(右,可编辑)
4. 启动前解析参数配置面板(折叠为 ⚙️ 入口)
5. 插话输入条(用户随时补充上下文 / 反向提问)

**待裁决项(代替原"AI 主动提问"机制):** AI 识别出需确认的事项 → 写入"待裁决面板"(`requirements/<req-id>/analysis/adjudication.md`),**不主动推送**;用户主动来 ANALYZING 处理;StatusBar "待裁决 N" 常驻提醒;其他工位可点 StatusBar 数字跳转过来。

**与 CLARIFYING 交接:** 直接共享 `analysis/modules.yaml`(双向引用,无快照 / 无冻结点)。用户回到 ANALYZING 修改后,CLARIFYING 下次进入自动 reload 最新版本。

**准入维度可配置:** 每个 Skill 在 frontmatter 声明它需要检查的准入维度集合,不同 Skill 可能有不同维度集(如"退款分析" vs "会员分析");详见 ADR-0013 D10。

### Overview 概览页（需求工作台仪表板）

需求工作台 `/requirements/[id]/` 的**第 7 产品形态**，但**不是工位**——是仪表板（用户"看"而非"做"）。

- 5 项内容（推荐集）：元数据 + 完成进度 + 工位地图 + 里程碑时间线 + AI 活动概览
- **无 ZoneBar** / **无资源树** / **无 Inline 栏**
- 进入工位时 ZoneBar 7 Tab 才出现
- 底部 AI 思考条显示**需求级** AI 状态（总写入 / 快照数 / PR 数），不是工位级
- 默认行为：从 `/requirements/[id]/` 重定向到 cookie `last_zone` 或默认 `drafting`

详见 [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) · [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md)

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
| 9 | AI 推理 = 通过 Claude Code SDK / Codex SDK / Opencode SDK 调用，本平台不自建 LLM 集成 | [ADR-0004](docs/adr/0004-claude-code-sdk-as-ai-engine.md) + [ADR-0010](docs/adr/0010-claude-code-sdk-integration.md) |
| 10 | MVP 仅支持 Claude Code SDK（通过 [cc-switch](https://github.com/farion1231/cc-switch) 路由到任意后端 provider：DeepSeek / GLM / MiniMax / Kimi ...） | [ADR-0004](docs/adr/0004-claude-code-sdk-as-ai-engine.md) + [ADR-0010](docs/adr/0010-claude-code-sdk-integration.md) Q9 |
| 11 | AI 架构 = 单一通用 Agent + Skill 提示词封装；不引入多 Agent 编排 | — |
| 12 | 多会话 = 每需求可有 **N 个独立 session**（用户主动开，N ≥ 0）；每 session 是独立对话流 + 自己的 SDK sessionId + 自己的 (provider, role) 选择 | [ADR-0010](docs/adr/0010-claude-code-sdk-integration.md) Q3 / Q7 / Q9 |
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
| 25 | AI 主动推送触发**全部取消**(2026-07-12 v1.0.2 改写,详见 [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D3+D6)。原"AI 提问等用户回答"降级为"待裁决项沉淀",AI 输出物以文件标记形式落位,以 StatusBar "待裁决 N" + 工位仪表板常驻提醒,其他工位可点 StatusBar 跳转。彻底贯彻决策 24 哲学。 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) |
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

## v1.0.1 增量决策（11 轮 grilling 沉淀 · 2026-07-12）

> 本节是 v1.0 已锁定后的迭代记录，不修改上面 v1.0 决策 1-49，仅追加增量。所有增量由 [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) + [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) 承载完整内容。

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 50 | **需求详情页 → 需求工作台** = 7 产品形态（1 Overview 概览页 + 6 工位） | [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) |
| 51 | **工位 = 独立路由 = 独立工作台** = `/requirements/[id]/[zone]/`；工位无方向、可任意跳转、用户主导、环境决定装备 | [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) |
| 52 | **资源树按工位** = DRAFTING / EXECUTING / WRAP-UP 有；ANALYZING / CLARIFYING / DESIGNING 无（继承决策 15 不写状态机） | [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) |
| 53 | **Inline 栏下放到工位** = 仅 DRAFTING / EXECUTING 保留（继承决策 23 取消右栏常驻） | [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) |
| 54 | **AI 思考条全局化** = 位置 shell 层 1（始终在），内容由当前工位注入；新增工位注册表 `thinking_bar` 字段（required / minimal / hidden） | [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) |
| 55 | **ZoneBar 7 Tab + Cmd+K 双通道** = Overview + 6 工位，排序 Overview → DRAFTING → ANALYZING → CLARIFYING → DESIGNING → EXECUTING → WRAP-UP；Overview 时无，工位时有；Cmd+K 命令面板新增工位搜索 | [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) |
| 56 | **工位集合声明式注册表** = 全局 `~/.aidevspace/zones/*.yaml`，13 字段（5 身份 + 5 环境 + 1 装备 + 1 AI 思考条 + 2 触发器 + 1 备注）；v1.0 不开放 user 自定义 | [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) |
| 57 | **`/requirements/[id]/` 默认行为** = 重定向到 cookie `last_zone`（用户上次停留工位）或默认 `drafting`；**永不基于 `meta.yaml.status` 推断**（决策 15 反对状态机） | [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) |

---

## v1.0.2 增量决策（10 轮 grilling 沉淀 · 2026-07-12）

> 本节是 v1.0.1 锁定后的迭代记录，不修改上面 v1.0 / v1.0.1 决策（除决策 25 改写已标记）。所有增量由 [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) 承载完整内容。

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 58 | **ANALYZING 工位新定位** = PRD 准入校验 + 拆解聚合模块；取代原"旁观 AI 解析" | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D1 |
| 59 | **ANALYZING 4 核心职能** = 解析参数配置 + 解析过程观察（含插话） + 解析产物交互编辑 + 多会话并行 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D2 |
| 60 | **AI 提问全部留在 ANALYZING**（不切 CLARIFYING）；覆盖原决策 25 中"AI 提问触发切 CLARIFYING"的部分 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D3 |
| 61 | **严重度五级** = 4 准入维度（资损/性能/架构/业务） + 1 上下文确认；任一 🔴 资损 → 总体 ❌ 失败 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D4 |
| 62 | **新术语 4 个** = 聚合模块（Aggregate Module）/ PRD 准入校验（PRD Admissibility Check）/ 技术概要（Technical Brief）/ 待裁决项（Pending Adjudication Item） | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D5 |
| 63 | **AI 准入提问 = 待裁决项沉淀**（非主动推送）；改写原决策 25 语义；写入 `analysis/adjudication.md`，用户主动来裁决 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D6 |
| 64 | **多会话形态** = 顶部 Tab 切换（类似浏览器 Tab）；准入仪表板全局共享不分子会话；HTML 原型 [11h-A](docs/design/pages/11h-A-zone-multisession-tabs.html) | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D7 |
| 65 | **技术概要产物** = 双文件：`technical-brief.md`（叙述） + `modules.yaml`（聚合模块清单）；一次性落盘 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D8 |
| 66 | **ANALYZING → CLARIFYING 交接** = 直接共享 `modules.yaml`（双向引用）；无快照 / 无冻结 / 无交接仪式 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D9 |
| 67 | **准入维度可配置** = 各 Skill 在 frontmatter `admission_dimensions:` 声明；不同 Skill 可能有不同维度集（全局默认 5 维度可被 Skill `add` / `skip` 覆盖） | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D10 |
| 68 | **裁决后流程** = 增量更新（默认，触发见 69）+ 一键重扫按钮（用户主动触发全量重走流程） | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D11 |
| 69 | **增量更新触发** = 批量提交（用户裁决多项 → 点 `[应用本次裁决]` 按钮 → AI 一次性应用） | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D12 |
| 70 | **回答载体** = 预设选项（AI 推测的 2-4 个常见答案）+ 自定义文本输入框；用户点选或填字 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D13 |
| 71 | **重扫后产物处理** = 直接覆盖 `modules.yaml` + `technical-brief.md`；不依赖 git，由决策 47 自动 snapshot 机制保留 30 天 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D14 |
| 72 | **已裁决项视觉状态** = 双区折叠（待裁决顶部展开 / 已裁决底部折叠可展开）；[应用本次裁决] 与 [🔄 重扫] 按钮并排在待裁决区底部 | [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md) D15 |

---

## v1.0.3 增量决策（9 轮 grilling 沉淀 · 2026-07-20）

> 本节是 v1.0.2 锁定后的迭代记录，不修改上面 v1.0 / v1.0.1 / v1.0.2 决策。所有增量由 [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) 承载完整内容。

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 73 | **关联仓库弹层仓库池数据源 = `~/.aidevspace/repos/` 物理目录**（决策 4 的延伸：目录即真相）；**不**采用配置清单 / `config.yaml` 字段方案（双写漂移 + 决策 24 反对"让用户编辑配置"） | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D1 |
| 74 | **仓库池扫描策略 = 每次 `GET /api/repos` 实时 readdir，无缓存**；本期仓库数 < 100 时 IO < 5ms，缓存收益低；inotify 跨平台复杂度过高 | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D2 |
| 75 | **仓库池字段最小集 = `{id, name}`**；`id = 'repo-<dirname>'` slug；**不**返回默认分支 / 语言 / SSH URL（元数据留给后续 `~/.aidevspace/repos/<name>/.aidevspace/repo.yaml` 提案）；**不**校验 `.git/` 存在（决策 30 接受"非 git 目录污染列表"为显式代价） | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D3 |
| 76 | **拉取策略 = SSR 初始 + 弹层 refetch 兜底**；进入 DRAFTING 时 `getDraftingData()` 调一次 + 弹层打开时 `useEffect` refetch；refetch 失败 → 静默沿用当前列表 | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D4 |
| 77 | **`GET /api/repos` = workspace 顶层资源**，与 `POST /api/requirement/:id/repos`（决策 4 + issue 02）形成"全局池 vs 需求关联"对照；**不**采用 `/api/workspace/repos` 命名空间（workspace 命名空间当前未使用，为时过早） | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D5 |
| 78 | **`~/.aidevspace/repos/` 目录不存在 → 返 `{repos: []}` 200**；全新安装是合法状态不是错误，前端 [`attach-repos-dialog.tsx`](apps/web/src/components/attach-repos-dialog.tsx) 已有 `availableRepos.length === 0` 的"暂无可选仓库"分支零改动；GET 不允许副作用（**不**自动 mkdir） | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D6 |
| 79 | **"+ 添加新仓库（粘贴 Git URL）" 入口过渡期处理 = 保留 + hint "📋 粘贴 Git URL · 即将上线" + submit 按钮在 URL 非空时 disabled**；`POST /api/repos`（create + clone）端点未实装前不真接 URL；后续 ticket 接入后移除禁用即可，**不**采用"直接隐藏入口"（未来加回 UI 二次成本） | [ADR-0016](docs/adr/0016-attach-repos-real-pool.md) D7 |

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
