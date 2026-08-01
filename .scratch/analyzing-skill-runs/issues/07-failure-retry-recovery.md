# 07 — 失败、重试与进程恢复

**What to build:** 让 Analysis Run 在网络错误、SDK 错误、协议错误、持久化错误或 Agent 重启后进入可信终态，保留已经完成的工作，并释放 Requirement 的单运行锁。

**Blocked by:** 03 — Analysis Issue 逐条报告与来源联动；06 — 持久化 Analysis Run Log

**Status:** ready-for-agent

- [ ] 临时网络和限流错误在同一 Run 内自动重试，不创建新的历史项。
- [ ] 自动重试保持 Run 标识，并依赖工具调用标识避免重复 Issue。
- [ ] SDK error、timeout、进程中断和不可恢复 Provider 错误使 Run 进入 `failed`。
- [ ] SDK 未调用 `complete_analysis` 就正常结束时，Run 进入明确的协议失败。
- [ ] `complete_analysis` 被接受后，任何新的 Issue 提交都会被拒绝并记录协议错误。
- [ ] SDK 返回成功但仍有未决工具调用或数据未全部持久化时，Run 不得进入成功。
- [ ] 失败 Run 保留错误原因、已经持久化的部分 Issue、Issue Response 和 Run Log。
- [ ] 失败终态释放同 Requirement 的单运行锁，用户可以创建新 Run。
- [ ] 终态失败后再次开始始终创建新 Run，不恢复、不续跑旧 Run。
- [ ] Agent 启动或历史读取时发现没有活跃执行上下文的 `running` Run，会将其收敛为带中断原因的 `failed`。
- [ ] 成功和失败 SSE 终态互斥，且相同终态重放不会重复改变数据。
- [ ] 本 Ticket 不增加取消、暂停、恢复或续跑入口。
- [ ] 集成测试覆盖提交部分 Issue 后失败、完成工具缺失、完成后继续报告、持久化失败、自动重试与 Agent 重启恢复。
