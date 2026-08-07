# 07 — Web 看板页 + Card 形态

**What to build:** board 5 列看板端到端:从用户在 Requirement 内打开 board,看到 cards 渲染(中等密度 112-120px 图 1 形态),到能新建 manual 卡,完成首次端到端 UX。

**Blocked by:** 02 — Agent TaskCardStore,06 — Web zones 退役

**Status:** ready-for-agent → done(2026-08-07)

- [x] 路由 `/requirements/[id]/board/` + 组件 `<BoardSection>` 全屏
- [x] 5 列水平网格(响应式占位),列颜色按方案 A:`backlog #94a3b8` / `todo #cbd5e1 空心` / `in_progress #f59e0b` / `in_review #16a34a` / `done #3b82f6`
- [x] 列头部:N 计数 + 名称 + `+` 按钮
- [x] 卡片 component `<Card>`(中等密度 112-120px):短 ID(MUL-NN,ULID 末 4)+ title(2 行)+ summary(2 行)+ 底部 meta 行(priority badge + assignee 头像/source 小标/labels chip)
- [x] toolbar(Linear 多段):左 `[REF-XX Board ▾]` 视图切换 + 中过滤 chips(全部 / 我的 / 高优先级 / PRD 拆)+ 右 `[+ 新任务]` + `[+ 从 PRD 拆]` 双按钮(后者本期灰,留 ticket 08 实现触发)
- [x] SSR 数据加载 + react-query 客户端缓存(`['board', reqId, ...filters]`)
- [x] 列表过滤时 N 计数实时更新
- [x] e2e(playwright)`board.spec.ts`:创建 Requirement → 切 board → 创建 manual 卡 → 5 列看板显示该卡(已写,需活服跑)
- [x] 视觉对照:严格对照 `docs/design/pages/board-color-options.html` 行布局与色(token)
- [x] 优先级 badge / 头像 / source / labels 颜色 token 沿用决策 22 体系
- [x] 静态检查:`pnpm typecheck` GREEN / `pnpm lint` GREEN(web src;scripts 包预存 error 与本期无关)
- [x] **守门保留**:ClaudeCodeProvider 不动 / mcpCallCounter 不动

## Comments

### 2026-08-07 实施完成

落地清单:
- 新增 `apps/web/src/lib/{board,board-hooks,board.server}.ts`
- 新增 `apps/web/src/components/board/{Card,Column,BoardToolbar,NewTaskModal,BoardSection}.tsx`
- 改造 `apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx`(board 占位分支 → 真实 `<BoardSection>`)
- 新增测试 `apps/web/src/__tests__/{lib/board.test.ts,board/*.test.tsx}`(97 tests 全 GREEN)
- 新增 e2e `apps/web/e2e/board.spec.ts`(沿用 analyzing-real-run 的 skip 门槛)

范围确认(用户决策):
- `[+ 从 PRD 拆]` 按钮 = 灰显 disabled + tooltip「即将上线」(留 ticket 08)
- 卡片详情页 `/board/[cardId]/` = 不落(留 ticket 08,ADR-0027 D5 toggle 双态)
- 守门 `analysis-run-mcp-e2e.test.ts` 不动(zero-touch,e2e 走 manual 卡不发 Run)

验证:typecheck GREEN / web eslint src GREEN / vitest 1063 tests 全 GREEN / e2e 需活服跑。
