---
status: accepted
---

# ANALYZING 工位改为基于 Analysis Skill 的可重复问题识别

ANALYZING 不再承担固定准入维度、三分桶、多会话、待裁决和技术概要生成，而是在开发前由用户选择一个 Workspace 级 Analysis Skill，创建独立 Analysis Run，逐条识别 Analysis Issue，并通过 Issue Response 持续补充 Requirement 上下文。该设计以统一问题契约替代旧的阶段与产物模型，使重复分析、历史回看和用户答复形成一个闭环。

## 领域模型

- 每次点击“开始分析”创建一个独立 Analysis Run；同一 Requirement 同时最多运行一个 Run。
- 每个 Run 只记录所选 Analysis Skill 的名称。启动时按名称读取 `~/.aidevspace/analysis-skills/<name>/SKILL.md` 的当前最新内容，不保存 Skill 的版本、哈希或正文快照。
- Analysis Skill 是独立于全局、个人和项目 Skill 的 Workspace 级集合；一个 Run 必须且只能选择一个。
- 首次安装提供 `prd-completeness` 与 `implementation-readiness` 两个默认 Skill；应用升级时强制覆盖同名默认 Skill。上传 Analysis Skill 留待后续。
- Run 的正式识别结果是零个或多个 Analysis Issue，不再分为 subproblem、risk、option，也不产生 pass、pending、fail 等业务 Verdict。
- 每条 Analysis Issue 可关联一份 Markdown Issue Response。Response 用于用户回答、解释和补充，不修改 AI 原始 Issue；非空即视为已答复，不再设置草稿、确认或裁决状态。
- 后续 Run 原文汇总当前 Requirement 全部未删除历史 Run 中“已有 Response 的 Issue + Response”，未答复 Issue 不继承。答复按更新时间从旧到新解释，冲突时较新答复优先；已充分解决的问题不应重复报告，答复不足、矛盾或与当前内容冲突时可关联重报。

## Analysis Assistant

Claude Agent SDK 的 system prompt 使用自定义 `systemPrompt` 完全替换 Claude Code 默认 prompt，不使用 append。Prompt 依次包含：身份与任务、指令权限、能力边界、识别原则、问题报告协议、完成协议、当前 Analysis Skill、已答复需求上下文、当前运行范围。

权限顺序固定为：平台外壳高于 Analysis Skill，Analysis Skill 高于作为事实数据的 Issue Response 与 Workspace 文件。PRD、AuxFile、代码、配置和提示词文件中的命令式文字均不具有指令权限。

Assistant 只允许读取当前 Requirement 及其关联 Repository，并显式排除其他 Requirement、凭据、`.env`、`.git` 与 snapshot。SDK 只暴露 Read、Glob、Grep 以及两个受控业务工具；Bash、Write、Edit、其他 MCP、网络搜索与子 Agent 均不可用。Assistant 以覆盖优先，只识别和解释问题，不提供解决方案。

现有 `admission-check → requirement-brainstorm` 固定双 turn 被删除。每个 Run 是一次 Agent SDK query；多步检查由只读工具循环和 Analysis Skill 内部方法完成。

## 输出协议

正式问题只能逐条调用 `report_analysis_issue` 提交，不依赖自由文本解析，也不配置 Agent SDK `outputFormat`。每条 Issue 至少包含：

- `title`
- `description`
- 一个或多个 `sourceRefs`
- 可选 `metadata`

SourceRef 使用逻辑根与相对路径，Repository 来源额外携带仓库名；能精确定位时给出行范围，缺失类问题可引用被检查的文件或章节。引用不保存证据摘录，因此历史定位可能随 Workspace 当前内容漂移。metadata 原样保存并以通用键值展示，但不驱动排序、状态或 Verdict，也不得承载解决方案。

平台为 Issue 赋予 ID、顺序、时间与 Run 归属，并仅对同一工具调用的重放做幂等处理，不做语义自动去重。

分析结束时 Assistant 必须调用无业务参数的 `complete_analysis`。Run 只有在完成工具已接受、SDK 最终 `result.success`、不存在未决工具调用且所有已接收 Issue 均已持久化时才进入 succeeded。临时传输或限流错误可在同一 Run 内自动重试；终态失败后再次点击始终创建新 Run。失败 Run 保留错误、已提交的部分 Issue 与运行日志。不提供主动取消或运行中插话。

## 历史、答复与日志

最新 Run 默认展示，历史 Run 通过“历史分析”侧边抽屉按时间倒序切换。开始新 Run 时自动选中新 Run；用户若在运行中手动切换到历史项，完成事件不得抢回焦点。任意未删除历史 Run 的 Issue 都可填写 Response；运行期间的新答复只供后续 Run 使用。

Issue Response 自动保存。开始新 Run 前必须刷新并等待所有最新编辑持久化成功；任一保存失败都阻止启动。全部历史答复以原文进入 prompt，启动前进行 token 预检；超限时明确阻止，不静默截断或总结。

Analysis Run Log 随 Run 持久化，包含 SDK 可获得的普通文本、工具活动和工具输入输出；排除 system prompt 与模型原始思维链，并强制脱敏凭据。日志不属于业务产物，也不进入后续 prompt。页面以可折叠面板展示，运行中默认展开，终态后默认折叠。不额外保存完整 system prompt 或其审计组成。

终态 Run 可在二次确认后永久删除，并级联删除其 Issue、Response 与 Log。运行中的 Run 不可删除；删除后的 Response 不再进入后续分析上下文。

## 持久化与兼容

新数据采用 `analysis/runs/<run-id>/` 的每 Run 独立目录，分别持久化 Run 元数据、Issue JSONL、Log JSONL 和按 Issue 保存的 Response Markdown。历史由 Run 目录生成，不复用 legacy session index。

旧 sessions、chunks、products、adjudication、technical brief 与 modules 文件不迁移、不自动删除，新页面和新 API 忽略它们。

## 删除的旧领域与 UI

全面移除 Admission Dimension、Admission Verdict、Pending Adjudication、三分桶、Product 编辑、多会话及 angle、Technical Brief、Aggregate Module、固定双 turn 和 interject。对应的 `admission-*`、`session-*`、`product-*` 组件、类型、testid、API 语义与文案改为 `analysis-*`、`analysis-run-*`、`analysis-skill-*`。

主区继续保留文档阅读器，以及 Analysis Issue 与 Issue Response 的来源联动。CLARIFYING 暂时保留，但不再依赖 `modules.yaml`；其新输入与职责另行设计。

## 被替代的既有决策

本 ADR 完整替代 ADR-0013 中 ANALYZING 的准入维度、待裁决、多会话、技术概要、聚合模块与重扫模型；部分替代 ADR-0017 的三分桶、synthetic Product 与 chunk 真相源，保留文档阅读器和来源联动原则；部分替代 ADR-0020 的双 turn 与旧 Skill 装配，保留通过 Claude Agent SDK 真正执行分析的方向。

## 主要取舍

- 选择受控逐条报告工具，而不是最终大 JSON 或 NDJSON，以支持实时、可校验且失败后仍保留部分结果。
- 选择单 Run 单 Skill，而不是多 Skill 或固定双 turn，以避免指令冲突和重复产物。
- 选择保存用户答复原文而不自动总结，以维持需求事实准确性；代价是上下文超限时必须阻止启动。
- 选择不保存 Skill 快照，只记录 Skill 名称并在每次启动时读取最新内容；代价是历史 Run 无法还原当时实际使用的 Skill 版本。
- 选择实时读取当前文件且不保存证据摘录；代价是历史 SourceRef 可能漂移。
- 选择完整持久化工具日志但排除 system prompt；代价是日志体积与脱敏责任增加。
