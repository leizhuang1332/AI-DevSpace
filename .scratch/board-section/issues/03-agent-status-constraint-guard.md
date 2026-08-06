# 03 — Agent StatusConstraintGuard + Override

**What to build:** 父子 Requirement.status ↔ TaskCard.status 软约束校验;override 写 audit log;实现 ADR-0025 决策。

**Blocked by:** 01 — Shared TaskCard schema

**Status:** ready-for-agent

- [ ] StatusConstraintGuard 实现 3 条规则:
  - 父切 `implementing` 需子无 `backlog`
  - 父切 `submitting` 需子无 `in_progress`
  - 父切 `done` 需所有非 archived 子 = `done`
- [ ] 反向不约束:子全部 done 不自动切父 done(只通过 SSE / UI 提示)
- [ ] OverrideLog:append-only 文件 `~/.aidevspace/requirements/<id>/board/overrides.log`,记录 parent_status / card_id / ts / kind
- [ ] PATCH `/api/requirement/:id/board/cards/:cardId/status` 走 Guard,违规返回 `{ok:false, conflicts:[cardId...]}` 让 web 弹 Modal
- [ ] 约束校验用 TaskCardStore.list(过滤非 archived)实现,不直读文件系统
- [ ] 单测覆盖 3 条规则 + override 路径 + 反向不写父
- [ ] **守门保留**:本 ticket 不调 Provider / Run
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
