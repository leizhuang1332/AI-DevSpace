# 09 — 真实 Agent SDK 验证与规格收口

**What to build:** 使用真实 Claude Agent SDK 验证从选择 Analysis Skill、启动 Run、实时接收 Issue、填写 Response、再次分析到历史回看的完整用户流程，并确认旧数据隔离、安全边界和失败语义在真实运行中成立。

**Blocked by:** 08 — 旧 ANALYZING 契约收缩

**Status:** ready-for-agent

- [ ] 改写现有 opt-in ANALYZING 真实运行 E2E，使其使用默认 Analysis Skill 和新的 Run/Issue/Response 契约。
- [ ] 真实 Run 使用自定义 system prompt 完全替换 Claude Code 默认 prompt。
- [ ] 真实模型只能使用 Read、Glob、Grep、`report_analysis_issue` 和 `complete_analysis`。
- [ ] E2E 接受至少一条 Issue 或合法的“成功 · 0 个问题”终态。
- [ ] Issue 和 Run Log 通过真实 SSE 到达页面，并与持久化结果一致。
- [ ] 填写 Response 后再次启动会创建新 Run，并把已答复原文加入本次上下文。
- [ ] 未答复 Issue 和 Run Log 不进入新 Run 上下文。
- [ ] 历史切换后，真实终态事件不会抢回用户焦点。
- [ ] 预置旧 ANALYZING 文件后，新页面和上下文不读取它们，原文件保持不变。
- [ ] 真运行验证包含失败后的部分 Issue 和日志保留物证，或使用等价的可控集成场景补足不可稳定触发的故障。
- [ ] 完整 typecheck、测试套件和端到端验证通过；真实模型测试在缺少凭据时明确跳过。
- [ ] 对照 PRD、ADR-0021 和 CONTEXT.md 做最终验收，修正文档与实际契约之间的非领域性偏差。
