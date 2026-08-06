# 07 — Web 看板页 + Card 形态

**What to build:** board 5 列看板端到端:从用户在 Requirement 内打开 board,看到 cards 渲染(中等密度 112-120px 图 1 形态),到能新建 manual 卡,完成首次端到端 UX。

**Blocked by:** 02 — Agent TaskCardStore,06 — Web zones 退役

**Status:** ready-for-agent

- [ ] 路由 `/requirements/[id]/board/` + 组件 `<BoardSection>` 全屏
- [ ] 5 列水平网格(响应式占位),列颜色按方案 A:`backlog #94a3b8` / `todo #cbd5e1 空心` / `in_progress #f59e0b` / `in_review #16a34a` / `done #3b82f6`
- [ ] 列头部:N 计数 + 名称 + `+` 按钮
- [ ] 卡片 component `<Card>`(中等密度 112-120px):短 ID(MUL-NN,ULID 末 4)+ title(2 行)+ summary(2 行)+ 底部 meta 行(priority badge + assignee 头像/source 小标/labels chip)
- [ ] toolbar(Linear 多段):左 `[REF-XX Board ▾]` 视图切换 + 中过滤 chips(全部 / 我的 / 高优先级 / PRD 拆)+ 右 `[+ 新任务]` + `[+ 从 PRD 拆]` 双按钮(后者本期可灰,留 ticket 08 实现触发)
- [ ] SSR 数据加载 + react-query 客户端缓存(`['board', reqId, ...filters]`)
- [ ] 列表过滤时 N 计数实时更新
- [ ] e2e(playwright)`board.spec.ts`:创建 Requirement → 切 board → 创建 manual 卡 → 5 列看板显示该卡
- [ ] 视觉对照:严格对照 `docs/design/pages/board-color-options.html` 行布局与色(token)
- [ ] 优先级 badge / 头像 / source / labels 颜色 token 沿用决策 22 体系
- [ ] 静态检查:`pnpm typecheck` GREEN / `pnpm lint` GREEN
- [ ] **守门保留**:ClaudeCodeProvider 不动 / mcpCallCounter 不动
