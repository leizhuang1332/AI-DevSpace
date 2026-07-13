---
Status: reference
Type: context-brief
Audience: 进行 DRAFTING 工位二次设计的 agent / 人
Source-of-truth:
  - docs/design/pages/11a-stage-adaptive-draft.html  (HTML 原型 · 视觉)
  - .scratch/ai-devspace-mvp/issues/18-zone-drafting.md  (落地 issue)
  - docs/adr/0011-requirement-workbench-zone-adaptive.md  (ADR · §6)
  - docs/adr/0012-requirement-workbench-shell-topology.md  (shell / 注册表)
  - CONTEXT.md  (决策 15 / 22 / 23 / 24 / 36 / 49 / 50 / 51 / 52 / 53 / 55 / 56 / 57)
  - 用户故事.md  (Vibecoding 用户原始诉求)
---

# DRAFTING 工位 · 二次设计上下文

> 本文档是 DRAFTING 工位**二次设计前的现状速读**。
> 读者应能在不打开其它文件的前提下,完成"用户故事 / 页面风格 / 关键决策"三件事的现状盘点。
> 任何与本文件冲突的最新事实,以 `.scratch/<feature>/` 下的最新 issue 为准。

---

## 0 · 30 秒摘要

- **是什么**:需求工作台 7 个产品形态中的"工位 1"——专门用于**写需求 PRD** 的居中表单页。
- **在哪**:`/requirements/<id>/drafting/`,独立路由、独立工作台(继承 ADR-0011 §1,决策 51)。
- **谁在用**:Vibecoding 后端开发;以"需求"为单位工作,需要把模糊想法落地为可执行的 PRD+AC,再交给 ANALYZING 工位的 AI 做准入校验。
- **核心特征**:**唯一保留资源树 + Inline 栏的工位**之一(另一个是 EXECUTING);资源树承载"PRD 章节大纲",Inline 栏承载"候命 Skill"列表。
- **当前形态完成度**:**MVP 已落地**(issue 18 ready-for-agent,2026-07-13 提交 `2ffa5bd`)。本期是 mock,真实 agent API 待接入。

---

## 1 · 用户故事

### 1.1 原始 Vibecoding 故事(用户故事.md)

> **角色**:后端开发,Vibecoding 全流程用户。
> **典型链路**:拿 PRD → 澄清 → 设计 → 计划 → 编码 → 测试 → 提交。

7 步中,每一步都对应**若干 Skill**(非 1:1),用户**可任意跳、漏、重排**;AI 不主动推这条线。

**7 个用户痛点**:
1. 多项目 → 频繁切项目切 AI 上下文
2. 无全局项目管理 / 无代办 → 人工跟踪
3. 无统一代码规范
4. 无统一测试规范
5. **无验收标准** → 功能实现不一致 / 遗漏
6. **中间产出无及时保存**(SQL、Apollo 配置)
7. 同样问题重复解决

**7 个想要**:
1. 单一开发工作台
2. 多需求并行管理
3. 需求列表 → 一眼状态
4. 需求详情 → 进度 + 任务
5. 需求详情 → 关联仓库 + 提交/Diff
6. 方便 IDE 打开仓库
7. 沉淀知识库

### 1.2 DRAFTING 工位的用户故事(从 issue 18 + PRD-analyzing-rewrite 派生)

| # | 故事 | 来源 |
|---|---|---|
| D-1 | As 后端开发,我拿到需求后第一件事是进入需求详情写 PRD,so that 把模糊想法落成可执行的需求 | issue 18 目标 + 用户故事 §4-6 |
| D-2 | 我想用 Markdown 写 PRD(背景 / 目标 / 验收标准 / 非目标),so that AI 能直接消费 | 11a 原型 + draft.ts `prdMarkdown` 字段 |
| D-3 | 我想边写边看到 PRD 的章节大纲实时同步到左侧资源树,so that 不迷失在长 PRD 中 | 11a 原型 + draft.ts `extractPrdOutline` |
| D-4 | 我想结构化添加 AC(checklist),so that AI 准入校验有量化指标 | issue 18 AC 验收 + 11a 原型 AC 字段 |
| D-5 | 我想勾选关联仓库(多选),so that 后续 EXECUTING 工位能正确生成 worktree | 11a chips + `DraftingRepo` |
| D-6 | 我想每 30 秒自动保存草稿,so that 中途退出不丢内容 | issue 18 自动保存 + draft-form.tsx `useEffect + setInterval` |
| D-7 | 我想点"创建并启动 AI 分析"无缝跳到 ANALYZING 工位,so that 进入下一步 | issue 18 验收 #3 + draft-form `handleAction.launch` |
| D-8 | 我想在 DRAFTING 候命 3 个 Skill(brainstorm / clarify / schema-design),so that 不会写时求助无门 | 11a rail + draft.ts `skills` + issue 18 验收 #6 |
| D-9 | 我想在 PRD 下方输入"可量化"AC(如"成功率 ≥ 99%"),so that 避免模糊验收 | 11a placeholder + 验证"AC 建议可量化"(11a inline rail 卡片) |
| D-10 | 我想在标题为空时 launch 按钮自动 disabled,so that 不会漏填关键字段 | draft-form.tsx `validity.canSubmit` |
| D-11 | 我想随时切到其它工位(Overview / ANALYZING / ...)再回来,so that 不被 DRAFTING 卡死 | ADR-0011 §5 "任意跳转" + ZoneBar |

### 1.3 反例 / 边界故事(从测试反向推)

- 空草稿(`emptyDrafting`):字段全空、AC 列表为空、launch disabled、但仍渲染 form 容器 → "不吓退新手"
- 表单全空时**不**触发自动保存(节流,只保存有意义内容)
- 卸载组件时清理 `setInterval`(不漏报内存泄漏警告)
- 校验不要求 AC ≥ 1 条(spec 没强制);launch 只校验 title + PRD
- CRLF 行尾、空标题、`#foo`(无空格)都不误识别为 heading(extractPrdOutline 健壮性)
- 用户**可任意反转**(WRAP-UP → DRAFTING,决策 51)——这意味着 DRAFTING 不是"流程起点",而是"补全入口"

---

## 2 · 页面风格 / 产品设计

### 2.1 视觉对照基线

**主对照**:`docs/design/pages/11a-stage-adaptive-draft.html`(320 行,已落盘,✅)
**次对照**:`docs/design/pages/12-requirement-overview.html`(第 7 形态 OVERVIEW,DRAFTING 在工位地图中以卡片引用)
**风格来源**:CONTEXT.md 决策 17(UI 参考 Linear) + 决策 28(信息密度紧凑型) + 决策 20(Linear 紫 #5e6ad2 6 阶)

### 2.2 三层 shell 拓扑(决策 51 / ADR-0012 §2)

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1(全局 · 28px+44px)                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ TopNav(36px sticky)                                       │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ StatusBar(72px sticky · ZoneBar 7 Tab)                     │  │
│  │  Overview · DRAFTING · ANALYZING · CLARIFYING · DESIGNING  │  │
│  │  · EXECUTING · WRAP-UP                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ThinkBarSlot(全局 AI 状态指示器 · 内容由 useZone 注入)    │  │
│  └────────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────────┤
│ Layer 2(workspace · 56px Sidebar)                                 │
│  ┌─────┬────────────────────────────────────────────────────────┐ │
│  │ SB  │  Layer 3(zone shell)                                  │ │
│  │     │  ┌──────────────────────────────────────────────────┐  │ │
│  │ 🏠  │  │ ZoneShell.grid grid-cols-[240px_1fr_120px]        │  │ │
│  │ 📌  │  │ (DRAFTING = 3 列)                                │  │ │
│  │ 📦  │  │ ┌────────┬─────────────────┬────────┐            │  │ │
│  │ 📚  │  │ │Resource│  DraftingZone   │Inline  │            │  │ │
│  │ 🤖  │  │ │ Tree   │  (Form 居中     │ Rail   │            │  │ │
│  │ ⚙️  │  │ │ 240px  │   760px)        │ 120px  │            │  │ │
│  │     │  │ └────────┴─────────────────┴────────┘            │  │ │
│  └─────┴────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

> DRAFTING 是 **6 工位中唯一三列齐全**(has_resource_tree=true + has_inline_rail=true)的"主动创作"环境。
> 资源树 / Inline 栏的"通用性"假设不成立(ADR-0011 §"原 v1 根本问题" #3) → 每个工位独立设计环境。

### 2.3 主区布局(DRAFTING 专属)

```
┌──────────────── DraftingZone (data-testid="drafting-zone") ─────────────────┐
│ ┌────── DraftingToolbar (h=11) ────────────────────────────────────────┐   │
│ │ crumb: 需求 / 退款功能优化 / 草稿                       状态:草稿·未创建 │   │
│ │                                          形态:📝 Form  (font-mono)   │   │
│ └────────────────────────────────────────────────────────────────────────┘   │
│ ┌────── drafting-main (flex-1, overflow-auto) ─────────────────────────┐   │
│ │                                                                      │   │
│ │       ┌─── max-w-[760px] mx-auto ─────────────────────┐             │   │
│ │       │ DraftingForm (bg-elevated, rounded-xl, shadow)│             │   │
│ │       │  ┌─ form-head ─────────────────────────────┐  │             │   │
│ │       │  │ 📝 新建需求 / 编辑需求                  │  │             │   │
│ │       │  │ 填写 PRD 与验收标准 —— 提交后 AI...     │  │             │   │
│ │       │  └──────────────────────────────────────────┘  │             │   │
│ │       │  ┌─ Field 标题* ─────────────────────────────┐ │             │   │
│ │       │  │ input.h-10 焦点态 ring-brand-50          │ │             │   │
│ │       │  └──────────────────────────────────────────┘ │             │   │
│ │       │  ┌─ Field PRD (Markdown)* ──────────────────┐ │             │   │
│ │       │  │ ┌─ ed-toolbar ─────────────────────────┐ │ │             │   │
│ │       │  │ │ B I H1 </> · 列表        N chars [👁预览]│ │             │   │
│ │       │  │ └────────────────────────────────────────┘│ │             │   │
│ │       │  │ ┌─ ed-body textarea min-h-[190px] ──────┐ │ │             │   │
│ │       │  │ │ (monospace · focus 无 outline)        │ │             │   │
│ │       │  │ └────────────────────────────────────────┘ │ │             │   │
│ │       │  └──────────────────────────────────────────┘ │             │   │
│ │       │  ┌─ Field AC 结构化 ───────────────────────┐ │             │   │
│ │       │  │ ☐ input.h-8 ✕                            │ │             │   │
│ │       │  │ ☐ input.h-8 ✕                            │ │             │   │
│ │       │  │ ☑ input.h-8 ✕                            │ │             │   │
│ │       │  │ ＋ 添加验收标准 (text-brand-600)         │ │             │   │
│ │       │  └──────────────────────────────────────────┘ │             │   │
│ │       │  ┌─ Field 关联仓库(多选) ──────────────────┐ │             │   │
│ │       │  │ [✓ 📦 refund-service] [✓ 📦 order-service]│ │             │   │
│ │       │  │ [＋ 📦 coupon-service] [＋ 📦 payment-gw] │ │             │   │
│ │       │  └──────────────────────────────────────────┘ │             │   │
│ │       │  ┌─ form-foot ─────────────────────────────┐ │             │   │
│ │       │  │ 取消                       缺 N 项 · 已保存 │ │             │   │
│ │       │  │              [💾 保存草稿] [🚀 创建并启动] │             │   │
│ │       │  └──────────────────────────────────────────┘ │             │   │
│ │       └────────────────────────────────────────────────┘             │   │
│ └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.4 资源树(左 240px)—— DRAFTING 专属视图

**触发**:`ZoneShell` 检测到 `zone.has_resource_tree && prdSections` → 切换到 `DraftingPrdTreeView`(`resource-tree.tsx:170`)。

**视觉**:
```
┌─ ResourceTree (data-tree-mode="drafting-prd") ──┐
│ ┌─ PRD 章节大纲 ──────────── ┐                   │
│ │                           N(brand-50 徽章)   │
│ ├───────────────────────────┤                   │
│ │ H1 退款功能优化            │ (pl-2)            │
│ │   H2 背景                  │ (pl-5)            │
│ │   H2 目标                  │ (pl-5)            │
│ │     H3 退款流程自动化      │ (pl-8)            │
│ │   H2 验收标准              │ (pl-5)            │
│ │   H2 非目标                │ (pl-5)            │
│ └───────────────────────────┘                   │
│ (空态:PRD 暂无 H1/H2/H3 标题。在主区编辑器中   │
│  用 # / ## / ### 添加章节,资源树会实时同步。)   │
└──────────────────────────────────────────────────┘
```

**数据流**(server → client):
1. `app/(workspace)/requirements/[id]/[zone]/page.tsx:72` → `extractPrdOutline(data.prdMarkdown)`
2. → `<ZoneShell prdSections={...}>`
3. → `<ResourceTree prdSections={...}>`
4. → `DraftingPrdTreeView`(只读)

**关键**:**资源树由 server 预解析 + 注入,组件本身纯渲染**(`resource-tree.tsx:88-90` 注释)。本期 mock 不响应点击定位(后续接 agent API 时扩展)。

### 2.5 Inline 栏(右 120/240px)—— DRAFTING 专属视图

**触发**:两个入口任一即可:
- `ZoneShell draftingSkills={...}` → 默认 `InlineRail` 内部切到 `DraftingSkillRail`
- `ZoneShell inlineRailSlot={<DraftingSkillRail .../>}` → 替换默认(本期 DRAFTING 走这条,因为需要 client 回调)

**视觉(展开态,默认折叠 w=12)**:
```
┌─ InlineRail (data-rail-mode="drafting-skills") ──┐
│  候命 Skill                            ⟨ 折叠   │
│ ┌─ sk-brainstorm (border-l brand) ─────────────┐│
│ │ 🤖 requirement-brainstorm                     ││
│ │ 从模糊想法出发,引导你产出结构化 PRD。        ││
│ │ ⌘K 唤起 →                                    ││
│ └───────────────────────────────────────────────┘│
│ ┌─ sk-clarify ─────────────────────────────────┐│
│ │ 🤖 requirement-clarify                        ││
│ │ 对已写 PRD 提问 / 反问,补足模糊点。           ││
│ │ ⌘K 唤起 →                                    ││
│ └───────────────────────────────────────────────┘│
│ ┌─ sk-schema ──────────────────────────────────┐│
│ │ 🤖 schema-design                              ││
│ │ 基于 PRD 草拟数据库 schema 与 API 草案。      ││
│ │ 一键启动 →                                    ││
│ └───────────────────────────────────────────────┘│
│                                                    │
│ 这些 Skill 在 DRAFTING 工位候命 —— 点击或通过 ⌘K  │
│ 唤起。它们不修改你的 PRD,只在你需要时辅助。        │
└────────────────────────────────────────────────────┘
```

**交互**:
- 默认 `collapsed=true`(w=12,只有一个 `⟩` 按钮,`aria-label="展开候命 Skill 列表"`)
- 点击 → 展开 w-60 → 渲染候命 Skill 列表
- 点击 Skill trigger → `DraftingSkillRail`(`drafting-skill-rail.tsx`)的 `handleSkillTrigger(skill)` → 本期 mock: `console.info('[drafting-skill] trigger', { requirementId, skill })`

**为什么走 `inlineRailSlot` 而不是 `draftingSkills` prop**(issue 18 §"设计要点"):
> Server Component(page.tsx)不能直接传函数 prop,故把回调封装到本 client 包装中。

### 2.6 颜色 / 字号 / 间距 token

| 类别 | token | 用途 |
|---|---|---|
| 主色 | brand(#5e6ad2) / brand-50 / brand-100 / brand-500 / brand-600 / brand-700 | 决策 20,Linear 紫 6 阶 |
| 语义色 | success(#16a34a) / warning(#f59e0b) / error(#ef4444) / info(#64748b) | 决策 21 |
| 中性 | bg / bg-elevated / bg-subtle / border / border-strong / text-1 / text-2 / text-3 | 决策 28 |
| 字号 | 9 档:11 / 12 / 13 / 14 / 16 / 18 / 20 / 24 / 32 | 决策 28 |
| 间距 | 4 倍数:4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 | 决策 28 |
| 圆角 | sm(4) / md(6) / lg(8) / xl(12) | 决策 28 |
| 阴影 | sm / md / lg(0.04 / 0.06 / 0.08 alpha) | 决策 28 |
| 字体 | Inter(主) + JetBrains Mono(代码/字符计数) | 决策 28 |

DRAFTING 专属:
- `form` 容器:`bg-bg-elevated · border-border · rounded-xl · shadow-md · p-6`
- 标题 input:`h-10 · border-border-strong · focus:ring-brand-50`
- 编辑器 body:`min-h-[190px] · font-mono · resize-y`
- AC item 高度:`h-8` 紧凑
- 仓库 chip:`rounded-full · bg-brand-50(border-brand)on / bg-bg off`
- form-foot:`border-t · pt-4 · mt-2`(与 form-head `border-b · pb-4` 对称)
- launch 按钮:`h-10 · px-5 · bg-brand · text-white`(比 save 大一档)

### 2.7 交互细节(本期已落地)

| 元素 | 行为 | 实现位置 |
|---|---|---|
| 自动保存 | 30s `setInterval`,仅当 title/prd 有内容才触发 | `drafting-form.tsx:63-73` |
| PRD 大纲派生 | `useMemo(() => extractPrdOutline(prdMarkdown), [prdMarkdown])` | `drafting-form.tsx:49` |
| 表单校验 | `useMemo(() => validateDraftingForm({title, prdMarkdown, acceptanceCriteria}))` | `drafting-form.tsx:50-53` |
| AC id 生成 | `crypto.randomUUID()` 或降级 `${Date.now().toString(36)}-${Math.random()...}` | `drafting-form.tsx:79-83` |
| 预览切换 | 单 button `aria-pressed` + 条件渲染 `PrdPreview` / `textarea` | `drafting-form.tsx:184-211` |
| launch 跳转 | `router.push('/requirements/<id>/analyzing/')`,disabled 时 `userEvent` silently no-op | `drafting-form.tsx:118-122` + `drafting-zone.test.tsx:262-273` |
| 相对时间 | `formatRelativeTime`(< 5s=刚刚 / < 60s=秒前 / < 60min=分钟前 / else HH:MM:SS) | `drafting-form.tsx:471-478` |
| 字符计数 | `data-chars={prdMarkdown.length}`(用 data 属性便于 e2e 抓取) | `drafting-form.tsx:181` |

### 2.8 Mock 数据(`getDraftingData('req-001')`)

| 字段 | 值 |
|---|---|
| requirementId | req-001 |
| toolbar.statusText | "草稿 · 尚未创建" |
| toolbar.crumb | 需求 / 退款功能优化 / 草稿(current) |
| title | "退款功能优化" |
| prdMarkdown | 4 个 H2(背景 / 目标 / 验收标准 / 非目标)+ 3 条 - [ ] AC |
| acceptanceCriteria | 3 条:退款成功率 ≥ 99% / 平均退款时长 ≤ 30s / 失败自动重试并通知用户 |
| repos | refund-service ✓ / order-service ✓ / coupon-service / payment-gateway |
| skills | requirement-brainstorm / requirement-clarify / schema-design |
| actions | save(secondary) / launch(primary) |
| autosaveIntervalMs | 30000 |
| lastSavedAt | null |
| empty | false |

---

## 3 · 关键决策(必看)

### 3.1 平台级(v1.0 已锁定)

| # | 决策 | 与 DRAFTING 的关系 |
|---|---|---|
| 1 | 混合架构:Web 工作台(:3333) + 本地 Agent(:7777) | DRAFTING 数据由 Agent 拉取(Web 端 `getDraftingData` 当前为 mock,后续 `await fetch('/api/...')`) |
| 2 | 数据存储 = 纯文件系统(markdown/yaml/json) | PRD 落 `meta.yaml` + `prd.md` |
| 9 | AI 推理 = 通过 Claude Code SDK(本平台不自建 LLM) | DRAFTING 候命的 Skill 是 SKILL.md frontmatter + 正文 |
| 15 | **流程 = 不写状态机** | 工位切换 = 用户主动,**不**根据 `meta.yaml.status` 推断 |
| 16 | UI 打磨 v1.0 = 交互流畅度 + 状态可视化 | DRAFTING 的 toolbar 状态文本、自动保存时间戳、launch disabled 提示都是这一条 |
| 17 | UI 参考 Linear(极简、克制、开发者向、Cmd+K) | 整体风格源头 |
| 20 | 主色 brand #5e6ad2,6 阶 | launch 按钮 / focus ring / AC 勾选都走 brand |
| 22 | 状态色 4 + 灰,DRAFTING = 灰(`status_color: gray`) | ZoneBar 7 Tab 中 DRAFTING 状态点 |
| 23 | AI 存在 = 形态 C(混合);**取消右栏常驻** | 但 DRAFTING 仍保留 Inline 栏(决策 53 反向豁免) |
| 24 | AI 哲学:"不打扰,但陪伴;克制,在场" | DRAFTING 的 Skill 是"候命"而非"主动推" |
| 26 | Cmd+K 三段式(命令 + AI ⌘I + 历史) | DRAFTING 候命 Skill trigger 多写"⌘K 唤起",引导用户走 Cmd+K |
| 28 | 信息密度 Linear 紧凑型;9 档字号 / 4 倍数间距 | DRAFTING 全局遵守 |
| 36 | 三件套单一事实源:PRD.md / UI-POLISH-SPEC.md / `docs/design/pages/*.html` | 11a HTML 是 DRAFTING 的视觉源 |
| 38 | Skill = 提示词封装(progressive disclosure),非执行单元 | `requirement-brainstorm` 等是"候命描述",不是"启动执行" |
| 43 | AI 陪伴硬约束:状态可见但抢焦 | DRAFTING 顶部 ThinkBarSlot 全局 AI 状态 |
| 47 | 自动 snapshot 30 天 | DRAFTING 自动保存可借 snapshot(后续) |
| 49 | StatusBar 4 指示器:状态 / 待回答 N / 候命 N / 最近写入 N | DRAFTING 时"候命 N"显示当前工位的 skill 数 |

### 3.2 v1.0.1 增量(11 轮 grilling 沉淀,ADR-0011/0012)

| # | 决策 | 与 DRAFTING 的关系 |
|---|---|---|
| 50 | 详情页 → 工作台 = 7 产品形态(1 Overview + 6 工位) | DRAFTING 是工位 1 |
| 51 | **工位 = 独立路由** `/requirements/[id]/[zone]/` | DRAFTING = `/requirements/<id>/drafting/`,独立 URL,可任意跳 |
| 52 | **资源树按工位**:DRAFTING / EXECUTING / WRAP-UP 有,其他 3 无 | DRAFTING 资源树显示"PRD 章节大纲" |
| 53 | **Inline 栏下放**:仅 DRAFTING / EXECUTING 保留 | DRAFTING Inline 栏显示"候命 Skill 列表" |
| 54 | AI 思考条全局化,位置 shell 层 1,内容由 `useZone()` 注入 | DRAFTING 时 ThinkBar 显示 idle / 观察中 / 等回答等 |
| 55 | ZoneBar 7 Tab + Cmd+K 双通道;排序 Overview → DRAFTING → ... → WRAP-UP | DRAFTING 是 lifecycle 第 1 站(lifecycle 起点的默认值) |
| 56 | 工位集合 = 声明式注册表(13/15 字段 yaml) | `apps/agent/src/zones/drafting.yaml` 是注册表单一事实源 |
| 57 | `/requirements/[id]/` 默认重定向到 cookie `last_zone` 或 `drafting` | **DRAFTING = lifecycle 起点 = 默认工位**(`DEFAULT_ZONE_ID = 'drafting'`) |

### 3.3 DRAFTING 专属 ADR-0011 §5/§6 决策回顾

> 完整论证见 [ADR-0011](../adr/0011-requirement-workbench-zone-adaptive.md) §"原 v1 根本问题" + §"新决策" + §"4 个关键决策回顾"。

| 决策 | 结论 | 与 DRAFTING 关系 |
|---|---|---|
| **R2 资源树按工位** | 3 工位有 / 3 工位无 | DRAFTING 有(显式决策) |
| **选项 C Inline 栏下放** | 仅 DRAFTING / EXECUTING | DRAFTING 保留(显式决策) |
| **A3 AI 思考条全局** | shell 层 1,内容由工位注入,新增 `thinking_bar` 字段 | `drafting.yaml` `thinking_bar: required` |
| **方案 E 顶部 Tab + Cmd+K** | 7 Tab 排序 | DRAFTING 排第 2 位(Overview 排第 1) |

### 3.4 注册表快照(`apps/agent/src/zones/drafting.yaml`)

```yaml
zone:
  # ─── 身份(必填 · 5 字段) ───
  id: drafting
  name: DRAFTING
  display_name: 起草
  icon: ✏️
  route_segment: drafting

  # ─── 环境(必填 · 5 字段) ───
  has_resource_tree: true        ← R2
  has_inline_rail: true          ← C
  main_layout: workspace
  status_color: gray             ← 决策 22
  status_pulse: false            ← 决策 49

  # ─── 装备(必填 · 1 字段) ───
  default_arming:
    - requirement-drafting
    - context-bootstrap

  # ─── AI 思考条(必填 · 1 字段) ───
  thinking_bar: required         ← 决策 54

  # ─── 触发器(可选 · 2 字段) ───
  entry_triggers: []             ← 决策 15:不自动切工位
  exit_triggers: []

  # ─── 备注(可选 · 1 字段) ───
  description: 撰写需求文档,建立初始上下文
```

### 3.5 切换条件 / 数据流向

**进入 DRAFTING**:
- URL 直达:`/requirements/<id>/drafting/`
- ZoneBar Tab 点击 → `router.push`
- Cmd+K 输入"DRAFT" → 切
- `/requirements/<id>/` → cookie `last_zone` 或 `drafting` 默认重定向(决策 57)

**退出 DRAFTING**:
- `[🚀 创建并启动 AI 分析]` → `router.push('/requirements/<id>/analyzing/')`
- `[取消]` → `router.back()`
- ZoneBar Tab 任意切
- **AI 不自动切**(`exit_triggers: []`,决策 15)

**数据生命周期**:
```
requirements/<req-id>/
  ├─ meta.yaml              ← 状态 / 关联仓库 / 负责人
  ├─ prd.md                 ← PRD Markdown(由 extractPrdOutline 解析)
  └─ ...
```
本期 mock:所有 `getDraftingData` 是 hard-coded;真实接 agent API 时 `await fetch('/api/requirements/<id>/draft')`。

---

## 4 · 关键文件清单(二次设计的入口)

### 4.1 必须读

| 文件 | 角色 | 关键章节 |
|---|---|---|
| `docs/design/pages/11a-stage-adaptive-draft.html` | **视觉单一事实源** | line 173-296(DRAFT 专属结构) |
| `.scratch/ai-devspace-mvp/issues/18-zone-drafting.md` | 落地 issue · 范围 + 验收 | line 7-44 |
| `docs/adr/0011-requirement-workbench-zone-adaptive.md` | ADR §5/§6 + §8 | line 102-150 |
| `docs/adr/0012-requirement-workbench-shell-topology.md` | shell + 注册表 + 默认重定向 | line 168-183 + 198-235 |
| `CONTEXT.md` | 决策 15/22/23/24/36/49/50-57 | line 235-305 |
| `apps/web/src/lib/drafting.ts` | 数据层 + 校验 + 大纲解析 | 全文件 |
| `apps/web/src/components/drafting-zone.tsx` | 主区 server 容器 | line 30-96 |
| `apps/web/src/components/drafting-form.tsx` | 主区 client 交互 | 全文件 |
| `apps/web/src/components/inline-rail.tsx` | InlineRail + DraftingSkillRail | line 131-228(DRAFTING 专属视图) |
| `apps/web/src/components/resource-tree.tsx` | 资源树 + DraftingPrdTreeView | line 170-221(DRAFTING 专属视图) |

### 4.2 推荐读

| 文件 | 角色 |
|---|---|
| `apps/agent/src/zones/drafting.yaml` | 注册表单一事实源 |
| `apps/web/src/lib/zones.ts` | web 端工位元数据(精简版) |
| `apps/web/src/lib/zone-shell.tsx` | ZoneShell 拼装 + `zoneShellGridClass` |
| `apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx` | 工位路由分发(DRAFTING 在 line 66-85) |
| `apps/web/src/__tests__/drafting-zone.test.tsx` | 已落地行为契约(可作为二次设计的回归基线) |
| `apps/web/src/__tests__/drafting.test.ts` | 数据层单元测试 |
| `apps/web/src/__tests__/drafting-skill-rail.test.tsx` | Inline 栏 Skill 触发契约 |
| `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md` | 下游(ANALYZING)对 DRAFTING 产物的消费方式 |
| `用户故事.md` | Vibecoding 原始用户故事 |

### 4.3 关联决策文件(可选)

| 文件 | 关系 |
|---|---|
| `docs/adr/0006-html-prototype-as-source-of-truth.md` | HTML 原型作为视觉源 |
| `docs/adr/0009-ai-failure-defense.md` | 自动 snapshot(snapshot 机制 DRAFTING 可借) |
| `docs/adr/0013-analyzing-zone-rewrite.md` | 下游 ANALYZING 重设计(D9 交接消费 DRAFTING 产物) |

---

## 5 · 二次设计的"已知边界"(红线)

> 以下规则由决策 / ADR 锁定,二次设计**不能违反**;若需违反必须先改 ADR。

1. **不能把 DRAFTING 改为"流程入口 / status 驱动"** —— 决策 15 反对状态机;`exit_triggers: []`
2. **不能让 Inline 栏常驻所有工位** —— 决策 53 仅 DRAFTING / EXECUTING 保留
3. **不能让 AI 主动推"建议进入 ANALYZING"** —— 决策 24/25;只能"用户主动切"
4. **不能让 DRAFTING 越界做"PRD 准入校验"** —— 决策 58-72(ANALYZING 的 4 职能);DRAFTING 产出后由 ANALYZING 接手
5. **不能让资源树显示"产物 / 设计 / 计划"** —— 决策 52;DRAFTING 资源树只显示 PRD 章节大纲
6. **不能改 StatusBar 4 指示器** —— 决策 49;DRAFTING 时"候命 N"显示当前 skill 数
7. **不能改主题色 / 信息密度 token** —— 决策 20/28;Linear 紫 6 阶 / 9 档字号 / 4 倍数间距
8. **不能用 status 字段推断默认工位** —— 决策 57;只读 cookie `last_zone` 或 fallback `drafting`
9. **不能改工位 lifecycle 顺序** —— 决策 55;Overview → DRAFTING → ANALYZING → ...
10. **不能让 DRAFTING 主区全宽** —— 决策 53/52 必须保留资源树 + Inline 栏(主区 form 居中 760px)

---

## 6 · 二次设计可施展空间(开放点)

> 以下是**未被决策锁定**的设计空间,二次设计可自由发挥:

### 6.1 UX / 交互

- **Markdown 编辑器增强**:目前是 textarea + 简化预览;可接 `react-markdown` / `@uiw/react-md-editor` / Monaco,补完整富文本(11a 原型 ed-toolbar 的 B / I / H1 / 列表按钮目前是占位)
- **AC 形态**:目前是 input + checkbox + ✕ 三件套;可改为"可拖拽排序 / 优先级标记 / 关联 AC 编号"
- **关联仓库扩展**:目前只有 name + selected + icon;可加 branch / latestCommit / maintainer(issue 18 注:"后续接 agent 时扩展")
- **自动保存 UX**:目前是"已保存 · 12 秒前"静态文本;可加保存状态机(saving / saved / conflict)
- **资源树章节点击行为**:目前只展示;可加"点击 → 编辑器滚动定位" + "右击 → 重命名 / 删除章节"
- **草稿态恢复**:目前 lastSavedAt 是 mock;可加"上次未保存内容"对比 + "恢复 / 丢弃"
- **Cmd+K 唤起 Skill**:目前 Skill trigger 是 mock console.info;可对接 Cmd+K overlay 真正唤起
- **表单实时协作**:单人 mock;后续可接 SSE / Y.js 多光标

### 6.2 视觉

- **Form 容器高度**:目前 `min-h-[190px]` 编辑器;可改全屏编辑模式(Cmd+E)
- **空态引导**:目前空 AC 显示"尚无 AC,点击下方添加";可加 icon + CTA + sample
- **加载态 / 错误态**:目前 happy-path 渲染;三态(决策 30)未落地 → 加 skeleton / inline error
- **响应式**:目前桌面优先;移动端 / 窄屏适配未做(决策 31 不在范围)
- **暗色主题**:目前亮色是心智模型(决策 19);DRAFTING Form 在暗色下的对比度 / 阴影待验证
- **图标**:目前用 emoji;可换 lucide-react 与 Sidebar / ZoneBar 统一

### 6.3 数据 / 模型

- **drafting 数据 schema 扩展**:目前 mock;接 agent API 时需对齐 `apps/agent/src/zones/drafting.yaml` 的 `default_arming` 与 SKILL.md frontmatter
- **AC 类型**:目前只有 text;可加 priority / owner / dueDate / linkedTask(决策 70 回答载体)
- **PRD 大纲导出**:目前只展示在资源树;可加"导出大纲为 tasks.md 骨架"作为 ANALYZING 前的过渡
- **历史版本**:目前 lastSavedAt 单值;可借决策 47 snapshot 机制做版本对比

### 6.4 装备 Skill

- **候命 Skill 列表**:目前固定 3 个(brainstorm / clarify / schema-design);可由 `default_arming` 动态决定(`requirement-drafting` / `context-bootstrap`)
- **Skill 触发反馈**:目前 console.info;可加 toast / inline 提示 / Cmd+K overlay 真正唤起

---

## 7 · 版本与变更

| 日期 | 事件 |
|---|---|
| 2026-07-08 | 用户故事.md(原始 Vibecoding 7 步流程) |
| 2026-07-12 | ADR-0011 v1 → 11 轮 grilling → v1.0.1 重写(DRAFTING 从"Form 形态"升格为"工位 1") |
| 2026-07-12 | ADR-0012 工位注册表 13 字段 schema 落地 |
| 2026-07-13 | issue 18-zone-drafting.md ready-for-agent;DRAFTING 工位组件 + 数据层 + 测试全部落地 |
| 2026-07-13 | 提交 `2ffa5bd` feat(sdk-integration): P1 写队列(本期不涉及 DRAFTING 改动,只是邻近提交) |
| 2026-07-13 | **本文档创建**(DRAFTING 二次设计前的现状速读) |

> **下一步**:基于本文档的"二次设计可施展空间"提出设计方案,任何越界改动必须先回 ADR-0011 / ADR-0012 / CONTEXT.md(决策 51-57)。