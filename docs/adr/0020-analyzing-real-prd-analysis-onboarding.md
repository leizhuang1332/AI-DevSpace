# ADR-0020: `analyzing` 工位正式接入 agent 后端跑 PRD 分析(空态 CTA 触发 · 单 session 双 turn)

**Status:** Accepted
**Date:** 2026-07-24
**Deciders:** 项目负责人(经 `/grill-with-docs` 共识,12 轮)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 24, 38-43, 46-48, 52

**关联 ADR:**
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 工位重写(D4 admission-check 装备、D5 准入术语、D6 modules.yaml、D7 多会话);本 ADR 在其基础上**正式接通真 SDK**,并限定范围为 `start` handler
- [ADR-0017](0017-analyzing-main-document-reader.md) — chunks.jsonl schema + source_refs + synthetic 段位;D8 双 turn 输出与其契约严丝合缝
- [ADR-0019](0019-analyzing-grid-locked-height-independent-scroll.md) — 主区锁高度 + 左右两栏独立滚动;D9 CTA 落地在此契约下
- [ADR-0008](0008-skill-arming-depths.md) — Skill 三档装填(决策 40);本 ADR 在其框架内分级处理 admission-check / requirement-brainstorm
- [ADR-0010 Q5](0010-system-prompt-assembly.md) — `SystemPromptAssembler` 装配链;本 ADR D5 / D6 在其上叠加双 root + union by name
- [ADR-0009](0009-ai-failure-defense.md) — snapshot 前置;D10 走其 trigger 时机

**覆盖 / 补充:**
- **覆盖(取代)**:`apps/agent/src/routes/analysis.ts` 内的 `simulateStartChunks` mock —— 由真 SDK 实现替换;`simulateInterjectChunks` / `buildMockBriefArtifacts` **暂不动**,留待后续 PR(D12 / D13)
- **覆盖(取代)**:`apps/web/src/lib/analyzing.server.ts:472-482` `requirementId === 'req-001'` 硬短路分支 —— 删
- **覆盖(取代)**:`apps/web/src/lib/analyzing.ts` 中 `REFUND_ANALYZING` 作为 `getAnalyzingData` 运行时 mock —— 改迁 test fixture
- **补充**:`apps/agent/src/prompt/SystemPromptAssembler.ts` 的 `deps.skillsRoot: string` → `deps.skillsRoots: string[]`(双 root 装配)
- **补充**:`apps/agent/src/prompt/SystemPromptAssembler.ts` 内 assembleBase 段做 union by name,user-wins
- **补充**:`apps/agent/src/prompt/SkillLoader.ts` API 不变(`loadAll` / `findByName` 接口位不动);union 在 caller 层
- **新增(本 PR)**:`apps/agent/skills/built-in/{admission-check, requirement-brainstorm, tech-brief-scaffold, requirement-critique}/SKILL.md` 共 4 目录 4 SKILL.md 文件
- **不覆盖**:ADR-0013 D4-D15 任何既有决策
- **不覆盖**:ADR-0017 D1-D6 任何既有决策
- **不覆盖**:ADR-0019 D1-D5 任何既有决策

---

## Context

### 起点

ADR-0013 把 ANALYZING 工位重写为"PRD 准入 + 技术概要协作工作台"(2026-07-12),ADR-0017 (2026-07-21)与 ADR-0019 (2026-07-22)依次补齐 DocumentReader 主区与高度 / 滚动契约;在 ticket 01-08 落地后,产品形态层面已经"看起来完整":AdmissionDashboard 5 维度卡 + DocumentReaderPane 左 2/3 + Summary 与 ProductList 右 1/3 + 反向联动 + SSE 客户端订阅 + 多会话 tabs + 接受风险按钮。所有 UI 行为都跑通了。

UI 之下,**`apps/agent/src/routes/analysis.ts` 三个 handler 全部走 `simulate*` mock**:
- `interject` → `simulateInterjectChunks`(本地造的固定 chunks)
- `start` → `simulateStartChunks`(本地造的固定 chunks)
- `generate-brief` → `buildMockBriefArtifacts`(本地造 `technical-brief.md` + `modules.yaml` 骨架)

从未调用 `apps/agent/src/providers/ClaudeCodeProvider.ts`(Claude Agent SDK 封装)或 `AISession` 的 Skill runner。`Claude Agent SDK ^0.3.206` 与 `apps/agent/src/zones/analyzing.yaml` 的 `default_arming` 都是 **placeholder**:`default_arming` 列表里的 4 个 Skill 名字在仓库与 home 目录**都没有对应 `SKILL.md` 文件存在** —— 它们是文档里的引用,不是运行时的 prompt 片段。

web 端 `apps/web/src/lib/analyzing.server.ts:472-482` 把 `req-001 === 'req-001'` 短路到 `REFUND_ANALYZING` 常量(`apps/web/src/lib/analyzing.ts` 浅拷贝),这条路径在 PR 完成前一直被代码与测试两侧依赖;其它 id 走 fs 装配空架子。

`SystemPromptAssembler` 与 `SkillLoader` 是 ADR-0010 Q5 留下的可装配底座,但只支持**单** `skillsRoot`(默认 `~/.aidevspace/skills/`),且 `on-arming` Skill 实际装入的只是 `name + description` 一行。SkillsPage 是 mock,不来真数据。

### 痛点

1. **"analyzing 真跑 PRD 分析"是产品级承诺,但代码层面从未真跑过**。当前所有"SSE 推 chunks"实测都是 mock 在推;真 SDK 接通后的延迟、token 经济、错误语义、并发去重、产品契约不变量(chunks 形态与 AdmissionDashboard 装配)均未验证。
2. **`requirementId === 'req-001'` 短路是历史妥协**,不是产品意图。它把 `req-001` 这个 id 钉在 demo 数据上,导致其它所有 id(在 `.scratch` 下构造测试需求)进入时都是空架子,无法端到端验证产品承诺。
3. **Skill 实际上不存在于磁盘**。`analyzing.yaml` 的 `default_arming` 等于 UI 上的 badges 装饰,handler 实际拼不出任何 Skill 全文(只看得见 description 一行)。
4. **没有"启动分析"的明确 UI 入口**(目前只能依赖刷新 + 后台默默触发 mock)。用户意图与系统状态之间缺一个显式信号。
5. **`interject` / `generate-brief` 仍是 mock**,但用户已经能在 UI 点插话与生成概要按钮 —— 这两个 UI 表面像真功能,实际背后是 mock,与开始分析的真路径割裂。

### 真实场景(决定性输入)

用户在 ANALYZING 工位遇到以下任一情况,会暴露"接 SDK 缺口":

1. 用户在一个新建的需求(走 DRAFTING 上传 PRD),期望"开始分析 → 看到 AdmissionDashboard 5 卡填满 + ProductList 三桶长出来"。
2. 用户在 `req-002` 这种非 demo id 上,期望首屏能正常分析,而非看到一个永远空的骨架。
3. 用户观察到一个真跑的 SDK 调用产生的 chunk 与 mock chunk 的字段差异(例如 `source_refs` 形态、`tone` 选择、`synthetic` 字段的合理使用)。
4. 用户想定制 `requirement-brainstorm`(比如改成他们团队的"业务风险"分类法),期望改动能落到 `~/.aidevspace/skills/` 而不污染 git 仓库。
5. reviewer / 接手人期望 PR 描述里能直接读到"为什么要这样做"的判定记录,而不用再次复现 grilling。

### 与上下游 ADR 的关系

| 上游 ADR 决策 | 本 ADR 处理 |
|---|---|
| ADR-0013 D4 工位注册表 default_arming 列 4 个 Skill | **承接**:通过 D7 在 git 落 4 个 SKILL.md,但 handler 只调其中 2 个(D1) |
| ADR-0013 D5 `AnalyzingProductGroup` 三桶术语 + D6 modules.yaml | **承接**:`requirement-brainstorm` SKILL prompt 严格按三桶(chunk kind)输出,与 D5 形态对齐 |
| ADR-0017 chunks.jsonl schema(id/ts/label/kind/tone/text/source_refs/synthetic) | **承接**:D8 双 turn 输出与其 schema 1:1,`kind: 'subproblem' | 'risk' | 'option' | 'narration'` 必须准确 |
| ADR-0019 D1-D5 主区锁高度 + 列独立滚动 + 死代码清 | **承接**:D9 CTA 落位于 AdmissionDashboard 右端,不影响列滚契约 |
| ADR-0008 三档装填(决策 40) | **承接**:D8 handler 临时 override admission-check / requirement-brainstorm 的 arming 为 `always`,保证 turn 间 body 全文进 prompt |
| ADR-0010 Q5 assembleBase / assembleDynamic | **承接 / 扩展**:D5 / D6 在其上叠加 union by name,user-wins |
| ADR-0009 snapshot 触发器 | **承接**:D10 落每 turn 写前各一次 |
| **ADR-0018 Deprecated** | **不冲突**:ticket 09 已撤回 SVG 跨列画线层,与本 ADR 范围无交叉 |

---

## Decision

经 `/grill-with-docs` 12 轮共识沉淀 D1-D11:

### D1 · 范围档:B(agent 端接通真 SDK) + 仅 `start` handler 替换

**原文:**本 PR 在 agent 端只动 `apps/agent/src/routes/analysis.ts` 的 `start` handler —— 把 `simulateStartChunks` 整段替换为真 SDK 调用。`interject` / `generate-brief` **继续走 mock**,留待 D12 / D13 后续 PR 接。

**配套 web 端**:
- `apps/web/src/lib/analyzing.server.ts:472-482` 删除 `requirementId === 'req-001'` 短路分支(`L476-L478`)。
- `apps/web/src/lib/analyzing.ts` 中的 `REFUND_ANALYZING` 常量迁到 `apps/web/src/__tests__/__fixtures__/analyzing-fixtures.ts`,仅作测试 fixture。
- 组件测试中 `import { REFUND_ANALYZING } from '@/lib/analyzing'` 改为 `import { REFUND_ANALYZING } from '@/__tests__/__fixtures__/analyzing-fixtures'`,导入路径稳定。

**理由:**B 范围足以落实"正式对接 + 真跑 PRD + 生成产物"三件事;`interject` / `generate-brief` 真接涉及不同的 Skill prompt 设计,留作后续 PR 不让本 PR 体积爆。

### D2 · 触发策略:空态"开始分析"按钮(不沉默,不只读盘)

**原文:**"开始分析"UI 入口只渲染于 AdmissionDashboard **空态**。空态判别式:`sessions.length === 0 && admission.dimensions.every(d => d.count === 0)`。

- 既不沉默触发(避免刷新即后台烧 token)
- 也不只读盘(避免空架子永不被自动救活)
- 显式点击后,handler 收 `_index.yaml` + `chunks.jsonl` 落地,SSE 推数据流

**理由:**`AdmissionDashboard` 已经是 product-as-container,空态行为可以无侵入地表达;为分析动作保留 `StatusBar` 单源状态位的契约不被破坏。

### D3 · `req-001` mock 处理:fixture 化 + 零磁盘种子

**原文:**
- `REFUND_ANALYZING` 从 runtime 层迁出:`apps/web/src/lib/analyzing.ts` 仅保留类型定义与导入再导出。
- `requirements/req-001/analysis/` 在磁盘上**保持空**(不存在 `sessions/` 目录)。
- 组件测试中 `apps/web/src/__tests__/analyzing-zone.test.tsx` 等 4 个文件改 import 路径。

**理由:**让 `req-001` 与其它需求 id 行为对齐 —— "首次访问 = 空架子,显式点击开始分析",消除 id 级特例债;fixture 化保留组件测试稳定。

### D4 · Skill 性质(写作层概念合约)

**原文:**Skill = prompt fragment,**不是执行单元**。

形态重述(参 [SkillLoader.ts:31-108](../../apps/agent/src/prompt/SkillLoader.ts)):每个 Skill = 一个目录 + `SKILL.md`;frontmatter 是 `name / description / arming / triggers / hint / artifacts / context / bad_feedback`,body 是 markdown 提示词正文。

**装填三档**(取自 ADR-0008):
- `always`:body 全文进 system prompt
- `on-arming`:仅 `name + description` 一行进 prompt
- `dormant`:不装

**对产品契约的意义:**
- handler 不能"调用 Skill",只能"在 prompt 里装入 Skill 内容"
- Skill 改写 = 改 prompt 文本(handler 无需任何代码改动)
- 这把"分析风格调优"与"代码重构"严格分离

### D5 · Skill 住址:D(双层 `built-in` 仓库 + `~/.aidevspace/skills/` 用户 home,union by name,user-wins)

**原文:**
- **built-in**(`git-tracked`):`apps/agent/skills/built-in/<name>/SKILL.md`,4 个 Skill 全员内置(参 D7)
- **user**(`git 不可见`):`~/.aidevspace/skills/<name>/SKILL.md`,用户自由新增 / 覆盖
- **装配链**:`SystemPromptAssembler.deps.skillsRoots: string[]`,内部分别 `loadAll(builtIn)` 与 `loadAll(user)`,然后 **union by name,user-wins**(user 路径下的同名 Skill 优先)
- 空 home → 直接走 built-in(最常见 dev 情况)

**理由:**产品核心 Skill(`admission-check` / `tech-brief-scaffold`)内含下游 schema 契约,git 治理保证团队一致;个性化 Skill(`requirement-brainstorm` / `requirement-critique`)千人千面,home override 容许定制;union by name 给出清晰的 override 语义,**接口位 SkillLoader API 不动**(只在 `SystemPromptAssembler` 层做 union),回归面收窄。

### D6 · SkillLoader 拆 PR(本 PR 装配链,下个 PR SkillsPage 改造)

**原文:**
- 本 PR 改动:
  - `SystemPromptAssembler.deps.skillsRoot: string` → `deps.skillsRoots: string[]`
  - assembleBase 段:`Promise.all(skillsRoots.map(skillLoader.loadAll))` + union by name
  - assembleDynamic 段:同 union 流程
- 不动:
  - `SkillLoader` 公共接口(`loadAll(rootDir)` / `findByName(rootDir, name)`)
  - `SkillLoader.test.ts`
- 留待下个 PR(见 D12):
  - `apps/web/src/app/(workspace)/skills/page.tsx` 从 `@/app/(workspace)/data/mock` 切到真 SkillLoader fetch
  - 消费 `recommended_user_override` 字段显示徽章

**理由:**装配链与 UI 改造相对独立,拆 PR 让 review 单一焦点;SkillLoader 本体 API 不动也是为了把回归面收到最小。

### D7 · SKILL.md 数量:B(2 实体 + 2 骨架)

**原文:**本 PR 在 git 落 4 个 `built-in` 目录 + 4 份 SKILL.md:

| Skill 名 | 内容 | 是否调用者 | frontmatter `recommended_user_override` |
|---|---|---|---|
| `admission-check` | **实内容**(D4 + 5 维度装配约定) | 是(turn-1) | `false` |
| `requirement-brainstorm` | **实内容**(三桶 chunk 形态) | 是(turn-2) | `true`(D7.1) |
| `tech-brief-scaffold` | **骨架**(frontmatter + 占位 + 一行 `⚠️ 占位:prompt 待下个 PR 填充`) | 否(留 mock) | `false` |
| `requirement-critique` | **骨架**(同上行文) | 否(留 mock) | `true`(D7.1) |

**`analyzing.yaml` 不改**:`default_arming` 仍保留 4 名(handler 内部硬过滤只装 admission-check + requirement-brainstorm)。

**D7.1** 推荐用户覆盖字段:`recommended_user_override: true` 是约定的纯 frontmatter 字段,语义为"该 Skill 鼓励用户在公司 / 个人 home 目录覆写以贴合自己业务";`false` 或缺省 = 非推荐覆写。

**理由:**字面满足 D(4 个内置);其中 2 个 SKILL.md 的内容完整因为本 PR 直接消费,另 2 个仅占位为下个 PR 留 git 历史行,避免下个 PR 看起来"突然新建文件"。

### D8 · start handler 调度:单 session 双 turn(turn-1 admission,turn-2 brainstorm)

**原文:**
- `start` handler 创建一次 `AISession`(走 `ClaudeCodeProvider` → Claude Agent SDK)
- handler 维护一份 `chunks.jsonl` 行缓冲与 SSE 单 sink
- **turn-1**:
  - `assembleBase({ skillsRoots: [built-in, user] })` → system prompt 装入 admission-check body(SkillLoader 在本 turn 临时把 `arming` 判为 `always`,保证 body 全文进;或更直接 —— handler 内手动拼接 `### admission-check\n${body}` 段)
  - `sendMessage({ systemPrompt, userMessage: <PRD 全文 + "请按 5 维度做准入"> })`
  - SDK 流结束 = turn-1 done(chunks 已写 jsonl)
- **turn-2**:
  - 同一 session,SDK 自动保留 conversation history
  - `sendMessage({ systemPrompt: 同上, userMessage: "已知准入结果 X,继续 brainstorm subproblem / risk / option" })`
  - SDK 流结束 = turn-2 done
- handler 不另造 `done` chunk 标记 —— turn-done 完全由 SDK API 的 `sendMessage` 流关闭事件表达

**D8.1** snapshot 时机(参 D10)在每 turn chunks 落 jsonl 前各一次。

**理由:**双 turn 让 UI 看到"5 维度卡先涨 → 三桶后涨"的阶段感,符合"开始分析即进入工作节奏"的承诺;单 session 让 AI 在 brainstorm 时能直接看 admission 产出,产物质量优于 `simulate*` mock;`sendMessage` 流结束事件是 SDK 原生语义,不另造 `done` 是消除歧义。

### D9 · CTA 落位:AdmissionDashboard 右端

**原文:**在 AdmissionDashboard 右端 verdict 徽章旁,渲染 "开始分析" 主按钮。

- 渲染条件:`sessions.length === 0 && admission.dimensions.every(d => d.count === 0)`
- 一旦点击,触发:`POST /api/requirements/<id>/analysis/start`
- 按钮 active 期间显示 running 文案 + spinner(参考 ticket 09 已经处理的 analysis 流 UI)
- handler 成功返回后 AdmissionDashboard 自动切 active 视觉(AdmissionDashboard 本组件可在外层包一个 `data-phase="empty_armed"`,由 CSS 视觉区分),"开始分析"按钮条件 false 自动消失

**理由:**不引入新的工位 phase(避免 AdmissionDashboard 之外再叠一层 EmptyAnalyzing),与 D2 触发策略同源;渲染条件极小,小到可以用单 props 函数判断。

### D10 · snapshot 时机:每 turn 写前各一次

**原文:**turn-1 chunks 落 chunks.jsonl 前 → `snapshot('before_admission')`(参 [ADR-0009](0009-ai-failure-defense.md) `snapshotBeforeWriteAgent`);turn-2 chunks 落 chunks.jsonl 前 → `snapshot('before_brainstorm')`。

- 两次 snapshot 各保留独立 snapshot id,可在 StatusBar "回滚" 下拉里选中任意一次回退
- snapshot 仅在 turn 实际有写动作时触发(空 turn 不记)

**理由:**接入真 SDK 后,任何 turn 都可能因网络 / token 限额 / 内容审查半完成;保留 before 态保证 status-soft-label 的"决策 51"可以在失败时恢复;两次而非一次,允许"准入就位但 brainstorm 半成"也回滚到一个中间态(用户当下不一定要,留住 UI 选项)。

### D11 · 验收:真 SDK + reviewer 手工跑 + e2e

**原文:**
- **本 PR 不引入** `MockClaudeProvider` / `FakeClaudeProvider` 之类的抽象层;handler 只走 `ClaudeCodeProvider`
- CI 上能跑的测试:
  - `SkillLoader` 双 root union 单元测试
  - `SystemPromptAssembler` 装配多 Skill 单元测试
  - `start` handler wiring 单元测试(handler 内调用 SDK 的桥接点用 `vi.spyOn` 桩,只验编排逻辑)
  - AdmissionDashboard CTA 渲染条件单测
  - `REFUND_ANALYZING` 迁 fixture 后 4 个组件测试全过(走 fixture import)
- CI 上**不**跑的:真 SDK 调用
- **E2E(本 PR 范围)**:新增 `apps/web/e2e/analyzing-real-run.spec.ts`,使用 Playwright 启动 web + agent,等 SDK idle,然后做以下端到端串验:
  - 创建新需求(走 DRAFTING 触发或 fixture)
  - 进入 ANALYZING → 见 "开始分析" 按钮
  - 点击 → SSE 接 chunks → AdmissionDashboard 5 卡 count > 0 + ProductList 至少 1 个 subproblem
  - 截屏 + chunks.jsonl 文件头几行写入 e2e artifact
- E2E 在 PR 测试环境下默认 opt-in(开发机 / CI 跑时视 `ANTHROPIC_API_KEY` 是否设置启用;缺 key 时 e2e 自动跳过并打印 SKIPPED)
- **上线门槛**:reviewer 在 PR 评论里贴真 SDK 跑过的 SSE 头 3 段(或 chunks.jsonl 头 5 行)作为合并 checklist 一项

**理由:**真 SDK 接通后必须以"产物存在 + UI 收到产物"为最终事实;reviewer 手工跑是不可替代的诚实信号(没人能伪造),e2e 套件是回归防线。

---

## 后续 PR 路线(D12-D14,非本 PR)

### D12 · SkillsPage 改造(下个 PR)

- `apps/web/src/app/(workspace)/skills/page.tsx` 从 `@/app/(workspace)/data/mock` 切到真 SkillLoader fetch(`/api/skills`)
- `recommended_user_override: true` 字段消费为"✨ 推荐定制"小徽章,卡片右上
- 需新增 `/api/skills` 路由(SkillLoader 经由 agent 端暴露),由 agent 暴露 list 接口

### D13 · `interject` handler 真接 SDK

- `apps/agent/src/routes/analysis.ts` 的 `interject` 替换 `simulateInterjectChunks`
- 与 D8 同 session 复用(用户插话 = 在同 session 起新 turn)
- 本期 `requirement-critique` SKILL.md 同步从骨架升级为实内容(用户插话时 AI 反思已有产物)

### D14 · `generate-brief` handler 真接 SDK

- `apps/agent/src/routes/analysis.ts` 的 `generate-brief` 替换 `buildMockBriefArtifacts`
- 落 `technical-brief.md` + `modules.yaml` 双产物(参 ADR-0013 D6)
- 本期 `tech-brief-scaffold` SKILL.md 同步从骨架升级为实内容
- 新增"📋 生成技术概要"按钮(若缺)

---

## 视觉契约验收

- AdmissionDashboard 右端 **"开始分析"** 按钮在 sessions 空时可见,文案与样式与原 verdict 徽章平行不抢眼
- 点击后 AdmissionDashboard 5 卡 count 在 SSE 推流过程中**持续上涨**,按钮在条件 false 时自然消失
- turn-1 完成后 ProductList 仍为空(此时三桶 chunk 还没发);turn-2 后开始长出 subproblem/risk/option
- `requirements/<id>/analysis/sessions/<sid>/chunks.jsonl` 文件结构:`{id, ts, label, kind, tone, text, source_refs?}`(与 ADR-0017 schema 严丝合缝)
- snapshot 目录 `~/.aidevspace/snapshots/` 下出现 `before_admission` 与 `before_brainstorm` 两个 id

---

## 上线门槛

PR 描述必须包含以下四项(由 reviewer 强制检查):

1. ✅ `pnpm typecheck` 通过
2. ✅ `pnpm test` 通过(含本 PR 新增的 SkillLoader / Assembler / handler wiring 单元测试)
3. ✅ reviewer 在本地 dev 环境**手工跑通真 SDK**(`/requirements/<id>/analyzing` → 点击"开始分析" → 看到 AdmissionDashboard 5 卡 + ProductList 三桶均填)后,在 PR 评论里贴 SSE / chunks.jsonl 的真实片段
4. ⚠️ 若 e2e 套件在 PR 跑时被 SKIP(因 `ANTHROPIC_API_KEY` 缺失),reviewer 必须在评审时确认"是否在足够信任手工跑结果"的判定

---

## 与上下游 ADR 的兼容细节

- **vs ADR-0013 D4** `default_arming`:D1 限定 handler 只调 2 个,而 yaml 不动 —— 这与 D4"yaml 列出全部"含义兼容(由 handler 内硬过滤实现)
- **vs ADR-0013 D6** `modules.yaml` schema:**不动**;modules.yaml 仍由 `generate-brief` 写出(本 PR 仍为 mock,产物形态延续现状)
- **vs ADR-0017 chunks.jsonl schema**:D8 直接吃 D4-D6 既有 schema,无新字段;`synthetic` 字段本期不主动写
- **vs ADR-0019** 主区锁高度:D9 CTA 不破坏 `analyzing-main` `overflow-hidden`,按钮不抢列内 body 滚动
- **vs ADR-0008** 装填三档:D8 handler 内临时 override `arming` 为 `always` 是临时手作,cleaner 的替代方案留待"SkillLoader 运行时 arming override"作为独立 ticket(本 PR 不动)
- **vs ADR-0010 Q5** 装配链:D5 / D6 在其上层叠 union by name,无 `assembleBase` / `assembleDynamic` 签名级破坏
- **vs ADR-0009** snapshot 触发器:D10 复用其 `snapshotBeforeWriteAgent` 路径,trigger 时机新增"turn-bounded"语义

---

## ticket 落地列表

本 PR 涉及的 ticket 产物(均挂在 `.scratch/analyzing-real-prd-onboarding/issues/` 下,本 ADR 提交时同步新建):

- ticket 01:**`SkillLoader` 双 root union + `SystemPromptAssembler` 装配链改造**(D5 / D6)
- ticket 02:**`start` handler 单 session 双 turn 真接 SDK**(D8)
- ticket 03:**REFUND_ANALYZING 迁 fixture + req-001 短路移除**(D3)
- ticket 04:**4 个 `built-in` SKILL.md 实写 / 骨架**(D7)
- ticket 05:**AdmissionDashboard "开始分析" CTA**(D9)
- ticket 06:**snapshot 每 turn 触发**(D10)
- ticket 07:**e2e `analyzing-real-run.spec.ts` 真跑对接**(D11)

每个 ticket 应在前置 ticket 合入后再开 PR,顺序大致对应 02 → 04 → 03 → 05 → 01 → 06 → 07;实际合入顺序由 reviewer 在 PR 描述里拍板。

---

## ADR 维护者备注

- 写作时 grinding 共识已锁 12 条(grill-with-docs 内部 Session ID 待补)
- 如 review 阶段发现新约束(如 SkillLoader 本体 API 必须变),回 `/grill-with-docs` 立 ADR 补充,不在本 ADR 内追加
