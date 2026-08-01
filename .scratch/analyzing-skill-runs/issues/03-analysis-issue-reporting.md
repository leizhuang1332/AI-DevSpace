# 03 — Analysis Issue 逐条报告与来源联动

**What to build:** 让 Analysis Assistant 通过受控工具逐条提交统一 Analysis Issue，平台实时校验、持久化和展示，并让用户从 Issue 定位到相关 Requirement 文档、AuxFile、Asset 或关联 Repository 内容。

**Blocked by:** 02 — 最小 Analysis Run 成功链路

**Status:** ready-for-agent

- [ ] 正式 Issue 只能通过 `report_analysis_issue` 提交，普通模型文本不能被解析为业务结果。
- [ ] 每次工具调用只提交一条 Issue，输入包含非空标题、问题描述、至少一个 SourceRef 和可选 metadata。
- [ ] Run 标识、Issue 标识、顺序和时间由平台生成，模型不能提供或覆盖。
- [ ] 同一工具调用重放不会重复生成 Issue；不同调用不按标题、来源或语义自动合并。
- [ ] SourceRef 使用逻辑根和相对路径；Repository 来源必须包含仓库名称。
- [ ] 能精确定位时使用既有零基半开行范围；缺失类问题可引用文件或章节而不伪造行号。
- [ ] metadata 仅接受已约定的 JSON 基础值或基础值数组，并以通用键值形式展示。
- [ ] metadata 不驱动排序、状态或 Verdict，也不能承载解决方案。
- [ ] Issue 通过服务端 Schema 并持久化后才发布 SSE 和确认工具调用。
- [ ] 流式半截参数、非法参数或持久化失败不会形成正式 Issue。
- [ ] 点击 SourceRef 能切换并定位文档阅读器中的来源。
- [ ] 来源文件、仓库或 Asset 已不存在时，Issue 显示引用缺失状态而不导致页面错误。
- [ ] 测试覆盖多 Issue、零 Issue、工具重放、非法输入、缺失类引用和来源漂移。
