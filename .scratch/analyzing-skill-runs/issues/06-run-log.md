# 06 — 持久化 Analysis Run Log

**What to build:** 让用户实时查看并回看 Analysis Assistant 的普通文本、工具活动和完整工具输入输出，同时保证日志不会暴露 system prompt、raw chain-of-thought 或凭据。

**Blocked by:** 03 — Analysis Issue 逐条报告与来源联动

**Status:** ready-for-agent

- [ ] 模型普通文本、工具调用和工具结果形成有序 Analysis Run Log。
- [ ] 工具输入输出在完成统一脱敏后持久化，并通过 SSE 发布同一份脱敏内容。
- [ ] system prompt 不进入 Run Log。
- [ ] thinking、raw chain-of-thought 和无法安全展示的内部消息不进入 Run Log。
- [ ] 脱敏至少覆盖授权头、API key、token、password、私钥和已知秘密内容。
- [ ] 日志脱敏发生在服务端写盘和 SSE 发布之前，不能依赖前端遮盖。
- [ ] 日志随 Run 持久化，刷新和切换历史后仍可完整回看。
- [ ] 运行中的日志面板默认展开，成功或失败后默认折叠。
- [ ] 用户可以手动展开或折叠当前及历史 Run Log。
- [ ] Run Log 不属于 Analysis Issue，不参与 Issue 数量，也不进入下一 Run 的需求上下文。
- [ ] 删除 Run 时日志随聚合级联删除。
- [ ] 测试向 fake Provider 注入普通文本、工具活动、秘密值、system prompt 和 thinking，验证存储、SSE 与 UI 边界。
