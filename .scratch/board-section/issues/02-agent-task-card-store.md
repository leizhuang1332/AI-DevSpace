# 02 — Agent TaskCardStore + 读 API

**What to build:** TaskCard 持久化服务 + REST 读 API,从"系统能写入并读取 TaskCard"开始,搭起后续 web 端的数据访问层。

**Blocked by:** 01 — Shared TaskCard schema

**Status:** ready-for-agent

- [ ] TaskCardStore 实现 list / create / get / update / archive,持久化落到 `~/.aidevspace/requirements/<id>/board/tasks/<ulid>.json`,目录即真相(沿用决策 2)
- [ ] GET 列表支持过滤:priority / label / source / status
- [ ] POST 创建 manual 卡(`source='manual'`,`parent_id=Requirement.id`)
- [ ] PATCH 字段白名单:id / parent_id / status / title / content / priority / assignee / labels / depends_on / order_index / source / is_archived(`updated_at` 自动改写)
- [ ] POST archive(软删 `is_archived=true`)
- [ ] Fastify 路由 4 条:
  - `GET /api/requirement/:id/board/cards`(列表)
  - `GET /api/requirement/:id/board/cards/:cardId`(单卡)
  - `POST /api/requirement/:id/board/cards`(manual 创建)
  - `PATCH /api/requirement/:id/board/cards/:cardId`(改字段)
  - `POST /api/requirement/:id/board/cards/:cardId/archive`(软删)
- [ ] 错误返回:{error, reason} 形态,400 / 404 / 500 区分
- [ ] 单元测试:CRUD round-trip + 列表过滤 + 软删 + 错误分支(空 id / 缺字段)
- [ ] **守门保留:ClaudeCodeProvider / runAnalysisQuery / createSdkMcpServer / mcpCallCounter 不动**(本 ticket 不发 Run)
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
- [ ] `pnpm typecheck` 全包 GREEN
