# 04 — Issue Response 与下一次分析闭环

**What to build:** 让用户针对任意历史 Analysis Issue 填写回答、解释和补充，并保证下一次 Analysis Run 原文读取全部历史已答复上下文，从而避免重复提出已经解决的问题。

**Blocked by:** 03 — Analysis Issue 逐条报告与来源联动

**Status:** ready-for-agent

- [ ] 每条 Issue 最多关联一份 Markdown Issue Response，Response 与原始 Issue 分离保存。
- [ ] 用户不能通过 Response 编辑或覆盖原始 Issue。
- [ ] 任意未删除历史 Run 的 Issue 都可新增或编辑 Response。
- [ ] Response 正文 trim 后非空即视为已答复，不出现草稿、确认、Verdict 或裁决状态。
- [ ] 编辑器显示输入中、保存中、已保存和保存失败状态。
- [ ] 自动保存支持防抖，失焦、历史切换和开始分析时会立即 flush。
- [ ] 并发保存使用单调编辑版本，较晚返回的旧请求不会覆盖更新正文。
- [ ] 开始分析前等待全部最新 Response 持久化成功；任一失败都会阻止启动并允许重试。
- [ ] 服务端启动时重新读取当前已持久化 Response，而不信任浏览器内存草稿。
- [ ] 新 Run 只注入未删除历史 Run 中已有 Response 的 Issue 与 Response 原文。
- [ ] 未答复 Issue、Run Log 和旧 ANALYZING 产物不进入 prompt。
- [ ] 答复按更新时间稳定排序，Prompt 明确较新事实优先。
- [ ] 已充分解决的问题默认不重报；答复不足、矛盾或与当前内容冲突时允许关联重报。
- [ ] 全部已答复原文超过上下文预算时明确阻止启动，不截断、不总结、不只取最近记录。
- [ ] 集成测试从保存历史 Response 贯通到下一 Run 捕获到的组装上下文。
