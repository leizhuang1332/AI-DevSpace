# 07 — FAB N 计数规则(0 灰 / 99+ / 不显示运行中 dot) + N=0 空态 CTA

**What to build:** 明确 FAB 数字呈现的三条规则(N=0 灰色 / N>99 显示 99+ / 运行中不显示 dot),并补齐 N=0 空态的 CTA「▶ 开始分析」,引导用户发起首次 Analysis Run。CTA 行为等价于主区「▶ 开始分析」按钮(同一 `handleStart` 入口)。

**Blocked by:** 01(注:本 ticket 部分细节依赖 02 — 「面板头部 N 计数实时跟随」与 ticket 02 的列表渲染联合验证;但 FAB 数字规则本身与列表无关,可独立落地测试)

**Status:** ready-for-agent

- [ ] FAB N 计数规则 N=0:N 数字呈灰色(`text-text-3`),FAB 本身不隐藏(避免遗忘入口存在)
- [ ] FAB N 计数规则 N=99:正常显示 `99`
- [ ] FAB N 计数规则 N=100+ → N=999:显示 `99+`(Gmail 范式,不截断,不撑爆宽度)
- [ ] FAB 不显示运行中 dot:FAB 节点内无 `data-testid="history-fab-running-dot"` 元素
- [ ] 运行中状态走底部 AI 思考条 4 指示器(决策 49 / 91),FAB 不重复信号
- [ ] N=0 面板空态文案:「暂无历史 Analysis Run · 点击下方 [▶ 开始分析] 按钮发起首次分析」
- [ ] N=0 空态 CTA 按钮:显示「▶ 开始分析」,点击 → 触发主区 `handleStart`(沿用既有 `StartAnalysisButton` 的 onClick,等价于主区按钮)
- [ ] N=0 CTA 点击后:面板保持打开,Analysis Skill 选择面板 / 开始按钮反馈由主区接管(不重复 toast)
- [ ] 面板头部 N 计数实时跟随:删除 Run 后 N-1、新 Run 启动后 N+1、初始 SSR 数据 N 与 FAB 同步
- [ ] 沿用 `<AnalyzingZone>` 顶层 seam 加新 describe 块,覆盖:
  - N=0 FAB 数字灰色(FAB 仍渲染,DOM 内可见)
  - N=100 FAB 数字显示 `99+`
  - FAB 内无运行中 dot 元素
  - N=0 面板空态文案 + CTA 按钮可点击 → handleStart 被调
- [ ] 沿用既有「▶ 开始分析」按钮的 data-testid `analysis-run-start-btn`,CTA 测试断言 `state` 由 'idle' → 'starting' → 'running'