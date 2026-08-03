# 05 — 切上下文强制收起(切需求 / 切工位 / 启动新 Run)

**What to build:** 让 FAB 面板开合 state 严格遵循「不持久化」语义:切需求 / 切工位 / 启动新 Run 时面板强制收起,回到 ANALYZING 时 FAB 默认折叠。避免上下文混乱与「新 Run focus 抢戏」。决策 24「克制,在场」的「克制」语义在本 ticket 落地。

**Blocked by:** 01(注:本 ticket 不依赖 02-04 — state 重置逻辑独立于面板内容与 Cmd+K 命令)

**Status:** ready-for-agent

- [ ] FAB 面板开合 state 不写入 cookie / localStorage / sessionStorage(完全不持久化)
- [ ] 切到其他 Requirement(`AnalyzingZone` 父组件因 key/路由变化 unmount → remount)→ 新 mount 的 FAB 默认折叠
- [ ] 切到其他工位(从 `/requirements/<id>/analyzing/` 离开 → 回来)→ FAB 默认折叠,沿用 unmount → remount 机制
- [ ] 启动新 Analysis Run(`handleStart` 成功路径)→ FAB 面板强制收起(`setPanelOpen(false)`),且焦点切到新 Run(沿用既有 `userManuallySwitchedRef = false` 重置)
- [ ] 启动新 Run 失败的 toast 提示不影响 FAB 面板开合(若面板已开,失败后面板仍开;若面板已关,保持关)
- [ ] 不引入新的 React state 库:沿用 `useState<boolean>(false)` 即可
- [ ] 不在父组件 `AnalyzingZone` 之上加 wrapper;state 留在 `AnalyzingZone` 内,unmount 即重置
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖三种收起触发:
  - 切需求(重新 render with 不同 `data.requirementId`)→ FAB 默认折叠
  - 启动新 Run(`handleStart` 成功路径)→ FAB 收起 + 焦点切新 Run
  - 启动新 Run 失败 → FAB 开合不受影响(只弹 toast)
- [ ] 测试断言:`data-testid="history-fab"` 上 `aria-expanded="false"`(默认)且 DOM 内无 `data-testid="history-panel"`