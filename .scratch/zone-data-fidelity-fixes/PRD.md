---
Status: ready-for-agent
Type: spec
Related-ADRs: [ADR-0002, ADR-0011, ADR-0013, ADR-0014]
---

# 工位数据保真度修复 — DRAFTING/ANALYZING/DESIGNING 真实数据驱动 + 标题字段只读化 + 路径一致性

**What to build:** 让 6 个工位的 mock 数据层对齐真实文件系统产物;同时把 DRAFTING 工作台里冗余的"标题"输入框改为只读展示,并把启动校验从"标题+PRD"简化为"只校验 PRD";以及修复前端 mock loader 与后端落盘的路径错配 —— 让前端 loader 走 `~/.aidevspace/requirements/` 与后端 `RequirementService.root` 完全对齐。所有改动一起解决,因为它们共享同一个根因(mock loader 把真实需求当作空需求)。

## Problem Statement

用户新建需求后,在工位之间切换时遇到四个独立但相关的体验断裂:

1. **ANALYZING 工位永远空态** —— 需求目录下已经有 `requirement.md`(已超过后端 `deriveStatus` 阈值 10 字节),但进入 ANALYZING 工位看到的不是 AI 分析流,而是空态提示"这个需求还没有可分析的内容。先去 DRAFTING 工位写需求文档"。这条提示的字面意思就是"回 drafting",导致用户以为状态机锁死。
2. **DESIGNING 工位永远空态** —— 即便分析已完成,进入 DESIGNING 工位看到的也是空态"DESIGNING 工位暂无方案。先去 ANALYZING 工位让 AI 解析需求"。
3. **DRAFTING 工位每次进入都闪 1.5s "正在创建需求…"** —— 需求已经创建成功很久了,这条提示没有任何意义,纯浪费用户注意力。
4. **DRAFTING 工作台里有冗余的"标题"输入框** —— 标题在新建需求时已经由 `NewRequirementModal` 输入并落到 `meta.yaml.title`,列表页和面包屑都用它。在 drafting 里又让用户编辑一遍是冗余的;同时因为标题字段跟启动校验耦合(`validateLaunch` 要求 title 非空才能"进入 ANALYZING"),用户如果不填标题会卡住流程。

四个 bug 的**共同根因**:每个工位的 `get*Data(reqId)` 数据 loader 走 mock 路径,只有 `req-001` 命中硬编码样例,其他 ID 一律 `empty*(id)`(标记 `empty: true`)。mock 阶段没接 AI,新建需求确实没有产物——但 mock loader 不知道这一点,它把真实需求当作"未知 ID"处理,丢掉了用户已经写入 `requirement.md` 的事实。

## Solution

让 mock loader 读真实文件系统,而非对所有非 `req-001` 返 `empty`:

- **DRAFTING**:`requirements/{id}/requirement.md` 存在且内容超过 10 字节(跟后端 `deriveStatus` 阈值对齐)→ 构造非空 `DraftingData`(以文件内容作 `prdMarkdown`);否则 `emptyDrafting(id)`。
- **ANALYZING**:`requirements/{id}/analysis/sessions/_index.yaml` 存在且至少 1 个会话的 `chunks.jsonl` 有内容 → 构造非空 `AnalyzingData`;否则 `emptyAnalyzing(id)`。
- **DESIGNING**:`requirements/{id}/design/` 目录下产物文件存在 → 构造非空 `DesigningData`;否则 `emptyDesigning(id)`。

把 DRAFTING 工作台里的"标题"输入框改成只读 hero 区,`validateLaunch` 同步去掉 title 必填校验(只校验 `prdMarkdown`),让"进入 ANALYZING"按钮只看 PRD 是否实质有内容。

不动 `meta.yaml`:根据 ADR-0014 D4,status 由文件系统派生,**不写 meta.yaml**。问题 1 报告(用户说"meta.yaml 没有 status 字段")在修复后自然不是问题,只需在 spec 里留一段说明。

## User Stories

1. As a 新建需求的 PM, I want 进入 ANALYZING 工位时立刻看到自己的 PRD 内容(而不是"请回 DRAFTING"提示), so that 我能立刻启动 AI 分析,不会被空态打断。
2. As a 新建需求的 PM, I want 进入 DESIGNING 工位时,如果 `design/` 产物已经由 Agent 生成,看到真实的候选方案对比, so that 我不需要绕回 ANALYZING 等待。
3. As a 新建需求的 PM, I want 进入 DRAFTING 工位时,如果我的 PRD 已经存在,直接进入编辑态而不是闪一下"正在创建需求…", so that 我感觉工具尊重我已经完成的工作。
4. As a 新建需求的 PM, I want 看到一个清晰的"我在写哪个需求"的标题 hero, so that 我不会在多需求切换时搞混当前 PRD 的归属。
5. As a 新建需求的 PM, I want"进入 ANALYZING"按钮只看 PRD 是否实质有内容, so that 我不需要在 PRD 已经写好但忘记填标题的情况下被卡住。
6. As a 平台维护者, I want `meta.yaml` 保持 ADR-0014 D4 的"派生机制,不入 meta.yaml", so that 数据真相源单一,不会被双重写入失同步。
7. As a 平台维护者, I want `validateLaunch` 的契约清晰:`title` 不再是必填,`prdMarkdown` trim 非空就 OK, so that 我不用担心"标题为空导致按钮永远禁用"的隐藏耦合。
8. As a 测试编写者, I want `getDraftingData` / `getDesigningData` / `getAnalyzingData` 的数据契约 seam 上直接单测, so that 真实 fs 数据路径有 fixture-driven 测试,组件层不需要重测 IO。
9. As a 测试编写者, I want DRAFTING 组件测试继续断言"标题输入框不存在", so that 以后有人误加回来会被测试拦住。
10. As a 用户(系统性的), I want 六个工位的"空态"语义保持一致:**"还没创建该工位产物"才显示空态**;已经写过 PRD 的需求在任何下游工位看到"请回上游"提示时,这是 UI bug, not feature。

## Implementation Decisions

### D-1:mock loader 走真实 fs(影响 bug 1、2、3)

- **D-1.1** 新建 `apps/web/src/lib/drafting.server.ts`,导出 `getDraftingDataFromFs(reqId)`:
  - 路径解析:**ticket 05 改为**走 `resolveRequirementsRoot()`(详见 D-6),不再使用 `process.cwd() + ../../requirements` 隐式约定
  - 判定:文件存在 + `readFileSync(...).length > 10`(跟后端 `deriveStatus` 一致)→ 非空,`prdMarkdown` 取文件内容;否则 `emptyDrafting(reqId)`
  - **不删** `drafting.ts` 里现有 `getDraftingData`(向后兼容组件测试 + 任何 client-safe 调用)
- **D-1.2** 新建 `apps/web/src/lib/designing.server.ts`,导出 `getDesigningDataFromFs(reqId)`:
  - 路径:**ticket 05 改为**走 `resolveRequirementsRoot()`,解析 `requirements/{reqId}/design/`
  - 候选方案 / designDoc / tradeoff / stage 字段从 `requirements/{reqId}/design/*.yaml` 解析,字段命名跟 `REFUND_*` 硬编码对齐(adapter 函数做转换)
- **D-1.3** 修改 `apps/web/src/lib/analyzing.server.ts` 的 `getAnalyzingData(reqId, options?)`:
  - 现状已经实现 `loadSessionsBundle` / `loadTechBriefFromAnalysisDir`,只是 caller 没传 `options`
  - 默认行为改为:`options` 缺省时自动注入 `analysisDir = requirements/{reqId}/analysis`、`analysisSessionsDir = requirements/{reqId}/analysis/sessions`
  - **ticket 05**:默认 `analysisDir` 的父路径走 `resolveRequirementsRoot()`(此前是 `process.cwd() + ../../requirements`)
  - 显式传 `options` 仍可覆盖(为后续接 agent API 留口子)
- **D-1.4** 修改 `apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx`:
  - `drafting` 分支:`getDraftingData(reqId)` → `getDraftingDataFromFs(reqId)`
  - `analyzing` 分支:不再需要 caller 显式传 options(因 D-1.3 默认行为),调用形式保持兼容
  - `designing` 分支:`getDesigningData(reqId)` → `getDesigningDataFromFs(reqId)`
- **D-1.5** 其他工位(clarifying / planning / wrapup)的 `get*Data` **不在本次改动范围**(用户没报告这些工位空态问题,且 mock 阶段没产物可读)。后续如果有同样症状,按 D-1.1-D-1.4 同样模式扩展。

### D-2:design 产物文件 schema

- **D-2.1** mock 阶段采用四个 yaml 文件:`requirements/{reqId}/design/{stage,candidates,design_doc,tradeoff}.yaml`
- **D-2.2** 字段命名跟 `REFUND_DESIGNING` 内部硬编码**逐字段对齐**(id / title / tag / pros / cons / metrics / recommended 等),不需要转换映射
- **D-2.3** 等 Agent 真实产出 design 产物时,Adapter 层做 rename / restructure;本 spec 不预设未来 schema

### D-3:DRAFTING 标题只读化(影响 bug 4)

- **D-3.1** `apps/web/src/components/drafting-prd-pane.tsx`:
  - 删 `247-262` 行输入框 JSX(包含 `data-testid="drafting-title"` 的 `<input>`)
  - 替换为只读 hero 区:大字号显示 `data.title` + 灰色副标题"你在写这个需求"
  - 删 `:149` `generatePrdSkeleton(data.title || title)` 里的 `title` fallback(标题字段保留,只不再编辑)
- **D-3.2** `apps/web/src/components/drafting-zone.tsx`:
  - 删 `:107` `const [title, setTitle] = useState<string>(data.title)`
  - 删 `onTitleChange` 引用、`:763-771` 传给 `DraftingPrdPane` 的 `title` / `onTitleChange` props
  - 删 `:210-220` 里 `setTitle(data.title)` 的同步逻辑
  - `DraftingPrdPaneProps` 删 `title` / `onTitleChange` 字段
- **D-3.3** `packages/shared/src/drafting.ts` 的 `validateLaunch`:
  - 签名从 `{ title: string; prdMarkdown: string }` 改为 `{ prdMarkdown: string }`
  - `canLaunch = input.prdMarkdown.trim().length > 0`
- **D-3.4** `drafting-zone.tsx` 的 `launchDisabledHint`:文案从"请填写标题与 PRD Markdown" / "请填写 PRD Markdown" 统一为"请填写 PRD Markdown"
- **D-3.5** `DraftingData.title` 类型字段**保留**(列表页 / 面包屑 / 只读 hero 都要用),`REFUND_DRAFTING.title` / `emptyDrafting.title` 不动

### D-4:meta.yaml 维持 ADR-0014 D4(bug 1 误报说明)

- **D-4.1** `packages/shared/src/requirement.ts` `RequirementMeta` 接口**不增 status 字段**
- **D-4.2** `RequirementService.deriveStatus()` 继续作为 status 单一真相源
- **D-4.3** bug 1 报告的处理记录留在本 spec 的 Further Notes(代码侧不写新注释,因为 ADR-0014 D4 已经在合约注释里说明)

### D-5:骨架 overlay 行为(bug 3 验证)

- **D-5.1** `drafting-zone.tsx` `:151-160` 的 `mountSkeletonDone` effect 逻辑**保留**(`data.empty === true` 时 1.5s 骨架)
- **D-5.2** D-1.1 改完后,真实 req 进入 drafting 拿到 `empty: false` → effect 直接 `setMountSkeletonDone(true)` 不启 setTimeout,**不再闪骨架**
- **D-5.3** 新建瞬间(POST /api/requirements 刚成功跳转)拿到的数据可能 `empty: true`(文件尚未 fsync)—— 此时骨架出现是**正确**的,因为后端刚写完 requirement.md,前端第一次 SSR 读到的可能是空文件 → 接受这个 1.5s 闪烁作为"过渡态正确反馈"

### D-6:路径一致性 —— 前端 mock loader 与后端落盘对齐(影响 bug 1、2、3,本节为 ticket 05 决策)

**问题回顾**(ticket 01-04 落地后用户复盘):
ticket 01-04 提交的代码假定 `process.cwd() + ../../requirements/` 是 dev 环境的正确路径,但实际上后端 `RequirementService.root` 在 dev/production 都是 `process.env.AIDEVSPACE_HOME ?? ~/.aidevspace`,真实需求目录是 `~/.aidevspace/requirements/{id}/`,而 `<repo-root>/requirements/` 不存在。这导致 ticket 01-04 改完后三个 bug 在用户环境里**仍未修复**(loader 仍 fall through 到 `emptyDrafting` / `emptyAnalyzing` / `emptyDesigning`)。

**决策**:
- **D-6.1** 新建 `apps/web/src/lib/requirements-root.server.ts`(server-only,`.server.ts` 后缀避免 fs IO 漏进 client bundle),导出 `resolveRequirementsRoot()`:
  1. 读 `~/.aidevspace/config.yaml`,提取 `workspaceRoot` 字段(后端当前 yaml schema 里就是 `workspaceRoot: /Users/Ray/.aidevspace` 形式)
  2. fallback `process.env.AIDEVSPACE_HOME`(与后端 `defaultWorkspaceRoot()` 第一优先一致)
  3. fallback `resolve(process.cwd(), '../..')`(保留 dev 默认行为,以防 config 文件不存在)
  4. 三个 loader(`drafting.server.ts` / `designing.server.ts` / `analyzing.server.ts`)统一调用 `resolveRequirementsRoot()` 替换各自的 `defaultRequirementsRoot()`
- **D-6.2** yaml 解析器复用:把 `designing.server.ts` 里手写的 `parseFlatYamlMap` / `parseNestedBlock` / `stripQuotes` 抽到 `apps/web/src/lib/yaml.server.ts`,导出 `parseFlatMap(raw, topKey)`。`designing.server.ts` 改 `import from './yaml.server'`,行为不变。新增的 `requirements-root.server.ts` 也用同一 parser 解析 config.yaml。
- **D-6.3** `drafting.server.ts` `getDraftingDataFromFs` **额外**读 `<reqDir>/meta.yaml`,用 `parseFlatMap('id'|'title'|...)` 提 `title` 字段填到 `DraftingData.title`(解决 bug 2:只读 hero 现在有真实需求名)。`meta.yaml` 缺失 / 解析失败 → title 兜底为空字符串(行为同 `emptyDrafting`)。
- **D-6.4** 不动后端:路径真相源仍是后端 `RequirementService.root`,前端 loader 只是**消费**后端约定的 `~/.aidevspace/config.yaml.workspaceRoot`,不引入新的真实源。
- **D-6.5** 三个 server-only loader 的 header 注释更新:删除"dev 时 cwd = apps/web, ../.. = 仓库根"那段误导性说明,改为引用本节 D-6 + 新文件路径。

## Testing Decisions

### T-1:最高 seam = 数据契约层

数据契约函数 `getDraftingData` / `getDesigningData` / `getAnalyzingData` / `validateLaunch` 是**最高可测 seam**——纯函数 + 可注入 fs IO,**不需要**驱动 dev server 跑 e2e。改 fs 路径后,直接传 fixture 目录测。

### T-2:新增测试覆盖

- **T-2.1** `apps/web/src/__tests__/drafting.server.test.ts`(新建):覆盖
  - `requirement.md` 不存在 → `emptyDrafting(id)`
  - `requirement.md` 存在但内容 < 10 字节 → `emptyDrafting(id)`
  - `requirement.md` 存在且 > 10 字节 → 非空,`prdMarkdown === fileContent`
  - `req-001` 走硬编码 mock(向后兼容,即使目录里没有 requirement.md 也能拿到完整数据)
- **T-2.2** `apps/web/src/__tests__/designing.server.test.ts`(新建):覆盖
  - `design/` 目录不存在 → `emptyDesigning(id)`
  - `design/` 存在但 `candidates.yaml` 缺失 → `emptyDesigning(id)`
  - `design/candidates.yaml` 存在且非空 → 非空,candidates 字段正确解析
- **T-2.3** `apps/web/src/__tests__/analyzing-default-fs.test.ts`(新建):覆盖 `getAnalyzingData` 的默认 options 注入行为
- **T-2.4** `packages/shared/src/__tests__/drafting.test.ts`(新建或更新):`validateLaunch({ prdMarkdown: '' })` → `canLaunch: false`;`{ prdMarkdown: '   \n   ' }` → `canLaunch: false`;`{ prdMarkdown: '# foo\nbar' }` → `canLaunch: true`;签名变更后 `validateLaunch({ title: 'x', prdMarkdown: 'y' })` 编译失败(类型守护)
- **T-2.5** `apps/web/src/__tests__/requirements-root.server.test.ts`(新建):覆盖 D-6.1 的 fallback 链
  - 给一个 fixture `config.yaml` 含 `workspaceRoot: /tmp/fake` → `resolveRequirementsRoot()` 返回 `/tmp/fake`
  - 给空 config.yaml(无 workspaceRoot) → fallback AIDEVSPACE_HOME
  - AIDEVSPACE_HOME 也无 → fallback `cwd + ../..`
  - config.yaml 文件不存在 → 不报错,直接走 AIDEVSPACE_HOME fallback
- **T-2.6** `apps/web/src/__tests__/yaml.server.test.ts`(新建):覆盖 D-6.2 抽出的 parser
  - `parseFlatMap(raw, 'workspaceRoot')` 提 scalar 字段(对应 config.yaml)
  - `parseFlatMap(raw, 'id'|'title')` 提 meta.yaml 字段
  - 解析失败 / 字段缺失 → 返回 null / 空对象,容错
- **T-2.7** `apps/web/src/__tests__/drafting.server.test.ts` 追加用例:fixture 一个 `req-test/{meta.yaml, requirement.md}`,断言
  - `getDraftingDataFromFs('req-test')` 返回 `title === meta.yaml.title`、 `prdMarkdown === fileContent`、`empty === false`
  - `meta.yaml` 缺失时 `title === ''`,其他字段不变(向后兼容)

### T-3:现有测试更新

- **T-3.1** `apps/web/src/__tests__/drafting-zone.test.tsx`:断言 `data-testid="drafting-title"` **不存在**;断言 `launchDisabledHint === '请填写 PRD Markdown'` 在 prdMarkdown 为空时
- **T-3.2** `apps/web/src/__tests__/analyzing-zone.test.tsx`:`emptyAnalyzing('NEW-REQ')` 测试不变(向后兼容)
- **T-3.3** `apps/web/src/__tests__/designing-zone.test.tsx`:`emptyDesigning('NEW-REQ')` 测试不变

### T-4:不引入 e2e 测试

seam 选最高层就够了——组件测试覆盖 UI 行为,数据契约测试覆盖 IO 行为。e2e 引入需要起 dev server + 真请求,代价不划算且 mock 阶段数据是文件直接落盘。

## Out of Scope

- **O-1**:真实接 Agent 产生 design / analyzing 产物(本期只确保 loader 读 fs;Agent 怎么写 design/ 是后续 ticket)
- **O-2**:PATCH `/api/requirement/:id` 写回 status(PATCH 当前是 501 占位桩,本期不实现)
- **O-3**:为 clarifying / planning / wrapup 工位也加 fs loader(用户未报告这些工位的空态问题)
- **O-4**:改 `meta.yaml` 加 status 字段(违背 ADR-0014 D4)
- **O-5**:把 PRD 编辑自动保存到 `requirements/{id}/requirement.md`(目前 drafting 编辑只在内存 state,本期不改自动保存语义)
- **O-6**:把 `DraftingData.title` 字段彻底删除(列表页 / 面包屑 / 只读 hero 都要用)
- **O-7**:把 `validateLaunch` 的 title 校验"留个非空软警告"(本期要么去要么留,折中方案不接受)
- **O-8**:production 部署的 `process.cwd()` 路径处理 —— **由 ticket 05 / D-6 解决**:dev 与 production 都通过 `~/.aidevspace/config.yaml.workspaceRoot` 解,不再依赖 cwd 假设

## Further Notes

### N-1:问题 1(meta.yaml 无 status)报告说明

用户原始报告里 bug 1 是"meta.yaml 没有 status 字段",这是基于他看到 ANALYZING 工位空态时**以为**状态机没有正确推进(因为 meta 里没记 status)。事实是:

- `meta.yaml` 按 ADR-0014 D4 设计**不写 status**,status 由 `RequirementService.deriveStatus()` 实时从文件系统目录派生
- 当前推进到 ANALYZING 工位的唯一路径是用户点"进入 ANALYZING"按钮(在 drafting 里),按钮只是 `router.push`,不改 status,也不在 `analysis/` 目录下产生产物
- 即使给 `meta.yaml` 加 status 字段,也**没有任何代码路径写它**(PATCH 接口是 501 占位桩)
- 真要解锁 ANALYZING 工位的"非空"状态,需要后端 Agent 在 drafting 完成后**写 `analysis/sessions/_index.yaml` + `chunks.jsonl`**——这是 Out of Scope O-1 的事

结论:bug 1 是误报,正确的修复方向是把 mock loader 切到读 fs(本 spec D-1),让 ANALYZING 一旦有 `analysis/` 产物就显示内容;在 `analysis/` 产物落地之前,空态是**正确**的"还没分析"语义。

**补充(ticket 05 决策后)**: ticket 01-04 落地后,bug 1 的修复仍未生效,因为前端 loader 的 fs 路径(原 N-2 假定的 `cwd + ../../requirements`)在用户环境里不存在 —— 后端实际落盘在 `~/.aidevspace/requirements/`。ticket 05(D-6)处理路径一致性后,bug 1 / 2 / 3 才真正消失。

### N-3:fixture 测试隔离

新增的 `drafting.server.test.ts` / `designing.server.test.ts` 用 vitest 的 `tmpdir` 或 `os.tmpdir()` 创建 fixture 目录,测试结束清理;不污染仓库根 `requirements/` 目录。

### N-4:提交策略建议

按 A(数据保真)+ B(标题只读)两个独立原子改动分两个 commit:
- commit 1:D-1 / D-2 / D-5(mock loader 走 fs,问题 1/2/3 一并消失)
- commit 2:D-3 / D-4(标题只读化 + validateLaunch 同步)

每个 commit 跑一次 `pnpm --filter web typecheck` + `pnpm --filter web test` 验证。