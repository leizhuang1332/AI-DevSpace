# ANALYZING 工位：Analysis Skill 驱动的 Analysis Run

Status: ready-for-agent

关联决策：[ADR-0021](../../docs/adr/0021-analyzing-skill-driven-analysis-runs.md)

## Problem Statement

产品经理提供 PRD 后，需要在开发开始前梳理需求、发现会妨碍理解、设计、实现或验收的问题，并持续补充准确的需求上下文。当前 ANALYZING 工位围绕固定 Admission Dimension、Admission Verdict、subproblem/risk/option 三分桶、AnalysisSession、多会话 Tab、Pending Adjudication、Technical Brief 和 Aggregate Module 建模；这些概念把一次“按特定规则识别需求问题”的工作拆成多套互相依赖的状态和产物。

当前实现还存在以下用户问题：

- 用户无法从专用 Analysis Skill 集合中选择本次分析规则。
- 固定 `admission-check → requirement-brainstorm` 双 turn 强制绑定两套旧 Skill 和旧输出协议。
- Claude Code 默认 system prompt 仍参与运行，平台无法完整控制 Analysis Assistant 的身份、权限、输入层级和输出契约。
- 识别结果必须被解析进三分桶，无法适应不同 Analysis Skill 的问题定义。
- 重复点击“开始分析”依赖 Session 模型，最新结果、失败的部分结果与历史结果之间的关系不清楚。
- 用户对问题的回答、解释和补充没有成为下一次分析的稳定需求上下文。
- Pending Adjudication、Technical Brief 和 Aggregate Module 只有部分链路落地，却持续增加 UI、数据和状态复杂度。
- 旧运行日志、模型自由文本、工具活动和正式问题混在同一种 chunk 中，无法明确区分审计过程与业务产物。

用户需要的是一个更直接的闭环：选择一个 Analysis Skill，发起一次独立 Analysis Run，实时看到逐条 Analysis Issue，针对问题补充 Issue Response，再用全部历史已答复上下文发起下一次 Run，避免重复提出已经解决的问题。

## Solution

将 ANALYZING 重构为由 Analysis Skill 驱动的可重复问题识别工位：

1. Workspace 提供独立的 Analysis Skill 集合，用户为每个 Analysis Run 单选一个 Skill。
2. 每次点击“开始分析”创建新的 Analysis Run；同一 Requirement 同时最多运行一个 Run。
3. Analysis Assistant 使用完全自定义的 system prompt 覆盖 Claude Code 默认 prompt，只拥有受限的只读能力和两个受控业务输出工具。
4. Assistant 每发现一条问题就通过 `report_analysis_issue` 提交统一 Analysis Issue；平台立即校验、持久化并通过 SSE 展示。
5. Assistant 检查结束后调用 `complete_analysis`；平台同时验证 SDK 正常结束、无未决工具调用且所有 Issue 已持久化，才把 Run 标记为成功。
6. 用户可在任意未删除历史 Run 中为单条 Issue 填写 Markdown Issue Response。Response 自动保存，不修改原始 Issue。
7. 下一次 Run 原文注入全部历史中已有 Response 的 Issue 与 Response；未答复 Issue 不继承。
8. 最新 Run 默认展示，历史 Run 通过侧边抽屉切换；失败 Run 保留错误、部分 Issue 和完整 Run Log。
9. 删除固定 Admission、三分桶、多会话、待裁决、Technical Brief、Aggregate Module、固定双 turn 和 interject 领域链路。
10. 旧磁盘数据不迁移、不自动删除，由新页面和新 API 忽略。

## User Stories

1. As a 产品经理, I want to在开始分析前看到可用 Analysis Skill 的名称和功能简介, so that 我能选择符合本次 PRD 检查目标的规则。
2. As a 产品经理, I want to一次 Analysis Run 只选择一个 Analysis Skill, so that 我能明确理解每次识别结果的判断依据。
3. As a 产品经理, I want to系统记住当前 Requirement 上次选择的 Analysis Skill, so that 我不必在连续分析时重复选择。
4. As a 首次使用者, I want to默认获得 PRD 完整性与实施准备度两个 Analysis Skill, so that 上传功能尚未提供时也能立即开始分析。
5. As a Workspace 管理者, I want to Analysis Skill 与全局、个人和项目 Skill 分开存放与扫描, so that 非 ANALYZING Skill 不会出现在选择器中。
6. As a Workspace 管理者, I want to应用升级时更新系统同名默认 Analysis Skill, so that 所有 Workspace 使用当前系统规则。
7. As a 产品经理, I want to每次点击“开始分析”都创建新的 Analysis Run, so that 每次识别结果都能独立回看。
8. As a 产品经理, I want to同一 Requirement 同时最多有一个运行中的 Run, so that 并发结果不会交错或争用历史状态。
9. As a 产品经理, I want to运行时禁用重复启动, so that 快速连点不会创建多个 Run。
10. As a 多标签页用户, I want to服务端拒绝同一 Requirement 的第二个并发启动, so that 不同浏览器标签页也不能绕过单运行约束。
11. As a 产品经理, I want to开始新 Run 时自动切换到它, so that 我能立即看到新分析进度。
12. As a 产品经理, I want to运行期间仍能切换到旧 Run, so that 我可以利用等待时间查看和回答历史问题。
13. As a 产品经理, I want to新 Run 完成时不抢回我手动切换后的焦点, so that 当前阅读和编辑不会被打断。
14. As a 产品经理, I want to页面首次进入时默认展示最新 Run, so that 我看到的是最近一次分析状态和结果。
15. As a 产品经理, I want to通过历史分析侧边抽屉按时间倒序查看 Run, so that 历史增长后仍能快速定位。
16. As a 产品经理, I want to历史项显示开始时间、Skill 名称、执行状态和 Issue 数量, so that 我无需打开详情就能辨认 Run。
17. As a 产品经理, I want to看到成功且零 Issue 的明确空态, so that 我知道本次 Skill 没有识别出问题，而不是系统没有运行。
18. As a 产品经理, I want to看到失败 Run 的错误原因, so that 我知道重跑是否有意义。
19. As a 产品经理, I want to失败 Run 保留已经识别出的部分 Issue, so that 已完成的分析工作不会因后续错误丢失。
20. As a 产品经理, I want to失败 Run 仍可填写 Issue Response, so that 有效的部分发现仍能完善需求上下文。
21. As a 产品经理, I want to终态失败后再次点击创建新 Run, so that 历史身份保持清晰而不是继续修改失败记录。
22. As a 产品经理, I want to临时网络或限流错误在同一 Run 内自动重试, so that 短暂故障不会制造无意义的新历史项。
23. As a 产品经理, I want to工具调用重试不会重复生成同一条 Issue, so that 传输重放不会污染结果。
24. As a 产品经理, I want to系统不擅自合并语义相似的 Issue, so that 不同问题不会被错误去重。
25. As a 产品经理, I want to每条 Issue 都有标题和解释, so that 我能理解问题是什么以及为什么影响开发。
26. As a 产品经理, I want to每条 Issue 至少有一个来源引用, so that 我能定位模型判断所依据的文档或代码。
27. As a 产品经理, I want to来源引用使用逻辑根和相对路径, so that Workspace 迁移后仍有机会定位历史来源。
28. As a 产品经理, I want to Repository 来源标识仓库名称, so that 多仓库 Requirement 中不会混淆同名文件。
29. As a 产品经理, I want to有明确文字证据时跳转到对应行范围, so that 我能快速核对上下文。
30. As a 产品经理, I want to缺失类问题可以引用被检查的文件或章节, so that Assistant 不必为不存在的内容伪造行号。
31. As a 产品经理, I want to来源文件变化或消失时看到引用缺失状态, so that 历史页面不会崩溃或误导定位。
32. As a 产品经理, I want to查看 Skill 提供的严重度、分类或置信度元数据, so that 不同 Skill 能表达自身需要的附加信息。
33. As a 产品经理, I want to元数据不自动决定 Verdict 或排序, so that 平台不会错误解释 Skill 专属字段。
34. As a 产品经理, I want to Assistant 只报告问题而不提出解决方案, so that ANALYZING 聚焦需求准入而不是替产品或技术团队决策。
35. As a 产品经理, I want to识别过程以覆盖优先, so that 边界问题不会因为置信度不够高而被静默省略。
36. As a 产品经理, I want to原始 Analysis Issue 在 Run 完成后保持不变, so that 历史能代表 AI 当时实际报告的内容。
37. As a 产品经理, I want to为每条 Issue 填写一份 Markdown Response, so that 我能自由回答、解释或补充需求背景。
38. As a 产品经理, I want to编辑 Response 而不是编辑原始 Issue, so that AI 识别结果和用户补充事实保持清晰边界。
39. As a 产品经理, I want to任意未删除历史 Run 的 Issue 都可答复, so that 我能补录之前遗漏的需求信息。
40. As a 产品经理, I want to Response 非空即视为已答复, so that 我不需要额外理解草稿、确认或裁决状态。
41. As a 产品经理, I want to Response 自动保存, so that 连续回答多个问题时无需逐条点击保存。
42. As a 产品经理, I want to看到“输入中、保存中、已保存、保存失败”状态, so that 我知道内容是否已经进入服务端上下文。
43. As a 产品经理, I want to切换历史项时立即刷新待保存 Response, so that 导航不会轻易丢失编辑。
44. As a 产品经理, I want to点击开始分析时等待所有最新 Response 保存完成, so that 新 Run 不会漏掉刚输入的内容。
45. As a 产品经理, I want to任一 Response 保存失败时阻止启动并提供重试, so that 我不会误以为未保存答复参与了分析。
46. As a 产品经理, I want to并发保存响应按版本顺序处理, so that 较晚返回的旧请求不会覆盖更新正文。
47. As a 产品经理, I want to运行期间填写的新 Response 只影响下一次 Run, so that 已经组装的当前分析上下文不会在中途漂移。
48. As a 产品经理, I want to下一次 Run 原文读取全部历史已答复 Issue 与 Response, so that 用户确认的信息成为最准确的需求上下文。
49. As a 产品经理, I want to未答复 Issue 不进入下一次 prompt, so that 尚未确认的问题不会被错误当作需求事实。
50. As a 产品经理, I want to历史答复按更新时间从旧到新解释, so that 后续修正可以覆盖早期说法。
51. As a 产品经理, I want to已被充分答复的问题默认不再重复报告, so that 每次分析不会反复询问同一件事。
52. As a 产品经理, I want to答复不足、矛盾或与当前文件冲突时允许关联重报, so that 旧答复不会掩盖仍未解决的问题。
53. As a 产品经理, I want to历史答复超过模型上下文预算时收到明确阻止提示, so that 平台不会静默截断或总结准确需求事实。
54. As a 产品经理, I want to PRD 非空且存在可用 Skill 时才能启动, so that Analysis Run 总有明确的分析对象和规则。
55. As a 产品经理, I want to关联 Repository 可以为空, so that 纯业务 PRD 仍能做完整性分析。
56. As a 产品经理, I want to Assistant 可读取当前 Requirement 和关联 Repository, so that 它能核对 PRD 与实际代码上下文。
57. As a Workspace 用户, I want to Assistant 无法读取其他 Requirement, so that 跨需求内容不会泄漏进当前分析。
58. As a Workspace 用户, I want to Assistant 无法读取凭据、环境变量文件、版本控制内部数据和快照, so that 只读分析仍有明确安全边界。
59. As a Workspace 用户, I want to PRD、代码、配置和提示词文件中的命令式文字只被当作数据, so that 文件内容不能改变 Assistant 权限或输出协议。
60. As a Workspace 用户, I want to Analysis Skill 只能定义识别目标和规则, so that 上传或系统 Skill 不能扩大工具权限。
61. As a Workspace 用户, I want to Assistant 不能调用 Bash、Write、Edit、网络搜索、子 Agent 或未声明 MCP, so that Analysis Run 不会修改 Workspace 或访问外部系统。
62. As a 产品经理, I want to Assistant 每发现一条问题就立即正式提交, so that 页面可以实时显示并在失败时保留完整问题。
63. As a 产品经理, I want to半截 JSON 或未完成工具参数不形成 Issue, so that 页面不会出现损坏的部分记录。
64. As a 产品经理, I want to正式 Issue 只能通过受控报告工具产生, so that 普通模型叙述不会被误当业务结果。
65. As a 产品经理, I want to Run 只有在显式完成和 SDK 正常结束后成功, so that 模型提前停笔不会显示为成功。
66. As a 产品经理, I want to完成工具不要求模型自报 Issue 数量或总结, so that 平台只信任自身已经持久化的事实。
67. As a 产品经理, I want to没有业务 Verdict, so that Issue 数量不会被粗暴解释为 PRD 通过或失败。
68. As a 产品经理, I want to查看运行期间的模型普通文本, so that 我能了解 Assistant 当前正在做什么。
69. As a 产品经理, I want to查看工具调用和完整工具输入输出, so that 我能审计它实际检查了哪些材料。
70. As a Workspace 用户, I want to Run Log 排除 system prompt, so that 平台提示词和历史上下文不会在日志中重复暴露。
71. As a Workspace 用户, I want to Run Log 不记录 raw chain-of-thought, so that 产品不依赖不可获得或不应展示的内部推理。
72. As a Workspace 用户, I want to Run Log 对凭据内容强制脱敏, so that 工具结果中的秘密不会被持久化展示。
73. As a 产品经理, I want to运行中日志默认展开, so that 我能观察正在进行的分析。
74. As a 产品经理, I want to终态 Run 的日志默认折叠, so that 历史页面优先展示 Issue 和 Response。
75. As a 产品经理, I want to展开历史 Run 的日志, so that 我能回看当时完整运行过程。
76. As a 产品经理, I want to Run Log 不进入后续分析上下文, so that 过程叙述不会被误当需求事实。
77. As a 产品经理, I want to二次确认后永久删除终态 Run, so that 我能清理无价值或错误的历史记录。
78. As a 产品经理, I want to运行中的 Run 不可删除, so that 删除不会与正在写入的 Issue 和日志竞争。
79. As a 产品经理, I want to删除 Run 时级联删除它的 Issue、Response 和 Log, so that 不会留下孤立数据。
80. As a 产品经理, I want to删除 Run 后其 Response 不再进入后续上下文, so that 已删除信息不会继续影响分析。
81. As a 产品经理, I want to文档阅读器继续与 SourceRef 联动, so that 点击 Issue 可以回到 PRD、AuxFile、Asset 或代码来源。
82. As a 产品经理, I want to主区保留文档、Issue 和 Response, so that 我能在同一工作环境中核对和补充上下文。
83. As a 产品经理, I want to历史列表使用抽屉而不是横向 Session Tab, so that 历史增长不会压缩主区或重新引入会话心智。
84. As a 产品经理, I want to Analysis Skill 选择器替代 Admission Dimension 卡片, so that 启动配置表达实际分析能力而不是固定维度。
85. As a 产品经理, I want to页面不再显示待裁决徽章和接受风险操作, so that Issue Response 成为唯一用户补充机制。
86. As a 产品经理, I want to页面不再提供新建 Session、Session Tab 和角度选择, so that 每次点击开始直接创建清晰的 Analysis Run。
87. As a 产品经理, I want to页面不再提供生成或重扫 Technical Brief, so that ANALYZING 只聚焦问题识别和需求上下文。
88. As a 产品经理, I want to页面不再展示或编辑 subproblem/risk/option Product, so that 新 Issue 契约不受旧三分桶限制。
89. As a 产品经理, I want to页面不再提供运行中 interject, so that 当前 Run 的输入边界在启动时确定。
90. As a 开发者, I want to组件、类型、testid 和文案全面使用 analysis-run、analysis-skill、analysis-issue、analysis-response 术语, so that 代码不会继续携带 Admission、Session 和 Product 的旧语义。
91. As a 升级用户, I want to旧 Session、chunk、Product、adjudication、Technical Brief 和 Module 文件保持原样, so that 升级不会破坏本地历史文件。
92. As a 升级用户, I want to新页面和 API 忽略旧 ANALYZING 数据, so that 新领域模型不会因兼容分支继续依赖旧产物。
93. As a CLARIFYING 用户, I want to工位仍可进入且不再要求新的 ANALYZING 生成 modules 数据, so that ANALYZING 重构不会让现有路由直接失败。
94. As a 产品负责人, I want to CLARIFYING 的新职责另行设计, so that 本次范围不会为了旧交接关系重新引入第二类分析产物。

## Implementation Decisions

1. **核心聚合**：Requirement 拥有多个 Analysis Run；Run 拥有不可变 Analysis Issue、可变 Issue Response 和持久化 Analysis Run Log。
2. **Run 生命周期**：持久状态仅包含 `running`、`succeeded`、`failed`。删除是物理级联操作，不保留 `deleted` 业务状态；本期没有 `cancelled`。
3. **单运行约束**：同一 Requirement 同时最多存在一个 `running` Run。启动端点必须原子检查并创建，不能只依赖前端按钮禁用。
4. **Skill 引用**：Run 只保存 Analysis Skill 名称。每次启动按名称读取当前最新 Skill 内容；不保存版本、哈希、正文或完整 prompt 审计信息。
5. **Skill 文件契约**：每个 Analysis Skill 声明唯一名称、功能简介和语义版本，正文只允许描述识别目标、判断规则与领域边界。版本用于 Skill 自身管理，不进入 Run 历史。
6. **Skill 集合**：Analysis Skill 使用独立 Workspace 集合，不参与既有 built-in/user/project Skill union 或同名覆盖链。
7. **默认 Skill**：安装与升级过程确保 `prd-completeness` 和 `implementation-readiness` 存在，并强制用系统版本覆盖同名默认 Skill。其他名称由 Workspace 保留。
8. **Skill 默认选择**：首次使用选择稳定排序后的第一项；之后按 Requirement 记住上次选择。已记住名称不存在时回退第一项。
9. **启动契约**：保留现有 Requirement 分析启动入口的产品语义，请求增加必填 `skill_name`；成功响应返回 Run 标识、Skill 名称、创建时间和 `running` 状态。客户端继续对响应做运行时 Schema 校验。
10. **启动前提**：PRD 必须存在且非空，所选 Skill 必须存在且有效，当前 Requirement 不得有运行中 Run，客户端所有 Issue Response 最新编辑必须 flush 成功，历史已答复上下文必须通过 token 预算预检。
11. **Response 一致性**：自动保存采用防抖；失焦、历史切换与开始分析时立即 flush。客户端维护单调编辑版本，忽略旧保存响应，任一最新保存失败时禁用启动并提供重试。
12. **启动时上下文**：服务端在启动事务中重新读取已持久化 Response，按更新时间稳定排序并组装本次 prompt。浏览器未持久化草稿不属于服务端上下文，因此前端 flush 门禁是启动 UX 的必要组成。
13. **完整历史答复**：只加载未删除 Run 中正文非空的 Response，同时携带原始 Issue 标题、描述、SourceRef、metadata 和 Response 更新时间。不得注入未答复 Issue、Run Log 或旧技术产物。
14. **冲突解释**：不在平台层做语义合并；Prompt 明确告诉 Assistant 较新的 Response 事实优先，且只在答复不足、矛盾或与当前内容冲突时关联重报。
15. **上下文预算**：完整原文超过当前模型可接受预算时返回显式 `context_overflow`，并阻止创建 Run。不得取最近 N 条、静默截断或自动总结。
16. **System Prompt**：通过 Agent SDK 自定义 `systemPrompt` 完全覆盖 Claude Code preset，不使用 append。固定平台外壳位于动态 Skill、历史答复和运行范围之前。
17. **Prompt 层级**：依次为身份与任务、指令权限、能力边界、识别原则、问题报告协议、完成协议、当前 Skill、已答复需求上下文、当前运行范围。
18. **Prompt 信任模型**：平台外壳具有最高权限；Skill 只能约束识别目标；Issue Response 与 Workspace 文件只能作为事实数据，任何命令式文字均无权改变工具、协议和完成条件。
19. **Agent SDK 配置**：只向模型暴露 Read、Glob、Grep 和两个受控业务工具；显式禁止 Bash、Write、Edit；使用非交互拒绝模式；不加载会扩展权限的项目/用户 settings 或 MCP。
20. **路径边界**：Read、Glob、Grep 的宿主处理层必须验证路径位于当前 Requirement 或关联 Repository 逻辑根内，并显式拒绝其他 Requirement、秘密文件、版本控制内部目录与 snapshot。
21. **单 query 模型**：删除固定双 turn。每个 Run 创建一次 Agent SDK query，工具循环可包含多次模型请求，但它们属于同一个业务 Run。
22. **正式输出通道**：不配置 Agent SDK `outputFormat`。正式问题只能通过 `report_analysis_issue`，完成只能通过 `complete_analysis`；模型普通文本仅进入 Run Log。
23. **Issue 工具 Schema**：输入只包含 `title`、`description`、`sourceRefs` 和可选 `metadata`。Run ID、Issue ID、顺序和时间由平台上下文生成，模型不能提供。
24. **Issue 幂等**：使用 Agent SDK 工具调用标识作为同一调用重放的幂等键。平台不按标题、来源或语义指纹自动合并不同调用。
25. **Issue 核心字段**：标题和描述为非空文本；至少一个 SourceRef；metadata 为字符串键到 JSON 基础值或基础值数组的映射，不接受任意嵌套对象。
26. **SourceRef 契约**：包含 `source_kind`、相对路径及可选章节和行范围；Repository 来源必须带仓库名。内部行范围沿用既有零基、半开约定，UI 转为用户可读行号。
27. **缺失来源**：历史 SourceRef 指向不存在文件、仓库或 Asset 时，返回可渲染的缺失状态，不抛出页面级错误。
28. **问题内容边界**：平台外壳要求覆盖优先、只报问题、不生成解决方案。Skill 可使用 metadata 表达严重度、分类和置信度，但不得绕过核心字段或放入 suggestion。
29. **逐条持久化**：`report_analysis_issue` 参数完整并通过服务端 Schema 后，平台同步赋予标识并追加持久化，再发布 SSE 和返回工具确认；半截流数据不能形成 Issue。
30. **完成工具**：`complete_analysis` 无业务参数。调用接受后 Run 进入内部 `completion_requested` 门禁状态，但仍不属于成功终态，并拒绝后续 Issue 提交。
31. **成功门禁**：仅当完成工具已接受、SDK 返回成功结果、无未决工具调用、全部已接收 Issue 已持久化时写入 `succeeded`。
32. **失败语义**：SDK 错误、超时、进程中断、未调用完成工具便结束、完成后仍有未决提交、持久化失败均写入 `failed`，并保留错误与已经成功提交的数据。
33. **自动重试**：临时传输和限流重试保持同一 Run 标识，并依赖工具调用幂等；终态失败不能恢复或续跑。
34. **进程恢复**：Agent 启动或读取历史时发现没有活跃执行上下文的 `running` Run，将其收敛为带中断原因的 `failed`，避免永久占用单运行锁。
35. **SSE 契约**：新增 Run 状态、Run Log、Issue 已提交和 Run 终态事件。事件携带 Requirement 与 Run 标识，客户端按 Run 路由，终态成功与失败互斥。
36. **SSE 焦点规则**：SSE 更新数据状态但不直接决定当前选中 Run；只有用户启动新 Run 时自动选中，终态事件不能覆盖用户后续手动选择。
37. **Run Log**：持久化 SDK 可获得的模型普通文本、工具活动和完整工具输入输出；不持久化 system prompt、raw chain-of-thought 或无法安全展示的内部消息。
38. **日志脱敏**：在写盘与 SSE 发布之前执行统一脱敏；至少覆盖授权头、API key、token、password、私钥和已知秘密文件内容。日志 UI 不负责补救服务端未脱敏内容。
39. **日志展示**：运行中默认展开，终态默认折叠；用户手动展开状态属于界面状态，不改变 Run 数据。
40. **Issue Response**：每个 Issue 最多一份 Markdown Response，独立于原始 Issue 保存；正文 trim 后非空即“已答复”。保存返回创建时间、最后更新时间和编辑版本。
41. **历史列表**：通过扫描新的 Run 聚合生成，不复用 Session index。默认按创建时间倒序，最新 Run 为首次选中项。
42. **删除契约**：仅终态 Run 可删除；请求前必须二次确认。服务端级联删除 Run 元数据、Issue、Response 和 Log；删除后重新组装上下文时不得再出现其 Response。
43. **持久化聚合**：每个 Run 使用独立目录；Run 元数据、Issue 追加日志、运行日志和按 Issue 保存的 Response 分开存储。历史列表从这些 Run 聚合生成。
44. **旧数据兼容**：旧 Session、chunk、Product、adjudication、Technical Brief 和 Module 文件保持原样，不迁移、不删除；新 loader、上下文装配和 UI 不再读取它们。
45. **UI 顶部**：用 Analysis Skill 单选器替代 Admission Dimension 展示，保留常驻“开始分析”操作和明确的 idle/starting/running 状态。
46. **UI 历史**：用“历史分析 N”侧边抽屉替代 Session Tab；历史行显示时间、Skill 名称、状态、Issue 数量和删除入口。
47. **UI 主区**：继续采用文档阅读器与 Issue 区的主布局；Issue 卡展示原始字段、通用 metadata、SourceRef 联动和 Response 编辑器。
48. **UI 日志**：Run Log 使用独立可折叠区域，不重新引入旧 ThinkingStream 作为业务产物。
49. **删除旧 UI**：移除 Verdict/待裁决、接受风险、Session 新建与 Tab、angle、Product 三分桶编辑、Technical Brief 生成/重扫、Session 创建对话框和 interject。
50. **命名迁移**：新增和重写的组件、类型、事件、testid、错误码和文案只使用 Analysis Skill、Analysis Run、Analysis Issue、Issue Response、Analysis Run Log 术语，不保留 admission/session/product 兼容别名。
51. **CLARIFYING 边界**：CLARIFYING 路由暂时保留，但不得要求新 ANALYZING 产生 Module；其未来输入、领域模型和产品职责不在本规格内。

## Testing Decisions

1. **测试原则**：优先断言用户或 API 调用方可观察的行为，不断言内部函数调用顺序、React state 形状、Prompt 字符串拼接细节或具体文件实现。只有安全边界、持久化契约和 Prompt 权限层级需要直接契约测试。
2. **主要测试接缝**：以“启动分析 REST → fake Agent SDK 工具循环 → 真实 Run 文件存储 → 真实 SSE Hub”为最高层集成接缝。该接缝应覆盖正常启动、逐条 Issue、Run Log、显式完成、成功门禁、失败部分结果、自动重试幂等和同 Requirement 并发拒绝。
3. **接缝理由**：现有分析启动路由测试已经使用临时 Workspace、可注入 Provider 和真实 SSE Hub，能够在不调用真实模型的情况下验证最关键的端到端协议，因此应扩展这一接缝而不是为每个内部模块建立大量孤立单测。
4. **Prompt/权限契约接缝**：用可记录 Agent SDK adapter 捕获最终 options，断言 custom system prompt 被使用、Claude Code preset 未启用、只读工具与业务工具是唯一可用工具、危险工具被禁止、Skill 和已答复上下文处于低权限数据区。不要做完整字符串快照；断言必要章节和边界。
5. **Response/上下文接缝**：以真实 Run 存储写入多轮 Issue Response，再启动下一 Run，捕获组装输入，验证只包含未删除历史中的已答复原文、排序稳定、未答复不注入、删除后消失、超预算显式失败。
6. **Web 行为接缝**：使用组件集成测试配合真实 reducer/客户端 Schema，覆盖 Skill 单选、自动保存状态、启动前 flush 门禁、历史抽屉切换、运行中手动选中不被终态事件抢回、失败部分 Issue 和级联删除确认。
7. **SourceRef 接缝**：继承现有文档阅读器与 SourceRef 联动测试，扩展 Requirement、Repository、AuxFile、Asset、章节级缺失引用和来源已删除降级场景。内部继续使用既有零基半开范围约定。
8. **日志安全接缝**：向 fake Provider 注入包含 token、授权头、私钥和秘密文件内容的工具输入输出，断言持久化和 SSE 中均已脱敏；同时断言 system prompt 与 thinking 事件从未进入 Run Log。
9. **文件聚合接缝**：使用临时 Workspace 验证 Run 独立聚合、Issue 追加、Response 覆盖保存、Agent 重启后的 running→failed 收敛以及终态级联删除。只断言公共存储契约，不锁定 YAML 字段排列或 JSON 格式化。
10. **旧数据隔离接缝**：预置 legacy Session、chunk、Product、adjudication、Technical Brief 和 Module 文件，验证新列表、上下文和 UI 完全忽略，同时原文件未被修改或删除。
11. **真实模型 E2E**：改写现有 opt-in ANALYZING 真实运行用例，选择默认 Skill，观察至少一条 Issue 或合法零 Issue 成功态，保存 Response 后再次运行并验证新 Run 创建。继续在缺少模型凭据时跳过，不作为普通 CI 的唯一证明。
12. **既有先例**：优先复用分析启动路由的鉴权/400/409/201测试模式、fake analysis provider、真实 SSE Hub 测试、SourceRef 跨端镜像测试、ANALYZING 页面集成测试和 opt-in 真实运行 E2E。
13. **删除测试**：删除所有只证明旧 Admission Dimension、Verdict、三分桶、Synthetic Product、Session Tab、Technical Brief、Pending Adjudication 和双 turn 的测试；保留并迁移仍有效的文档阅读器、SourceRef、SSE、错误处理和真实 Provider 测试意图。
14. **关键验收场景**：至少覆盖双标签并发启动、快速连点、Response 保存乱序、保存失败阻止启动、历史答复超预算、Skill 在页面加载后被覆盖、工具调用重放、完成工具缺失、完成后继续报告、SDK 成功但持久化失败、Agent 重启遗留 running、历史 SourceRef 漂移、删除后上下文消失和日志秘密脱敏。
15. **不测试实现细节**：不要求某个内部类名、模块拆分、缓存方式、目录扫描函数或 debounce 库；只要外部契约、领域不变量和文件兼容行为成立即可。

## Out of Scope

- Analysis Skill 上传、编辑、删除、市场或远程安装 UI/API。
- Analysis Skill 的版本历史、回滚、签名、来源审计和 Run 级 Skill 内容快照。
- 完整 system prompt 或 Prompt 组成快照的持久化与审计页面。
- 多 Skill 组合、平台固定双 turn、Skill 自定义 turn 数或多 Agent 编排。
- 用户主动取消、暂停、恢复或续跑 Analysis Run。
- 运行中 interject 或把输入排队到当前/下一 Run。
- Issue 的人工修改、删除、合并或 AI 语义去重。
- Assistant 自动提出解决方案或生成技术设计。
- Issue Response 的草稿/确认/裁决状态、预设答案和批量应用。
- 自动总结、截断或只选最近历史 Response。
- Technical Brief、Aggregate Module、Module 交接和 CLARIFYING 新领域模型。
- 旧 Session、chunk、Product、adjudication、Technical Brief 和 Module 数据迁移或清理。
- 移动端和多用户协作。
- 用 Run 历史还原当时 Skill 版本或当时完整文件输入。
- SourceRef 证据摘录或输入文件快照；历史引用允许随当前 Workspace 内容漂移。
- 普通 CI 强制调用真实 Claude Agent SDK 模型。

## Further Notes

- 本规格使用 [CONTEXT.md](../../CONTEXT.md) 中的 Analysis Skill、Analysis Run、Analysis Assistant、Analysis Issue、Issue Response 和 Analysis Run Log 术语。
- 本规格由 ADR-0021 约束，并完整替代旧 ANALYZING 的 Admission Dimension、Pending Adjudication、多会话、Technical Brief、Aggregate Module 与固定双 turn 产品模型。
- 文档阅读器和 SourceRef 联动原则继续有效，但 SourceRef 扩展为 Requirement 与 Repository 的逻辑根相对定位。
- Run 只记录 Skill 名称是有意取舍：实现和历史更轻，但同名 Skill 被升级覆盖后无法还原旧 Run 当时实际使用的规则。
- 系统默认 Skill 强制覆盖同名 Workspace 文件也是有意取舍；未来上传功能应避免把系统保留名称呈现为可永久自定义名称，或明确提示升级覆盖行为。
- Run Log 的“完整”指 SDK 对应用可见的普通文本和工具输入输出，不包含 raw chain-of-thought；任何凭据在写盘前必须脱敏。
- 测试接缝采用当前代码库已有的高层模式，不要求先建立新的全局测试框架。
