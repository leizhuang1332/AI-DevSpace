# 01 — FAB + 浮动面板最小可演示骨架

**What to build:** 把 ANALYZING 工位历史列表从「永久 320px 抽屉」改为「默认折叠的浮动召唤按钮(FAB)+ 浮动面板」。本 ticket 落地最窄可演示骨架:FAB 默认折叠渲染、点 FAB 打开空态面板、点 ✕ / 点外面 / Esc 三种关闭方式都能关、ARIA 基础(`aria-expanded` / `role="region"`)同步。同时删除原 `analyzing-history-col` 永久列与窄视口 `max-h-[200px]` 折叠条 div。

后续 ticket(02-08)在此骨架上叠加 Run 列表 / 删除 UX / Cmd+K / 切上下文收起 / a11y 全套 / N 计数规则 / 响应式。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 主区右上角渲染 FAB(默认折叠),显示 `🗂️ 历史分析 0`,N=0 时数字呈灰色
- [ ] FAB 不显示运行中 dot,仅显示 N 计数
- [ ] 点 FAB 后面板从 FAB 正下方弹出,默认覆盖在 [识别产物] 列之上(不挤压列宽)
- [ ] 面板头部固定显示「🗂️ 历史分析 0 ✕」,头部右侧 ✕ 按钮可点击
- [ ] N=0 空态:面板内显示「暂无历史 Analysis Run」文案
- [ ] 关闭方式一:点面板头部 ✕ 按钮关闭面板
- [ ] 关闭方式二:点 FAB 面板以外的任意位置关闭面板
- [ ] 关闭方式三:按 Esc 关闭面板
- [ ] FAB `aria-expanded` 同步 false/true,跟随面板开合
- [ ] FAB `aria-label="历史分析 共 N 个 Run"`
- [ ] 面板 `role="region"` `aria-label="历史分析列表"`(不是 `role="dialog"`,不暗示模态)
- [ ] FAB z-index 30,面板 z-index 40(命名由 tailwind config 提供,不散落魔数)
- [ ] 删除 desktop 布局里的 `analyzing-history-col` 永久列 div
- [ ] 删除窄视口布局里的 `max-h-[200px]` 折叠条 div(`analyzing-narrow-history`)
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖:FAB 默认渲染 / N=0 灰色 / 三种关闭 / aria-expanded 同步 / aria-label 含 N
- [ ] 沿用 `<CommandPalette>` 顶层 seam 不动(本 ticket 不碰 Cmd+K)
- [ ] 沿用 `<AnalysisHistoryDrawer>` 组件本体保留不重写(后续 ticket 02 复用其 `HistoryRow`)