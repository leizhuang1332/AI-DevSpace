# 05 — 历史抽屉、焦点规则与永久删除

**What to build:** 让用户通过历史分析侧边抽屉切换、答复和删除 Analysis Run，同时始终理解哪个 Run 最新、哪个 Run 当前选中，以及删除会怎样影响后续分析上下文。

**Blocked by:** 04 — Issue Response 与下一次分析闭环

**Status:** ready-for-agent

- [ ] 历史列表从新的 Analysis Run 聚合生成，不读取或复用旧 Session index。
- [ ] Run 按创建时间倒序展示，页面首次进入默认选中最新 Run。
- [ ] 历史行显示开始时间、Skill 名称、执行状态和 Issue 数量。
- [ ] 历史使用“历史分析 N”侧边抽屉，不重新创建横向 Session Tab。
- [ ] 开始新 Run 时自动选中新 Run。
- [ ] Run 运行期间用户可以切换到任意历史 Run 并编辑 Response。
- [ ] 用户手动切换后，新 Run 的成功或失败事件不会抢回焦点。
- [ ] SSE 仍持续更新未选中 Run 的状态、Issue 和日志。
- [ ] 运行中的 Run 不提供删除入口，服务端也拒绝删除。
- [ ] 终态 Run 删除前显示二次确认，并明确 Issue、Response、Log 和后续上下文影响。
- [ ] 确认删除会级联永久删除 Run、Issue、Response 和 Log。
- [ ] 删除当前 Run 后选中最新剩余 Run；删除最后一个 Run 后恢复合法空态。
- [ ] 被删除 Run 的 Response 不再进入任何后续 Analysis Run。
- [ ] 测试覆盖历史切换、焦点不抢占、运行中删除拒绝、级联删除和删除后的上下文重组。
