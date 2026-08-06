# 01 — Shared TaskCard schema + Zod 校验

**What to build:** TaskCard 数据基线(13 字段 type + Zod schema + 枚举 + cross-validation),让 web / agent 后续 ticket 拿到一致的契约。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] TaskCard interface / type 定义 13 字段:id (ULID)、parent_id、status (5 态)、title、content、priority、assignee、labels、depends_on、order_index、source (3 枚举)、is_archived、created_at、updated_at、completed_at
- [ ] Zod schema TaskCardSchema 编译通过,反例(缺必填 / 错 status / 错 source / 错 priority)报错且字段级报错
- [ ] 5 态 status 枚举 + 3 来源 source 枚举 + 4 档 priority 枚举完整定义
- [ ] 8 项冷字段(可选)Zod 默认值[]/null 处理正确
- [ ] shared 包 export `TaskCard`、`TaskCardSchema`、枚举 type;`packages/shared/src/index.ts` 添加 `export * from './task-card'`
- [ ] TypeScript 单测覆盖:正例(完整字段)成功校验;反例(必填缺、枚举非法、ULID 长度错、Markdown content 含危险脚本)失败校验
- [ ] `pnpm --filter @ai-devspace/shared typecheck` GREEN
- [ ] `pnpm --filter @ai-devspace/shared test` GREEN
