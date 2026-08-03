# AI-DevSpace 项目术语表（Glossary）

> 本文档是项目的"活字典"。所有领域名词在此有且仅有一个含义。修改任何产品设计前，请先来对照术语。
>
> 创建：2026-07-08  
> 当前版本：v1.0.5（ANALYZING Analysis Run 模型）

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

### AuxFile（辅助文件）

Requirement 内的"参考资料文档"，由用户在 DRAFTING 工位上传或新建。物理落点 `requirements/<req-id>/aux/<aux-id>/<file>.md`，作为**独立 markdown 文档**（不是 PRD 的一部分）。

- 6 种受控 `usage_tag`：`api` / `data` / `research` / `sop` / `ui` / `other`（决定 UI 颜色 / 图标 / 排序分组）
- 3 种 `source_format`：`.md`（直读） / `.docx`（mammoth 转 md） / `.pdf`（pdf-parse 转 md），转换后 `converted_to_md: true`
- 与 Asset 区分：Asset 是 PRD 内联的图（`![](assets/prd-1.png)`），AuxFile 是**独立文档**（与 PRD 平级，可独立打开）
- 与 PRD 区分：PRD = 需求正文（`requirement.md`），AuxFile = 需求正文**之外**的参考材料
- 与 Knowledge 区分：Knowledge = 跨需求全局共享（`~/.aidevspace/knowledge/`），AuxFile = 单需求内私有
- 数据模型：`packages/shared/src/drafting.ts` 的 `AuxFile { id, filename, body, usage_tag, source_format, converted_to_md }`
- DRAFTING 工位 `<AuxFilesPane>` 是创建/上传入口；ANALYZING 工位主区左侧"文档阅读器"按 `usage_tag` 排序展示（详见 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D2）

_Avoid_: 辅助材料 / 物料文档 / 附件（都模糊；本术语锁定为 AuxFile）

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

### Analysis Skill（分析技能）

专用于 ANALYZING 工位、可由用户为一次 Analysis Run 选择的 Skill 类别。它定义该次识别的目标、判断规则与输出要求。

- 与全局 Skill、个人 Skill、项目 Skill 分属不同集合，不参与彼此的扫描与覆盖
- Analysis Skill 是 Workspace 级共享能力，同一 Workspace 内的所有 Requirement 可选
- 一个 Analysis Run 必须且只能选择一个 Analysis Skill
- 每个 Analysis Skill 声明唯一名称、功能简介与语义版本，正文描述识别目标、规则和边界；平台另以内容哈希标识实际内容
- Analysis Skill 只定义识别目标、检查规则和领域说明；不得改变分析助手身份、只读边界、问题契约、报告通道或完成条件
- 当前从独立集合读取，未来允许用户向该集合上传新的 Analysis Skill

_Avoid_: Admission Dimension（旧的固定检查维度）、普通 Skill（无法表达其专用范围与输出职责）

### Analysis Assistant（分析助手）

执行 Analysis Run 的 AI 身份。它依据被选 Analysis Skill 检查运行时可读取的当前内容，只识别和解释问题而不提出解决方案，并按统一问题契约返回识别结果。

- 只读范围限于当前 Requirement 及其已关联的 Repository；其他 Requirement、凭据、版本控制内部数据与快照不属于可读上下文
- 可以使用只读能力补充和核对上下文；读取到的 PRD、AuxFile、代码、配置与提示词文件都只作为待分析数据，不具有指令权限
- 不得修改文件、执行具有副作用的命令或替用户作出业务裁决
- 识别取向以覆盖为先：可疑问题也应报告，严重度与置信度可作为可选元数据，后续由用户答复完善上下文
- 识别出的问题只能通过受控的问题报告通道逐条提交；该通道不是 Workspace 写入能力
- 平台逐条校验、赋予标识、持久化并发布其输出

### Analysis Run Log（分析运行日志）

Analysis Assistant 在执行 Analysis Run 时产生的用户可见过程记录。它保存 SDK 可获得的普通文本、工具活动及工具输入输出，但排除 system prompt 与模型原始思维链，并对凭据内容强制脱敏。它随 Run 持久化，切换历史时可回看，删除 Run 时级联删除；它不属于 Analysis Issue，也不作为后续 Run 的需求上下文。

### Analysis Issue（分析问题）

Analysis Skill 按自身判断规则，从一次 Analysis Run 的输入中识别出的单条问题。所有 Analysis Skill 共享同一种问题契约；Skill 决定“识别什么”，平台决定“如何表达”。

- Analysis Issue 不再预分为 subproblem / risk / option 三类
- 每条 Analysis Issue 必须包含标题、问题描述和一个或多个来源引用；每个来源引用必须给出逻辑根与相对路径，Repository 来源还需标识仓库；能精确定位时给出行范围，缺失类问题可引用被检查的文件或章节；引用仅定位 Workspace 当前内容，不保存证据摘录，历史定位可能随文件变化而漂移；稳定标识、顺序与产生时间由平台赋予
- 严重度、分类、置信度等非通用信息可由 Analysis Skill 放入可选元数据；平台原样保存，并以通用键值形式展示，不据此推导排序、状态或 Verdict；元数据不得承载解决方案
- 一个 Analysis Run 的识别结果由零个或多个 Analysis Issue 组成
- 原始 Analysis Issue 不可编辑；用户通过关联的 Issue Response 回答、解释或补充上下文

_Avoid_: 三分桶产物 / Product（旧 UI 分类概念）

### Issue Response（问题答复）

产品或其他需求相关方针对 Analysis Issue 提供的回答、解释与补充，用于完善 Requirement 的需求上下文。Issue Response 不修改 AI 的原始识别结论。

- 任意未删除的历史 Analysis Run 中的 Analysis Issue 都可新增或编辑 Issue Response
- 每条 Analysis Issue 可关联一份持续完善的 Markdown Issue Response；非空即视为已答复
- Issue Response 自动保存；发起新 Analysis Run 前必须等待所有最新编辑持久化成功，任一保存失败都会阻止启动
- 平台记录 Issue Response 的创建时间与最后更新时间，不再设置草稿或确认状态
- Issue Response 与原始 Issue 分离保存；编辑答复不改变 Analysis Run 的原始结果
- 后续 Analysis Run 原文汇总当前 Requirement 全部历史 Run 中已有 Issue Response 的问题与答复，作为用户确认过的需求上下文；未答复 Issue 不继承；启动前若完整上下文超限则明确阻止运行，不静默截断或总结
- 历史答复按最后更新时间从旧到新解释；内容冲突时以更新更晚的答复为准
- 后续分析默认不重复报告已被答复充分解决的问题；答复不足、自相矛盾或与当前内容冲突时，可报告关联的新问题并说明原因

_Avoid_: 编辑 Issue / 修改识别结果（实际变化的是答复与上下文，不是 AI 当时识别出的原始问题）

### Analysis Run（分析运行）

用户在 ANALYZING 工位每次主动发起的一次独立识别。每个 Analysis Run 拥有唯一所选 Skill 和识别结果；完成后保持不可变。输入内容在运行时从 Workspace 实时读取，不随 Run 保存，因此历史 Run 保留当时结论但不保证输入可复现。

- 发起 Analysis Run 的前提是当前 Requirement 存在非空 PRD、至少有一个可用 Analysis Skill，且所有 Issue Response 的最新编辑已持久化；关联 Repository 可以为空
- 同一 Requirement 可拥有多个 Analysis Run，但同一时刻最多只有一个 Run 正在执行；前一 Run 完成或失败后才能再次发起
- Analysis Run 只有执行状态与 Issue 数量，不产生 pass / pending / fail 等业务 Verdict；成功且零条 Issue 表示所选 Skill 本次未识别出问题
- Analysis Run 只有在分析助手显式声明完成、AI 运行正常结束、没有未决问题提交且所有已接收问题均已持久化时才算成功
- 每个 Analysis Run 是使用唯一 Analysis Skill 的单个分析任务，不再包含固定 admission-check / requirement-brainstorm 双 turn；多步检查由分析助手的工具循环与 Skill 方法完成
- 临时传输或限流错误可在同一 Run 内自动重试，问题提交必须保持幂等；Run 进入终态失败后，再次点击开始始终创建新的 Run
- Analysis Run 启动后不接受用户插话，也不支持用户主动取消；用户通过 Issue Response 补充上下文，再发起新的 Run
- Analysis Run 只记录所选 Analysis Skill 的名称；启动时按该名称读取当前最新内容，不保存版本、哈希或正文快照，后续 Run 仍读取当时的最新内容
- Analysis Run 在启动时固定当时已持久化的 Issue Response 上下文；之后答复变化不改变当前 Run，运行期间的新答复仅供后续 Run 使用
- 最新发起的 Analysis Run 默认展示，无论它成功或失败；失败 Run 保留失败原因与已经产生的部分问题，较早的 Analysis Run 构成可切换历史
- 已结束的 Analysis Run 可由用户二次确认后永久删除；正在执行的 Run 不可删除
- 删除 Analysis Run 会级联永久删除其 Analysis Issue 与 Issue Response，这些答复随后不再进入新 Run 的分析上下文
- Analysis Run 不是可持续对话的 Session，也不是同一结果的覆盖版本

_Avoid_: 分析会话 / 结果版本 / 重扫快照（都会模糊“一次主动发起的独立识别”这一含义）

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
| **ANALYZING** | 需求梳理 + 准入问题识别 | ❌ 主区全宽 | ❌ 无 |
| **CLARIFYING** | 澄清聚合模块落地细节 | ❌ 主区全宽 | ❌ 无 |
| **DESIGNING** | 评审候选方案 | ❌ 默认无 | ❌ 无 |
| **EXECUTING** | 监督 AI 实施 | ✅ 任务 DAG + Diff + 产物 | ✅ 保留 |
| **WRAP-UP** | 归档复盘 | ✅ 产物 + PR + 决策 | ❌ 无 |

详见 [ADR-0011](docs/adr/0011-requirement-workbench-zone-adaptive.md) · [ADR-0012](docs/adr/0012-requirement-workbench-shell-topology.md) · [ADR-0013](docs/adr/0013-analyzing-zone-rewrite.md)

### ANALYZING 工位（展开）

ANALYZING 工位的核心职责是：**在开发前，使用用户选择的 Analysis Skill 梳理 Requirement 内容、识别准入问题，并通过 Issue Response 持续完善需求上下文。**

**核心职能：**

1. 从 Workspace 级 Analysis Skill 集合中选择本次识别规则
2. 发起独立的 Analysis Run，并观察问题逐条产生
3. 查看和切换历史 Analysis Run
4. 针对单条 Analysis Issue 填写 Issue Response
5. 把全部历史中已答复的问题与答复作为后续 Run 的可信需求上下文

**领域边界：**

- ANALYZING 产物是 Analysis Issue 与 Issue Response，不再预分 subproblem / risk / option
- ANALYZING 不再产出 Technical Brief 或 Aggregate Module；CLARIFYING 暂时保留，但不再依赖 `modules.yaml`，其新输入与职责留待后续单独重设
- ANALYZING 不再包含 PRD 准入维度、待裁决、会话、多会话 Tab 或运行中插话概念
- 每次点击“开始分析”创建新的 Analysis Run；Run 之间不共享对话状态，只通过已答复需求上下文建立联系

详见 [ADR-0021](docs/adr/0021-analyzing-skill-driven-analysis-runs.md)。

**历史 Analysis Run 展示形态（v1.0.5 更新，覆盖 ADR-0021 决策 36 的抽屉描述）：**

ANALYZING 主区不再使用永久 320px 抽屉，改为 **「默认折叠的浮动召唤按钮 + 浮动面板」** 形态（v1.0.5 增量决策 88-98，[ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D1-D7）：

- **默认折叠态**：主区右上角 absolute 浮动召唤按钮 `[🗂️ 历史分析 N]`，不占主区宽度；N=0 显示灰色 0；不显示运行中 dot（运行态走底部 AI 思考条）
- **展开态**：浮动面板从 FAB 正下方弹出，宽度 `min(320px, calc(100vw - 24px))`，高度与 [识别产物] 列等高，超出后内部滚动；面板 absolute 覆盖在 [识别产物] 列之上（不挤压列宽），该列加 4% 蒙层提示"面板在前"
- **关闭方式**：点外部 + Esc + ✕ + 选中 Run 自动关（四种都关，符合 Linear popover 心智模型）
- **Cmd+K 入口**：命令面板新增「🗂️ 历史分析 · req-XX · 共 N 个 Run」命令，按 `↵` 直接打开浮动面板（决策 23 形态 C 的键盘召唤通道）
- **状态持久化**：不持久化，永远默认折叠；切需求 / 切工位 / 启动新 Run 时强制收起
- **a11y**：FAB + 面板是 non-modal popover（`role="region"`，**不**用 `role="dialog"`），Tab 焦点自由，不阻断主区交互
- **窄视口**：FAB + 面板全保留（天然兼容），无需 `max-h-[200px]` 折叠条逻辑

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
| 25 | AI 主动推送触发全部取消。ANALYZING 中 AI 通过 Analysis Issue 沉淀问题，用户用 Issue Response 主动补充上下文；不再使用 Pending Adjudication、StatusBar 待裁决计数或主动提问机制。 | [ADR-0021](docs/adr/0021-analyzing-skill-driven-analysis-runs.md) |
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

> 本节记录的旧 ANALYZING 模型已由 [ADR-0021](docs/adr/0021-analyzing-skill-driven-analysis-runs.md) 替代，仅保留为历史背景。原固定准入维度、待裁决、多会话、技术概要与聚合模块决策不再生效。
>
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

## v1.0.4 增量决策（11 轮 grilling 沉淀 · 2026-07-21）

> 本节是 v1.0.3 锁定后的迭代记录，不修改上面 v1.0 / v1.0.1 / v1.0.2 / v1.0.3 决策。所有增量由 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) 承载完整内容。

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 80 | **ANALYZING 主区布局 v2 = 2:1 左右分栏**（覆盖 ADR-0013 §"工位主区布局"的 1:1 描述）；左栏 2 份 = 文档对照阅读器，右栏 1 份 = 识别产物（可编辑） | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D1 |
| 81 | **删除 `<ThinkingStream>` 渲染出口**（打字机 phase state machine 内部保留供 StatusBar / 插话使用；用户不再看 AI 思考过程本身） | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D1 |
| 82 | **左栏 = Tab 栏 + 单文档阅读器**；Tab 顺序 = PRD → AuxFile（按 `usage_tag` 排序）→ Asset 走 PRD 内联渲染（无独立 Tab） | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D2 |
| 83 | **Tab 标签显示 "🔗 N 处引用"** = 该文档被 `AnalyzingChunk.source_refs` 引用的次数；0 处引用显示中性"·" | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D2 |
| 84 | **画线关联 = `AnalyzingChunk.source_refs?: SourceRef[]`**（三形态 union:prd 文本段 / aux 文本段 / asset 图片）；narration chunk 不带，仅 subproblem/risk/option chunk 可带 | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D3 |
| 85 | **点右栏 issue → 联动左栏**（切 Tab + 滚 lineRange + 高亮 pulse 1.5s）；点左栏高亮 → 暂不联动右栏（D4 v2 候选） | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D4 |
| 86 | **VS4 用户加 product 合成 synthetic chunk**（id 前缀 `user-added-<uuid>` + `synthetic: true` 标记）；`source_refs` 不强制（允许"先记草稿"）；重扫时 AI 不复读 synthetic 标记 | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) D6 |
| 87 | **新术语 `AuxFile`（辅助文件）入术语表**——Requirement 内的参考资料文档（独立 markdown），与 Asset（PRD 内联图）/ Knowledge（全局共享）/ PRD（正文）严格区分；数据模型见 `packages/shared/src/drafting.ts` | [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) |

---

## v1.0.5 增量决策（11 轮 grilling 沉淀 · 2026-08-03）

> 本节是 v1.0.4 锁定后的迭代记录，不修改上面 v1.0 / v1.0.1 / v1.0.2 / v1.0.3 / v1.0.4 决策。决策 88-98 由 [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) 承载完整内容。
>
> 本节**覆盖** ADR-0021 决策 36 中"历史 Run 通过侧边抽屉按时间倒序切换"的描述——抽屉改为 FAB + 浮动面板。

| # | 决策 | 关联 ADR |
| --- | ------ | ---------- |
| 88 | **历史列折叠形态 = B 方案**（浮动召唤按钮 FAB + 浮动面板）—— 覆盖 ADR-0021 决策 36 的"主区右侧 320px 永久抽屉"描述 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D1 |
| 89 | **FAB 位置 = 主区右上角 absolute 浮动**（`top: 12px; right: 12px; z-index: 30`），不挤压主区任何列 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D2.1 |
| 90 | **FAB 样式 = 图标+文字+N 计数**（`🗂️ 历史分析 [N]`），N=0 显示灰色 0（不隐藏），N>99 显示 `99+` | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D2.2-D2.3 / D2.5 |
| 91 | **FAB 不显示运行中 dot**——FAB 只显示 N 计数，运行态走底部 AI 思考条 4 指示器（决策 49），避免重复信号 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D2.4 |
| 92 | **浮动面板高度策略 = 与 [识别产物] 列等高，超出后内部滚动**（头部固定，列表内滚；上限不超过 AI 思考条之上）；宽度 `min(320px, calc(100vw - 24px))` 窄视口自适应 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D3.2-D3.4 |
| 93 | **浮动面板覆盖 [识别产物] 列时加 4% 黑色蒙层**（`dimmed` 类，不阻断交互）—— 视觉提示"现在焦点在浮层"，但允许用户继续操作主区（符合 non-modal popover） | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D3.7 |
| 94 | **关闭触发 = 四种都关**（点外部 + Esc + ✕ + 选中 Run 自动关），符合 Linear popover 心智模型 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D4.1 |
| 95 | **Cmd+K 命令面板新增「🗂️ 历史分析」命令**（描述：`req-XX · 共 N 个 Run`），按 `↵` 直接打开浮动面板；不绑 `⌘⇧H` 快捷键（决策 29：90% 走 Cmd+K） | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D4.2-D4.3 |
| 96 | **FAB 面板状态不持久化**——永远默认折叠；切需求 / 切工位 / 启动新 Run 时强制收起；符合决策 24"克制，在场"的"克制"语义 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D4.4 / D5.2-D5.3 |
| 97 | **删除 Run 后行为 = 留面板 + currentRun 自动切到下一个 Run**（按 `created_at` 倒序的第一个非删除 Run）；删除按钮仍走二次确认对话框（沿用 `AnalysisDeleteRunDialog`） | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D5.1 / D5.5 |
| 98 | **a11y = non-modal popover**——FAB `role="button"` + `aria-expanded` + `aria-haspopup`；面板 `role="region"` + `aria-label`（**不**用 `role="dialog"`）；Tab 焦点自由，不阻断主区交互 | [ADR-0022](docs/adr/0022-analyzing-history-floating-action-button.md) D6 |

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
