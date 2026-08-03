# 02 — 面板内 Run 列表复用 + 选 Run 切 currentRun + 自动关闭

**What to build:** 在 ticket 01 的空态面板骨架上,把 `<AnalysisHistoryDrawer>` 已落地的 `HistoryRow` 渲染逻辑搬进 `<HistoryPanel>`,让面板能列出所有 Analysis Run;点 Run 行 → 切到该 Run + 面板自动关闭(符合 Linear popover 心智「选中即走」)。

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] 面板内渲染 Run 列表(按 created_at 倒序,父组件 `AnalyzingZone` 已排好,面板不再排序)
- [ ] 每行复用 `<AnalysisHistoryDrawer>` 已落地的 `HistoryRow` 渲染逻辑(不重写,不引入双份维护)
- [ ] 每行包含:状态 dot / 开始时间 / Skill 名 / Skill 简介 / Issue 计数 / 删除按钮(运行中 Run 显示 🔒,终态 Run 显示 🗑️)
- [ ] 当前选中 Run 行背景高亮(`bg-brand-50/40`),通过 `aria-current="true"` 同步屏幕阅读器
- [ ] 面板头部标题实时显示 `🗂️ 历史分析 N`,N 跟随 Run 总数
- [ ] 超出可用高度时面板内部滚动,头部固定不滚
- [ ] 点 Run 行 → 触发父组件 `AnalyzingZone` 的「切 Run」回调 → currentRun 切到该 Run + 面板关闭(从 FAB `aria-expanded="false"` 同步可见)
- [ ] 选中后父组件 `AnalyzingZone` 的识别产物列换该 Run 的 Analysis Issue 内容(SSE 已收敛的 Issue + Response 联动由既有契约处理,本 ticket 不动)
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖:列表渲染 / 行内容字段 / 点选切 Run / 面板关闭 / aria-current 同步 / 头部 N 计数实时
- [ ] 沿用既有 `AnalysisHistoryDrawer` 的 `HistoryRow` data-testid 命名(`analysis-history-row` / `analysis-history-row-select` / `analysis-history-row-delete` 等),新测试断言不重复发明轮子