# 01 — Analysis Skill 目录与选择器

**What to build:** 让用户在 ANALYZING 工位看到 Workspace 独立 Analysis Skill 集合中的名称与功能简介，单选本次分析规则，并按 Requirement 记住上次选择。系统提供两个可立即使用的默认 Skill，且不与现有全局、个人或项目 Skill 混合。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 首次初始化后可选择 `prd-completeness` 与 `implementation-readiness` 两个默认 Analysis Skill。
- [ ] 应用升级会用系统版本强制覆盖同名默认 Analysis Skill，其他名称保持不变。
- [ ] 只扫描 Workspace 的独立 Analysis Skill 集合，不纳入全局、个人或项目 Skill。
- [ ] 每个有效 Skill 都具有唯一名称、非空功能简介、语义版本和规则正文。
- [ ] Skill 列表接口与 Web 客户端均执行运行时 Schema 校验。
- [ ] 原 Admission Dimension 区域被 Analysis Skill 单选器替代，只展示名称、功能简介和选中状态。
- [ ] 首次使用稳定选择第一项，之后按 Requirement 恢复上次选择；已记住名称不存在时安全回退。
- [ ] 无有效 Skill 或存在非法 Skill 时，页面显示明确可理解的状态，不允许用非法 Skill 启动。
- [ ] 测试覆盖默认 Skill 初始化、升级覆盖、集合隔离、非法文件和选择持久化的用户可见行为。
