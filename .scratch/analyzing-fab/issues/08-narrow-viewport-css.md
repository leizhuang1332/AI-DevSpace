# 08 — 窄视口 CSS 自适应 + 删除旧 max-h-[200px] 折叠条

**What to build:** 让 FAB + 面板在窄视口(< 1024px)下天然兼容:宽度自适应、高度跟随主区、不溢出视口。彻底删除 ticket 01 已删除 `analyzing-history-col` 后的剩余 `max-h-[200px]` 折叠条逻辑。同时建立 z-index 命名约定(`z-fab` / `z-panel`),避免散落魔数。

**Blocked by:** 01(注:本 ticket 不依赖 02-07 — CSS 自适应与 z-index 命名属于 styling 层,与其他 ticket 行为正交;但部分验证依赖 02-07 已渲染的列表)

**Status:** ready-for-agent

- [ ] FAB 在窄视口(< 1024px)仍渲染,不因视口窄而隐藏(沿用 ticket 01 的「FAB 始终可见」语义)
- [ ] 面板宽度 = `min(320px, calc(100vw - 24px))`,窄视口下不溢出视口右边
- [ ] 面板高度自适应主区高度(主区 `flex-1` 提供基线),上限不超过 AI 思考条之上
- [ ] 面板内部滚动:Run 列表超出可用高度时列表内滚,头部固定不滚(由 ticket 02 联合验证)
- [ ] z-index 命名约定建立:
  - `z-fab` = 30(FAB)
  - `z-panel` = 40(浮动面板)
  - `z-overlay` = 50(Cmd+K overlay,沿用既有约定)
  - `z-modal` = 60(删除二次确认对话框,沿用既有约定)
  - 在 `tailwind.config.ts` 内 `extend.zIndex` 声明命名,不散落魔数
- [ ] 删除窄视口布局里的 `max-h-[200px]` 折叠条 div(`analyzing-narrow-history`),整段 div 与其 wrapper 一并清掉
- [ ] 桌面布局 `analyzing-history-col` 永久列已在 ticket 01 删除;本 ticket 确认无遗留 CSS 类 / data-testid 引用
- [ ] 不引入新的 CSS-in-JS 库或 CSS Module;沿用项目 Tailwind + 设计 token 约定
- [ ] 不引入 `useMediaQuery` 新增断点查询;沿用既有 `(min-width: 1024px)` 约定
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖:
  - 窄视口(< 1024px)FAB 仍渲染
  - 面板宽度通过 `getComputedStyle` 或类名断言为 `min(320px, calc(100vw - 24px))`
  - 旧 `max-h-[200px]` 折叠条 div 已从 DOM 移除(`document.querySelector('[data-testid="analyzing-narrow-history"]')` 为 null)
  - z-index 命名约定生效(`getComputedStyle` 断言 FAB `z-index: 30`,面板 `z-index: 40`)
- [ ] 复用既有 `useMediaQuery` mock(在 `analyzing-zone-focus.test.tsx` 已使用),不引入新 mock