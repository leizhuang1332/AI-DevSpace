# 08 — 旧 ANALYZING 契约收缩

**What to build:** 在新 Analysis Skill、Analysis Run、Analysis Issue、Issue Response 和 Analysis Run Log 链路完整可用后，移除用户可达的旧 Admission、Session、Product、Pending Adjudication、Technical Brief 和固定双 turn 产品模型，使新链路成为 ANALYZING 的唯一契约。

**Blocked by:** 04 — Issue Response 与下一次分析闭环；05 — 历史抽屉、焦点规则与永久删除；06 — 持久化 Analysis Run Log；07 — 失败、重试与进程恢复

**Status:** ready-for-agent

- [ ] 删除 Admission Dimension、Admission Verdict 及其派生、组件、事件和测试。
- [ ] 删除 Pending Adjudication 读取、计数、StatusBar 入口、接受风险、应用裁决和重扫耦合。
- [ ] 删除 subproblem/risk/option 三分桶、Product 编辑和 Synthetic Product。
- [ ] 删除 AnalysisSession、angle、Session Tab、新建 Session 按钮和创建对话框。
- [ ] 删除 Technical Brief、Aggregate Module 及生成和重扫入口。
- [ ] 删除固定 admission-check/requirement-brainstorm 双 turn 和旧输出解析协议。
- [ ] 删除运行中 interject。
- [ ] 删除新运行路径对旧 chunk、Session index、adjudication、Technical Brief 和 Module 的读取依赖。
- [ ] 新组件、类型、事件、testid、错误码和文案全面使用 Analysis Skill、Analysis Run、Analysis Issue、Issue Response 和 Analysis Run Log 术语。
- [ ] 不保留 admission、session、product 或 tech-brief 的新旧兼容别名。
- [ ] 保留文档阅读器、SourceRef、SSE 和错误处理仍有效的行为与测试意图。
- [ ] 旧磁盘文件不迁移、不修改、不删除，但新页面、历史和上下文完全忽略。
- [ ] CLARIFYING 路由继续可进入，且不要求新 ANALYZING 生成 Module；不在本 Ticket 设计其未来领域模型。
- [ ] 删除只证明旧领域模型的测试后，完整测试与类型检查保持通过。
