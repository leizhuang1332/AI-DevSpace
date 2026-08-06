---
status: accepted
updated: 2026-08-06 · D5 UI 表现段补注(toggle 展开态才显示 transcript)
---

# TaskCard transcript 独立存储 + Run 路径不动(ADR-0028)

[ADR-0027](0027-board-section-intro.md) 引入 board 详情页右侧抽屉承载 AI 协作 transcript。本 ADR 决定该 transcript 的**存储形态**、**与父 analyzing transcript 的隔离边界**、**与 Run 发起点的关系** —— 三件事一起定,确保 ADR-0023(`Analysis Run 必须覆盖真 MCP server 路径`)的守门在 board 引入后不被绕过。

## 背景与现象

### 现状 transcript 模型

当前 transcript 全部归属于 **Requirement 级**:

- `~/.aidevspace/requirements/<req-id>/analyzing/transcript.yaml` —— 全部对话历史
- 单一 transcript,顺序追加 user/assistant 消息
- transcript 是 Analysis Run 发起时的输入上下文(decision-pending:Run prompt 会注入最近 N 条 history)
- Analysis Issue Response 也存储在 transcript 中或紧邻位置(详见 ADR-0021)

### 烤时 4 套候选 + 用户的选择

烤过 transcript 模型时,4 套候选被提出,用户 12 轮选择 **方案 B**:

| 方案 | 父子 transcript 物理关系 | 用户感受 |
|---|---|---|
| A. 共享 Requirement transcript | board 详情 embedding 父 transcript 视图 | transcript 长,跨 task 上下文断裂感 |
| B. 每 TaskCard 独立 transcript(用户选) | 每张卡片一份,物理隔离 | 每 task 上下文轻,管理简单 |
| C. 共享 + thread 隔间 | 物理共享 + 视图过滤 | thread_ids 贴错导致上下文错位 |
| D. 详情只存静态描述 | 没有 transcript,跳父 analyzing | 图 2 形态做不到,产品不达期望 |

### 但 B 的副作用:Run 路径

B 方案隐含"详情页能不能发 Run"的关键问题。12 轮后又分 4 套:

| Run 范围 | 含义 | 副作用 |
|---|---|---|
| a. task 详情页能发 Run | Run 产物落 `board/tasks/<id>/artifacts/` | 触发 ADR-0023 守门范围扩大 |
| b. Run 只走父 analyzing(用户选) | 详情页 transcript 仅描述,Run 路径不动 | ADR-0023 守门零改动 |
| c. 两路并存(默认不推荐 task) | a/b 都行,但 UI 默认不推荐 | 路径分裂 |
| d. 其它 | — | — |

用户选 b:**task 详情页仅描述,Run 只走父 analyzing**。

## 决策

### D1. TaskCard transcript 物理独立

**存储位置**:

```
~/.aidevspace/requirements/<req-id>/board/tasks/
├── <ulid>.json                                  # TaskCard 主 JSON
└── <ulid>/
    └── transcript.yaml                            # 物理隔离 transcript
```

- 每个 TaskCard 自带独立 transcript 目录
- transcript.yaml 形态与父 analyzing.transcript.yaml 相同(消息流,user/assistant + tool_calls + ts + role)
- 同一 Requirement 下 N 张 TaskCard = N 个 transcript 文件,互不干扰
- 子卡片 与 父卡片 各自一份 transcript,**不继承**(B 方案物理独立)

### D2. transcript 仅描述,不挂 Run

**TaskCard transcript 的边界**:

- **允许**:用户输入文本 / AI 描述性回复 / 引用父 PRD 段落 / 引用 Run 产物(只读 link)
- **不允许**:发起 Run / 调用业务工具 / 写文件 / 改 TaskCard 字段 / 改 Requirement 字段
- 详情页右侧抽屉 UI **不渲染"开始 Analysis Run"按钮**(对比 analyzing section 详情有 `[开始分析]` 按钮)
- 详情页右抽屉底部 AI 输入框**不含 Run 触发选项**

**Run 路径不动**:

- 所有 Run(Analysis Run、Skill Run)继续走父 Requirement.transcript,**Run 产物的 `analysis/`、`artifacts/` 仍是父级**
- TaskCard transcript 与 Run 之间**只能单向引用**:详情页右抽屉可显示"本对话引用了 Run #17 的产物"链接,跳到 analyzing section 历史(决策 88-98 的 FAB + 浮动面板)
- 反之不行:Run 上下文不知道 TaskCard 存在,Run prompt 也不注入 TaskCard 字段

### D3. 与父 analyzing transcript 的关系

| 维度 | 父 analyzing transcript | TaskCard transcript |
|---|---|---|
| 物理路径 | `~/.aidevspace/requirements/<id>/analyzing/transcript.yaml` | `~/.aidevspace/requirements/<id>/board/tasks/<ulid>/transcript.yaml` |
| Run 起点 | ✅ 是 | ❌ 否 |
| AI 身份 | Analysis Assistant(决策 175-186) | 协作型 assistant(占位,具体身份由父 transcript 派生) |
| transcript 上下文来源 | 自身累积 | 父 transcript 历史快照 + 当前 TaskCard 字段 |
| 删除父 transcript | 全部 TaskCard transcript 保留(快照仍在) | 不变 |

**派生行为**:

- 用户在 board 详情发送第一条消息 → agent 把父 analyzing transcript 的最后 K 条(K=10,impl 阶段定)作为上下文快照传入,新 transcript 起第一条 user 消息被注入这条上下文
- 后续 TaskCard transcript 自累积
- 父 transcript 不会反向流改(TaskCard transcript 不"回流")

### D4. ADR-0023 守门 zero-touch

| 守门条款 | 本 ADR 行为 |
|---|---|
| 改 `ClaudeCodeProvider.runAnalysisQuery` 必须先有 e2e 测试 | **不触发**:本 ADR 不改 Provider |
| `AnalysisRunService.toolUseIndex` 闭包隔离 | **不触发**:Run 仍走父 transcript |
| 状态隔离(`clearToolUseIndexForRun`) | **不触发**:board 详情不挂 Run,toolUseIndex 与 board 路径无关 |
| `createSdkMcpServer` 包装 | **不触发**:board 详情不调 SDK |
| zod schema 形态 | **不触发**:Run 输入契约不变 |

实施期间如需在 board 详情触发 Run(被路由层或 sdk 层意外扩散),**必须**先在 `apps/agent/src/__tests__/analysis-run/analysis-run-mcp-e2e.test.ts` 加 RED 测试,再 GREEN 才能合入(沿用 ADR-0023 D2)。

### D5. UI 表现:transcript 视图(toggle 展开态才显示)

> v1.0.7 补注:transcript 物理位置 = board 详情页右栏(toggle 展开态);**默认态右栏 = 属性表**(详见 [ADR-0027 D5.1](0027-board-section-intro.md))。本节描述展开态的 transcript 形态,默认态不在此处展开。

```
┌─ AI 协作(transcript · TASK-A) ──────────┐
│ [12:34] 引用父 PRD §2 ...             │  ← 引用 PRD 段落(只读 link)
│ [12:35] 我想澄清 webhook 处理顺序 ...  │  ← user 消息
│ [12:35] AI 建议: ...                 │  ← assistant 描述性回复
│ [12:40] 📎 引用 Run #17 产物(/analysis) │  ← 引用父 Run 产物
│                                      │
│ ──────── 当前对话 ────────            │
│ [textarea:输入...]                   │  ← 输入框(可描述、不可发 Run)
│                                      │
│ [✕ 收起]    [发送 ⌘+↵]  [插入 Run 引用 #___] │ ← 按钮列表(含属性收起按钮)
└──────────────────────────────────────┘
```

- **位置**:board 详情页右栏(1/3 = 320px),toggle 展开态才显示;默认态右栏 = 属性表
- **触发**:右栏顶部按钮 toggle(默认态 = `[💬 在对话中打开]` → 点击 → 展开;展开态 = `[✕]` → 点击 → 收回到默认态)
- **过渡动画**:右栏内容 fade-in + right-slide 8px(~250ms)
- 抽屉总是 read tail(pull latest),不显示 history(用户可用 Cmd+K 进 board 历史)
- 抽屉底部不渲染 `[+ Skill]` `[+ Run]`(对比 analyzing section 有这些)
- 输入框可粘贴 Run 引用 ID(`#17`)、可上传 asset,但**唯一提交动作 = 文本消息**
- 收起按钮:展开态右栏顶部 `✕`;点击后右栏切回属性表(回默认态,符合决策 24「克制,在场」)
- **不持久化**:每次进入 board 详情页从默认态开始(沿用 [ADR-0022](0022-analyzing-history-floating-action-button.md) D4.4 决策 + 决策 24「克制,在场」)

### D6. transcript 文件 schema

```yaml
# ~/.aidevspace/requirements/<id>/board/tasks/<ulid>/transcript.yaml
schema_version: 1
task_card_id: <ulid>                  # 反向引用主 JSON
parent_transcript_snapshot:           # 父 transcript 的快照(派生时一次性拍)
  snapshot_at: 2026-08-06T12:34:56Z
  messages_count: 10
  snapshot_hash: sha256:abc...        # 用于检测父 transcript 后续变化
messages:
  - ts: 2026-08-06T12:35:00Z
    role: user
    content: |
      我想澄清 webhook 处理顺序
    refs:
      - kind: prd_section
        path: requirement.md
        line_range: [12, 18]
  - ts: 2026-08-06T12:35:30Z
    role: assistant
    content: |
      建议先考虑 ...(文本回复,不调工具)
    tool_calls: []                     # 始终空数组(TaskCard transcript 不发 Run)
```

`schema_version` + `snapshot_hash` 用于未来 schema 升级时识别老文件。

## 不在范围内

- **Run 路径的二次评估**(Run 是否要从 analyzing 迁到 board)—— 本期 ADR 明确"不动",任何相反提案需新立 ADR
- **TaskCard transcript 的归档策略**(status='done' 时是否冻结 transcript)—— 留给后续 ADR,本期 status='done' 不动 transcript
- **TaskCard transcript 内容是否进入 Run 输入**(即 Run prompt 是否注入 TaskCard transcript 历史)—— 不进(本 ADR D2 明确隔离)
- **transcript 长度上限 / 滚动策略** —— 留 impl 阶段
- **detail transcript 与 detail 内容(content)字段的关系** —— 独立(content 是 Markdown 静态描述;transcript 是对话流)
- **transcript 输入形式**:文本 / 富文本 / Markdown 文件 —— 本期纯文本;附件如资产上传走父 analyzing 处理

## 主要取舍

- **选择「TaskCard transcript 不挂 Run」而不是「详情页内嵌 Run 能力」**:后者会把 ADR-0023 守门范围扩散到 board 详情页,触发 e2e 测试重写;前者保持守门零改动
- **选择「transcript 派生父 transcript 快照」而不是「transcript 实时引用父 transcript」**:快照让 TaskCard transcript 有稳定上下文(Run 跑完不再改变父 transcript 的派生上下文);实时引用会让"父 transcript 改了 → TaskCard transcript 上下文跳变"
- **选择「schema_version + snapshot_hash」而不是「无 schema 字段」**:TaskCard transcript 是新产物,初期就有 schema 字段避免未来升级痛
- **选择「task transcript 仅描述 / 不调工具」而不是「task transcript 同 analyzing 一样支持工具调用,但 default off」**:前者边界硬,后者实现复杂且诱惑用户开工具调用

## 关联

- **上游**:
  - [ADR-0024](0024-taskcard-card-model.md) D4 物理存储 = board/tasks/<ulid>/transcript.yaml
  - [ADR-0027](0027-board-section-intro.md) D5 详情页右侧抽屉 = 本 ADR D5 UI
- **下游**(后续可能派生):
  - v1.0.7+:TaskCard transcript → Run 引用格式的具体化(`#17` 解析逻辑)
  - v1.0.7+:transcript 归档策略
- **继续生效**(不改动):
  - [ADR-0021](0021-analyzing-skill-driven-analysis-runs.md) Analysis Run 协议 = Run 入口仍在父 analyzing section
  - [ADR-0022](0022-analyzing-history-floating-action-button.md) FAB + 浮动面板 = Run 历史切换 UI = 详情页右抽屉的"📎 引用 Run #17"链接目标
  - [ADR-0023](0023-mcp-server-path-coverage.md) MCP 守门 = 本 ADR D4 zero-touch
- **实现位置**:
  - transcript 服务:`apps/agent/src/services/board/TaskCardTranscript.ts`(新增)
  - 详情页右抽屉 UI:`apps/web/src/components/board/CardTranscriptPanel.tsx`(新增)
  - 输入组件:`apps/web/src/components/board/CardTranscriptInput.tsx`(新增)
  - 数据模型:`packages/shared/src/task-card.ts` 加 `TaskCardTranscriptSchema`
  - 引用解析:`apps/agent/src/services/board/TranscriptRefParser.ts`(新增,解析 `#17`)
