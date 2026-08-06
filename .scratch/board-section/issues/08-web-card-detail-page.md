# 08 — Web 卡片详情页 + toggle + 全部 modal

**What to build:** 卡片详情页端到端 + 全部 modal 集成:用户进 `/board/[cardId]/` 看左主区(chips / content / 子任务 / 依赖 / 详细折叠);右栏 toggle(默认属性表 / 展开 AI 协作 transcript);三个 modal(互锁 / PRD 拆 / 新任务)接入。

**Blocked by:** 03 — Agent StatusConstraintGuard,04 — Agent TaskCardTranscript,07 — Web 看板页

**Status:** ready-for-agent

- [ ] 路由 `/requirements/[id]/board/[cardId]/` + 组件 `<BoardCardDetailPage>`
- [ ] 左主区 2/3:`<CardDetail>` 含 task-title row(id + title + archive/more)+ 顶部 6 chip(状态/优先级/来源/负责人/创建/更新)+ 父进度条 + Content Markdown + 子任务列表 + 依赖列表 + 「详细信息 ▾」折叠块(8 项冷字段)
- [ ] 右栏 1/3 默认态:`<Side>` 含 `[💬 在对话中打开]` 按钮 + 属性表 8 项(status / priority / assignee / labels / 工作流 / 开发上下文 / 截止日期 / 重复)+ 关系区(阻塞于 / 阻塞 / 相关议题)+ 创建/更新时间
- [ ] 右栏 1/3 展开态:`<CardTranscriptPanel>` 含 head(标题 + 物理独立 badge + `✕`)+ 消息流 + `<CardTranscriptInput>`(textarea + 📎 引用 Run + `⌘+↵` 发送)
- [ ] toggle 行为(同 `board-detail-final.html` §3 inline snippet):右栏顶部按钮切换,**不持久化**(localStorage 不写)
- [ ] `<StatusConstraintModal>` 三选项(强制切换 / 先调整子卡 / 取消),触发条件:status 切到 implementing / submitting / done 时 Guard 返回 conflicts
- [ ] `<SplitFromPrdModal>` 弹窗:粒度(粗/中/细)+ 期望数 + 上下文 checkbox;成功后在 board 顶出现"建议卡片组 N 条 [载入到看板]"按钮
- [ ] `<NewTaskModal>` 弹窗:title / content(Markdown)/ priority / assignee / status
- [ ] 视觉对照:严格对照 `docs/design/pages/board-detail-final.html` 整体布局 + `board-detail-field-chips.html` chip 样式
- [ ] e2e board.spec.ts 加例:点 card → 进详情 → toggle 双态切换 + 父切 implementing + 子 backlog → modal 三选项验证
- [ ] xUnit/integration:StatusConstraintModal 三选项 + 转写 board/overrides.log
- [ ] **守门 verify**:`analysis-run-mcp-e2e.test.ts` 仍 GREEN(本期不动 Provider)
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @ai-devspace/agent test` GREEN
