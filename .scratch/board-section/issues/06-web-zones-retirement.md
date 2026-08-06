# 06 — Web zones 注册表退役 + 3 工位退役

**What to build:** 整套 zones 注册表(JS 数组 + YAML + 服务端 registry)退场;3 工位路由 / 组件 / 数据加载物理删除;4 section 改为 hardcode 枚举;为后续 board 落地铺路。

**Blocked by:** 01 — Shared TaskCard schema

**Status:** ready-for-agent

- [ ] 新建 `sections.ts`:REQUIREMENT_SECTIONS = `['drafting', 'board', 'analyzing', 'wrapup']`,SECTION_META(7 字段 hardcode)
- [ ] 删除 `ZoneRegistry.ts` 与 `ZONE_META` 数组,标识 `@deprecated` 一周后再物理删除
- [ ] `packages/shared/src/zones.ts` 加 `@deprecated`(不删,等所有消费方迁移完再删)
- [ ] `apps/web/src/components/zone-bar.tsx`:6 Tab → 4 Tab(增加 Board Tab)
- [ ] `apps/web/src/components/command-palette.tsx`:工位搜索关键词 6 → 4
- [ ] 物理删除 3 工位路由 `apps/web/src/app/(workspace)/requirements/[id]/[zone]/{clarifying,designing,executing}/`
- [ ] 物理删除 3 zone 组件 `clarifying-zone.tsx`、`designing-zone.tsx`、`executing-zone.tsx`
- [ ] 物理删除 5 数据加载文件:`clarifying.ts / designing.ts / designing.server.ts / executing.ts / useExecutingSse.ts`
- [ ] 物理删除对应测试批次(`clarifying-zone.test.tsx` 等)
- [ ] `parseRequirementZonePath` 改 4-case
- [ ] agent startup 加 idempotent 清理:`if exists ~/.aidevspace/zones/*.yaml then delete`(老用户升级时一次性迁移)
- [ ] CONTEXT.md cross-ref 提及 ADR-0026 / ADR-0027(已在 v1.0.6 注明,本 ticket 验证)
- [ ] `git grep -n 'clarifying|designing|executing' -- apps/web apps/agent` **仅命中注释 / ADR cross-ref / 决策表**(本 ticket 做完应有 0 业务命中)
- [ ] `pnpm typecheck` 全包 GREEN
- [ ] e2e 现有页面(dashboard / requirements list / drafting / analyzing / wrapup)不挂(URL 形态不变,只是少 3 个)
