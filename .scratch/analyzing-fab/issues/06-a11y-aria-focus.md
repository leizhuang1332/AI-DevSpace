# 06 — a11y 全套(ARIA 属性 + Tab 焦点自由 + aria-current)

**What to build:** 把 ticket 01 已落地的 ARIA 基础(`aria-expanded` / `role="region"`)扩展为完整 a11y 套件:FAB `aria-haspopup`、面板 `aria-label`、当前 Run 行 `aria-current`、删除按钮 / 锁图标 `aria-label`、Tab 焦点可在面板与主区之间自由切换(non-modal popover 语义)。

**Blocked by:** 01(注:本 ticket 不依赖 02 — 即便 Run 列表尚未渲染,a11y 属性本身可独立加在 FAB / 面板 / 删除按钮 / 锁图标的 DOM 节点上;但 02 落地后能补全 `aria-current` 的真实联动,本 ticket 配合 02 写测试断言)

**Status:** ready-for-agent

- [ ] FAB `aria-haspopup="region"`(指向面板的 role)
- [ ] 面板 `aria-label="历史分析列表"`(中文文案,屏幕阅读器朗读清晰)
- [ ] 当前选中 Run 行 `aria-current="true"`(由 ticket 02 联动,本 ticket 负责断言)
- [ ] 删除按钮 `aria-label="删除 Run <run_id> <skill_name>"`(具体到 Run 实例)
- [ ] 运行中 Run 锁图标 `aria-label="运行中的 Run 不可删除"`
- [ ] 头部 ✕ 按钮 `aria-label="关闭历史分析列表"`
- [ ] 面板非 `role="dialog"`(明确决策:不暗示模态,不困焦点)
- [ ] Tab 焦点自由:面板内可 Tab 切换 Run 行 / 删除按钮 / ✕,然后继续 Tab 到主区(文档阅读器 / 识别产物列);Shift+Tab 反向同理;Esc 不作为 Tab 路径一部分,只关闭面板
- [ ] 不引入 focus-trap 库:沿用浏览器原生 Tab 顺序即可
- [ ] dim 蒙层加 `aria-hidden="true"`(避免屏幕阅读器误读蒙层为可交互元素)
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖:
  - FAB 完整 ARIA 属性组(aria-label / aria-expanded / aria-haspopup)
  - 面板 role + aria-label
  - 当前 Run 行 aria-current 同步
  - 删除按钮 / 锁图标的 aria-label 包含具体 Run 标识
- [ ] 沿用既有 `data-testid` 命名约定,在测试断言里用 `toHaveAttribute('aria-*', '...')` 形式