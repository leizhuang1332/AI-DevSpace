# 02 — 最小 Analysis Run 成功链路

**What to build:** 让用户选择 Analysis Skill 后点击“开始分析”，创建一个独立 Analysis Run，使用完全覆盖后的 system prompt 启动一次 Agent SDK query，并在没有识别出 Issue 时正常完成和展示合法零问题结果。

**Blocked by:** 01 — Analysis Skill 目录与选择器

**Status:** ready-for-agent

- [ ] Run 只记录所选 Analysis Skill 名称，启动时读取同名 Skill 当前最新内容，不保存版本、哈希、正文或 prompt 快照。
- [ ] 只有 PRD 非空、Skill 有效且同 Requirement 没有运行中 Run 时才能启动。
- [ ] 快速连点只创建一个 Run；不同浏览器标签并发启动时，服务端原子拒绝第二个请求。
- [ ] 启动成功后立即返回 Run 标识、Skill 名称、创建时间和 `running` 状态，并在页面显示新 Run。
- [ ] 开始新 Run 时页面自动选中它。
- [ ] Agent SDK 使用自定义 system prompt 完全替换 Claude Code 默认 prompt，不使用 append 或 Claude Code preset。
- [ ] System prompt 包含已决策的九层结构，并把 Skill、Issue Response 和 Workspace 内容置于正确权限层级。
- [ ] 每个 Run 只创建一次 Agent SDK query；不再执行固定 admission-check/requirement-brainstorm 双 turn。
- [ ] `complete_analysis` 不接受业务参数。
- [ ] 只有完成工具已接受、SDK 正常结束、无未决工具调用且持久化完成时，Run 才进入 `succeeded`。
- [ ] 成功且零 Issue 显示为“本次 Skill 未识别出问题”，不显示业务 Verdict。
- [ ] 主要集成测试贯通启动 REST、fake Agent SDK、真实 Run 存储、真实 SSE Hub 和页面状态。
