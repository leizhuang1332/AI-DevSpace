# 08 — Web 卡片详情页 + toggle + 全部 modal

**What to build:** 卡片详情页端到端 + 全部 modal 集成:用户进 `/board/[cardId]/` 看左主区(chips / content / 子任务 / 依赖 / 详细折叠);右栏 toggle(默认属性表 / 展开 AI 协作 transcript);三个 modal(互锁 / PRD 拆 / 新任务)接入。

**Blocked by:** 03 — Agent StatusConstraintGuard,04 — Agent TaskCardTranscript,07 — Web 看板页

**Status:** ready-for-agent → done(2026-08-07)

- [x] 路由 `/requirements/[id]/board/[cardId]/` + 组件 `<BoardCardDetailPage>`
- [x] 左主区 2/3:`<CardDetail>` 含 task-title row(id + title + archive/more)+ 顶部 6 chip(状态/优先级/来源/负责人/创建/更新)+ 父进度条 + Content Markdown + 子任务列表 + 依赖列表 + 「详细信息 ▾」折叠块(8 项冷字段)
- [x] 右栏 1/3 默认态:`<Side>` 含 `[💬 在对话中打开]` 按钮 + 属性表 8 项(status / priority / assignee / labels / 工作流 / 开发上下文 / 截止日期 / 重复)+ 关系区(阻塞于 / 阻塞 / 相关议题)+ 创建/更新时间
- [x] 右栏 1/3 展开态:`<CardTranscriptPanel>` 含 head(标题 + 物理独立 badge + `✕`)+ 消息流 + `<CardTranscriptInput>`(textarea + 📎 引用 Run + `⌘+↵` 发送)
- [x] toggle 行为(同 `board-detail-final.html` §3 inline snippet):右栏顶部按钮切换,**不持久化**(localStorage 不写)
- [x] `<StatusConstraintModal>` 三选项(强制切换 / 先调整子卡 / 取消),触发条件:status 切到 implementing / submitting / done 时 Guard 返回 conflicts
- [x] `<SplitFromPrdModal>` 弹窗:粒度(粗/中/细)+ 期望数 + 上下文 checkbox;成功后在 board 顶出现"建议卡片组 N 条 [载入到看板]"按钮
- [x] `<NewTaskModal>` 弹窗:title / content(Markdown)/ priority / assignee / status
- [x] 视觉对照:严格对照 `docs/design/pages/board-detail-final.html` 整体布局 + `board-detail-field-chips.html` chip 样式
- [x] e2e board.spec.ts 加例:点 card → 进详情 → toggle 双态切换(父切 implementing + 子 backlog → modal 三选项验证走 agent 集成测试,父 status 派生难造)
- [x] xUnit/integration:StatusConstraintModal 三选项 + 转写 board/overrides.log(`board-status-route.test.ts` 已覆盖 implementing/submitting/done + override + 反向不约束)
- [x] **守门 verify**:`analysis-run-mcp-e2e.test.ts` 仍 GREEN 7/7(本期不动 Provider)
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @ai-devspace/agent test` GREEN

## Comments

### 2026-08-07 实施完成

落地清单:
- 新增 agent `routes/board-transcript.ts`(GET/POST transcript,纯文件 IO)+ 测试 10 tests
- 扩展 shared schema:`TranscriptMessageCreateBodySchema` / `TaskCardTranscriptResponseSchema` + `BoardCardCreateRequestSchema` 加 `source`
- `TaskCardStore.create` 透传 `source`(默认 manual,PRD 拆落地传 prd_split)+ 测试
- 新增 web `lib/board-detail-hooks.ts`(8 hooks:card detail / cards for detail / parent / update status / patch / transcript / send / prd-split)
- 新增 web `lib/board.ts` 纯函数(filterSubtasks / filterDependencies / filterBlockedBy / computeParentProgress / formatRelativeTime)+ 测试 16 tests
- 新增 web 组件 `components/board/detail/{BoardCardDetailPage,CardDetail,CardSideProperty,CardTranscriptPanel,CardTranscriptInput,StatusConstraintModal,SplitFromPrdModal,PrdSplitResultBanner,PrdSplitReviewModal,MarkdownContent}.tsx`
- 新增 Next.js route `app/(workspace)/requirements/[id]/board/[cardId]/{page,layout}.tsx`(静态段优先于 [zone] catch-all)
- 接线 `BoardSection`(卡点击导航 + split modal banner)+ `BoardToolbar`(`[+ 从 PRD 拆]` enabled)+ `Card`(onClick 文档)
- 加 `react-markdown` + `remark-gfm` 依赖
- e2e 扩 `board.spec.ts` 加「点 card → 进详情 → toggle 双态」test

关键决策(用户拍板):
- Markdown 渲染:加 react-markdown + remark-gfm(支持 H1-6 / ol / ul / 代码块 / 表格)
- PRD 拆落地:扩展 BoardCardCreateRequestSchema 接受 source(prd_split 一步落地)
- e2e:只测 toggle 双态 + 详情渲染;StatusConstraintModal 三选项走 agent 集成测试(父 status 派生难造)

守门(ADR-0023 zero-touch):未触达 ClaudeCodeProvider / runAnalysisQuery / createSdkMcpServer / mcpCallCounter;`analysis-run-mcp-e2e.test.ts` 7/7 GREEN;transcript route 纯文件 IO,PRD 拆候选落地走现有 POST /board/cards。

验证:shared/agent/web typecheck 全 GREEN;agent 945/960 测试 GREEN(含新 board-transcript-route 10 + 守门 7/7);web 1149 测试 GREEN(含新详情页组件 86 tests);e2e 需活服跑(沿用 skip 门槛)。
