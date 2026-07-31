---
title: Admission Pack Framework + Silent Session Admission UX
slug: admission-pack-ux
status: ready-for-agent
deciders:
  - 项目负责人(ADR-0021 经 15 轮 grilling / ADR-0022 经 11 轮 grilling)
related_adrs:
  - docs/adr/0021-admission-pack-framework.md
  - docs/adr/0022-silent-session-admission-ux.md
related_decisions:
  - CONTEXT.md 决策 24, 38-43, 61, 65, 67, 88-102
source_adrs_overlap:
  - ADR-0013 D4(5 维度)+ D10(原 frontmatter 方案)→ D1 升级到 Pack 装载
  - ADR-0013 D7/D11/D15 → SessionTabs / 待裁决 / 重扫 全部搁置或形态改造
  - ADR-0020 D14 → generate-brief 端点改为 410 Gone
  - ADR-0017 chunks.jsonl schema → 单行不变,新增 SSE verdict_finalized 事件
prototype_inputs:
  - docs/design/pages/22-history-sessions-prototypes.html(Variant A dropdown)
  - docs/adr/0021 113-129(algorithm DSL)
---

# Spec · Admission Pack Framework + Silent Session Admission UX

## Problem Statement

不同企业、不同部门、不同 PRD 在分析产品文档时,所侧重的规范约束和严格度都不一样。但当前实现把 5 个评估维度硬编码在 `apps/agent/skills/built-in/admission-check/SKILL.md` 的 markdown body 里,完全没有可装载入口;AdmissionDashboard UI 又把用户当数据录入员(要求填会话名 / 选「分析角度」4 选 1),同时还在推动 AI 主动触发的流程按钮(「⚠ 待裁决」「重扫」「生成技术概要」)。

结果:

- 切不到金融合规 / 等保 / 跨境数据 / 性能 / 未保 等不同领域的评估视角
- 同一组维度无法切换严格度(任何 🔴 fail → ❌ 是写死的)
- 用户每次跑分析都要填「会话名」,而 `session_id` 后端自动生成、`angle` 后端写死 `architecture`、`label` 自动派生 —— 用户填啥都没影响
- 「重扫」暗示会话是产物,而沉默多 session 下,「再按一次 ▶ 开始分析」就是新一份 session,按钮多余
- 「待裁决 / 重扫 / 生成技术概要」三按钮违背"AI 不推动流程"的信条

用户需要的两件事:

1. **Pack 装载模型**:能在 workspace 内自由装载任意评估规范(单元集 + verdict 算法),金融 / 互联网 / 教育各跑各自的 baseline
2. **沉默会话 UX**:每个 PRD + 每个 Pack 跑出来的产物是 silent 多 session,UI 不强迫用户当数据录入员、不推动流程

## Solution

### Part A · Admission Pack Framework(ADR-0021)

把"5 维度"从 Skill body 抽出来,固化为可在 workspace 内自包含分发的 **Admission Pack**:

- **三层抽象**:Admission Unit(评估视角,N 个)/ Admission Algorithm(verdict 规则集)/ Admission Pack(用户操作单位 = units + algorithm + UI hints)
- **物理布局**:`~/.aidevspace/admission/packs/<id>/` —— 每个 pack 自包含(`tar czf` 一键分发,`git clone` 直接挂)
- **装载作用域** = workspace / req / session 三层;本期只有 session 层(`POST /analysis/start` 必填 `pack_id`)
- **verdict 算法** = jq-simplified 表达式子集(~200-400 LOC TS),turn-1 结束 service 算 verdict,model 不算
- **退役 admission-check Skill**:`SystemPromptAssembler` 接收 `admissionLoader` 作为新 deps;分段标号渲染 admission prompt 到 system prompt 一段

### Part B · Silent Session Admission UX(ADR-0022)

把 ANALYZING 工位简化为「沉默多 session + Pack dropdown 选择器 + /history 历史出口」:

- **删除**:AdmissionDashboard `[+ 新建]`、「新建分析会话」弹窗、「⚠ 待裁决」按钮(搁置 ADR-0013 D11)、「重扫」按钮、「生成技术概要」按钮(搁置 ADR-0020 D14)
- **新增**:AdmissionDashboard 顶栏 Pack dropdown(localStorage 持久化 `aidevspace:<reqId>:lastPack`)+ /history 页面「分析会话历史」分区
- **路由改造**:`/analyzing?session=<sid>` 支持历史回看 SSR override(`loadSessionChunks` 接收 `{ explicitSessionId, activePackId, enabledPacks }`)
- **唯一 CTA**:「▶ 开始分析」—— POST body `{ pack_id: dropdown.value }`

## User Stories

### Pack 作者 / 企业管理员

1. 作为平台维护者,我想定义一组评估单元(资损 / 性能 / 架构冲突 ...)与对应 verdict 算法到 YAML,以便同一个 pack 可以被多个 workspace 加载
2. 作为平台维护者,我想把 pack 打包成 tarball / 发布到 git,以便 share 给其他 workspace
3. 作为平台维护者,我想复用 baseline-5dim 的 5 维结构 + 自定义 algorithm,以便不同严格度策略共存
4. 作为 pack 作者,我在 algorithm.yaml 表达式 syntax 错时收到降级 warning 而非 session 崩溃
5. 作为 pack 作者,我可以在 import 时复写一份 manifest,保证 manifest id 与目录名一致

### 行业工程师(金融 / 互联网 / 教育 ...)

6. 作为金融工程师,我想 load `finance-baseline-v1` pack,以便自动评估资本合规 / 等保 / 跨境数据
7. 作为互联网工程师,我想 load `web-baseline-v1` pack,以便自动评估性能 / 架构冲突 / 用户余额扣减一致性
8. 作为教育行业 PM,我想 load `education-baseline-v1` pack,以便自动评估未成年人保护 / 内容合规
9. 作为跨企业使用者,我在同一台机器上根据当前 PRD 切换 pack,以便不同 PRD 各跑各的视图
10. 作为 pack 用户,dropdown 显示每个 pack 的 unit 数 + algorithm 名,以便了解当下评估广度与严格度
11. 作为 pack 用户,切换 pack 不会立即触发 session 重建,以便我可以先选好再按「▶ 开始分析」
12. 作为错误排查者,pack_id 不在 enabled_packs 时收到 400 + `available_packs` 列表,以便知道怎么修正

### ANALYZING 工位普通用户

13. 作为日常使用者,打开 /analyzing 就能看到 PRD 准入状态与一份 session 内容,不必填任何表单
14. 作为日常使用者,我不想被 UI 强迫命名会话或选「分析角度」,整个 flow 是 PRD 驱动
15. 作为日常使用者,按一次「▶ 开始分析」就创建一份 silent session,每次时间点的产物都独立可回看
16. 作为日常使用者,dashboard 显示当前 dropdown pack 的最新 session 与 verdict 徽章,context 不会断
17. 作为历史回访者,/history 列出每次跑(session)的 pack 名 + 时间 + verdict,以便快速挑选哪天产物
18. 作为历史回访者,/history 列表的「查看」按钮跳到 `/analyzing?session=<sid>`,直接看原文 + chunks.jsonl + verdict
19. 作为日常使用者,dropdown 切 pack 后立即刷新该 pack 的最新 session,一眼可对比同一 PRD 在两视角下的产物
20. 作为多 pack 共享者,同一 pack 在不同 PRD / 不同时刻可并存多份 session,各自独立
21. 作为首次使用者,空 session 时看到「按一下 ▶ 开始分析 开始你的第一次分析」引导
22. 作为多设备用户,我接受 localStorage 跨设备不同步(本期不强求 workspace 级持久化)

### AI 评估者(model)

23. 作为 AI 评估者,我在 system prompt 看到清晰分段的「`### N. <id> (<displayName> · <severity>)`」与 `output_marker: '[DIM <id>]'`,输出可被 parser 准确识别
24. 作为 AI 评估者,我**不被**要求算 verdict;turn-1 只输出 per-dimension judgment,service 层在 turn-1 结束算 verdict
25. 作为 AI 评估者,verdict 失败时不进入 override 交互,只是信息展示(搁置 ADR-0013 D11)

### Web UI 内部行为

26. 作为 web UI,AdmissionDashboard 顶栏展示「📦 Pack: <dropdown> · <units> · algorithm: <name>」一行
27. 作为 web UI,dashboard 顶部一次性 hint「切换不会立即生效,按 ▶ 开始分析 才用此 Pack」,dismiss 后不再显示
28. 作为 web UI,/analyzing 路由 SSR 阶段读 `?session=<sid>`:命中 → 显式 sid;不命中 → dropdown 当前 pack 最新 → enabled_packs[0] 最新 → 空态
29. 作为 web UI,/history 页面把 active pack 的最新 session 标 `active` 高亮
30. 作为 web UI,AdmissionDashboard 不再展示「+ 新建」「⚠ 待裁决」「重扫」「生成技术概要」按钮,保留 Linear 紧凑风格

## Implementation Decisions

### 数据契约

- 新类型 `packages/shared/src/admission.ts`:`Verdict = '✅' | '⚠️' | '❌'`、`UnitJudgment`、`PackVerdict`、`AdmissionUnit`、`AdmissionAlgorithm`、`AdmissionPack`、`AdmissionPackManifest`(schema 来自 ADR-0021 行 233-302)
- 现有 types 不动:`AdmissionDimensionIdSchema`(5 维度 enum)、`AdmissionChunkVerdict`、web `AdmissionVerdict = 'pass' | 'pending' | 'fail'`
- chunks.jsonl 单行 schema 不变(ADR-0017);**新增** SSE 事件 `verdict_finalized`(`type / reqId / sessionId / ts / verdict`)

### 模块边界

- **新增** `apps/agent/src/admission/`:
  - `packLoader.ts` —— `AdmissionPackLoader` + manifest / unit / algorithm YAML 解析 + V-3 校验
  - `algorithmInterpreter.ts` —— jq-simplified 解释器(10 个语法元素,~200-400 LOC TS)
  - `algorithmValidator.ts` —— 表达式 syntax 校验 + 结构校验
  - `baselineGenerator.ts` —— `baseline-5dim` 首启 hook 自动生成(应用 bundle 不携带)
- **改造** `apps/agent/src/prompt/SystemPromptAssembler.ts` —— `AssemblerDeps` 增 `admissionLoader` 字段
- **删除** `apps/agent/skills/built-in/admission-check/SKILL.md`(SkillLoader 仍可加载但 admission 段不使用)
- **改造** `apps/agent/src/routes/analysis.ts` —— start handler body 收紧为 `{ pack_id: string }`,新增 `GET /api/requirements/:id/analysis/enabled-packs`,`generate-brief` 改为返 410 Gone + `{ error: 'feature_disabled' }`

### 物理 / 持久化

- 物理目录:`~/.aidevspace/admission/packs/<id>/` —— `manifest.yaml` + `units/<id>.yaml` + `algorithm.yaml`
- workspace 配置:`~/.aidevspace/config.yaml` 增 `analysis.enabled_packs: [...]`
- 导入入口:CLI single source of truth `aidevspace pack import <path|url>`,Web UI 调 CLI
- built-in pack:应用 bundle 不携带;首启 hook 自动生成 `baseline-5dim` 到 workspace(K-B 形态)
- 导入来源:本地目录(开发 / 测试)+ Git URL(发布 / 共享,`git+https://...#subdir=...&ref=...` 格式)

### 算法 DSL

```yaml
# algorithm.yaml(prototype 来自 ADR-0021 行 113-129)
id: finance-strict
displayName: 金融严格策略
rules:
  - id: blocker_fail
    when: 'any(units[]; .severity == "🔴" and .verdict == "fail")'
    result: '❌'
    reason: '存在红线级 fail'
  - id: any_warn
    when: 'any(units[]; .verdict == "warn")'
    result: '⚠️'
    reason: '存在 warn 维度'
  - else:
    result: '✅'
    reason: '全部维度 pass'
```

支持的子集:`.field` / `==` / `!=` / `and` / `or` / `not` / `any(arr; pred)` / `all(arr; pred)` / `[arr | select(pred)]` / `length` / `count` / `true` / `false` —— 自写解释器,不用 JSONLogic / Python / 完整 jq

### API 契约

| 端点 | 契约 |
|---|---|
| `POST /api/requirements/:id/analysis/start` | body 收紧为 `{ pack_id: string }`(去掉 `angle` / `label` / `session_id`);`pack_id` 不在 enabled_packs → 400 `{ error: 'pack_not_enabled', reason, available_packs: [...] }`;装载失败 → 500 + V-3 错误体 |
| `GET /api/requirements/:id/analysis/enabled-packs` | 新增,返 `{ packs: Array<{ pack_id, displayName, unitsCount, algorithmName }> }`(dropdown 数据源) |
| `GET /requirements/:id/analyzing?session=<sid>` | 新增 query 解析,SSR 阶段命中 → 显式 sid;无 query → fallback 链 |
| `POST /api/requirements/:id/analysis/generate-brief` | 改为 `410 Gone + { error: 'feature_disabled', message: 'tech-brief 已在 ADR-0022 中搁置;请使用 ADR-0021 Pack 装载模型' }`,stub 保留 |

### 装载校验 V-3

| 层级 | 错误 | 处理 |
|---|---|---|
| 结构 | YAML parse 失败 / 缺必填字段 / manifest id ≠ 目录名 | fail-fast(500)|
| 结构 | unit / algorithm 文件缺失 / unit 缺 `admissionPrompt` / `outputMarker` 跨 unit 冲突 | fail-fast |
| 语义 | algorithm 表达式 syntax 错 / unit 重复 / algorithm 规则 id 重复 | 降级 warning + 跳过该规则 + session 仍跑 |

### session_id 格式

后端自动生成 `sess-<packId>-<Date.now().toString(36)>`(与原 `sess-<angle>-<ts>` 一致模式,维度换 packId)

### front-end 持久化

- localStorage key `aidevspace:<reqId>:lastPack`,fallback 链:localStorage 该 reqId → `enabled_packs[0]` → 强制 `baseline-5dim`
- dropdown 切换只写 localStorage,不立即触发 session
- 「▶ 开始分析」按下去时同步写 localStorage 与 POST body

### 沉默多 session

- 后端:`_index.yaml` 多会话索引 + `sessions/<sid>/chunks.jsonl` 目录结构不变
- 前端:**不挂载** `<SessionTabs>`(组件代码保留,v1.1 重启时再用)
- 同一 PRD + 同一 pack 可并存多份 session(`_index.yaml` 持续 append)

### SSR session 解析

`loadSessionChunks(requirementId, { explicitSessionId, activePackId, enabledPacks })`:
优先级链 1. `explicitSessionId`(来自 `?session=<sid>`,sess 存在性校验,无效 → fallback)
2. `activePackId` 的 latest session
3. `enabled_packs[0]` 的 latest session
4. 空态("按一下 ▶ 开始分析 开始你的第一次分析")

### 搁置 features(代码 stub 保留,UI 不挂载)

- `generate-brief` 端点 → 410
- 「⚠ 待裁决 / 接受风险」override 交互(ADR-0013 D11)
- 「重扫」独立按钮
- tech-brief 整条线(ADR-0013 D8 / ADR-0020 D14)
- 模块文件 `modules.yaml` / `adjudication.md` 不再被代码主动写;`admission-check/SKILL.md` 删除

### 配套清理

- 删 `apps/agent/src/routes/analysis.ts` 内 `simulateInterjectChunks`(`analysis.ts:170-211`)与 `buildMockBriefArtifacts`(`analysis.ts:567-644`):ADR-0022 #14 标"无 UI 消费"清理目标
- 删 AdmissionDashboard `接受风险` 按钮(`admission-dashboard.tsx:130-139`,verdict=fail 的 override 路径不再存在)

### 故障语义

- HTTP 错误体形态:`{ error: code, reason: string, available_packs?: string[] }`
- `?session=<sid>` 校验 sid 存在性,无效 → fallback 链
- 风险 hint:AdmissionDashboard 顶部一次性「切换不会立即生效」,dismiss 后不再显示

### 决策依赖

| 决策 | 来源 | 是否覆盖 |
|---|---|---|
| 维度数量 N 自描述 | ADR-0021 D1 | 新增 |
| turn-1 受 pack 控制,turn-2 不受 | ADR-0021 D2 | 新增 |
| algorithm 写到 pack 自包含 | ADR-0021 D3 | 新增 |
| 三层装载作用域 | ADR-0021 D4 | 部分(session 层实装,req/workspace v1.1)|
| pack 物理布局 + id 命名空间 | ADR-0021 D5/D9 | 新增 |
| 分段标号 prompt 渲染 | ADR-0021 D6 | 新增 |
| 干 admission-check Skill | ADR-0021 D7 | **覆盖 ADR-0013 D4/D10** |
| jq-simplified 表达式 + 解释器 | ADR-0021 D8/D12 | 新增 |
| `POST /start` body 必填 `pack_id` | ADR-0021 D10 | **覆盖 ADR-0020 start handler 入参** |
| V-3 装载校验分层 | ADR-0021 D14 | 新增 |
| id 冲突禁止覆盖 | ADR-0021 D15 | 新增 |
| `enabled_packs` + 本地 / Git 导入 | ADR-0021 D13 | 新增(batch 4)|
| 删 d 入参 + 弹窗 | ADR-0022 D1 | **覆盖 ADR-0020 start 入参 + ADR-0013 D11 弹窗** |
| 沉默多 session + 不挂载 SessionTabs | ADR-0022 D2 | 改造 ADR-0013 D7 落地形态 |
| 按一次 = 1 session | ADR-0022 D3 | 新增 |
| Pack dropdown + 元数据行 | ADR-0022 D4 | 新增 |
| localStorage lastPack 持久化 | ADR-0022 D5 | 新增 |
| dropdown 当前 pack 的最新 session | ADR-0022 D6 | 改造 SSR 入口 |
| 收纳按钮集合 | ADR-0022 D7 | **覆盖 ADR-0013 D8/D11/D15 + ADR-0020 D14** |
| /history 分区 + ?session= 回看 | ADR-0022 D8 | 改造 /history mock |
| 「▶ 开始分析」POST body 单一 | ADR-0022 D9 | 同 ADR-0021 D10 |

## Testing Decisions

### 测试原则

**只测外部行为**(API 响应 / JSONL 解析 / SSE 事件 / UI 渲染 / 文件系统产物),**不测内部 loader 算法实现细节**。

### 测试 seams(高层优先 — 越少越好)

| Seam | 目的 | 位置 |
|---|---|---|
| API 顶层 | pack_id 必填 / enabled_packs 校验 / 装载失败 | `routes/analysis.ts:285-418` + `__tests__/routes-analysis-start.test.ts` |
| Enabled-packs 端点 | dropdown 数据源返正确 + 缺 config 处理 | 新 `__tests__/routes-analysis-enabled-packs.test.ts` |
| generate-brief 410 | stub 行为不变 | 现有 `routes-analysis-generate-brief.test.ts` 改断言 |
| Algorithm 解释器 | 10 个语法元素 + hit/else 分支 | 新 `apps/agent/src/admission/__tests__/algorithmInterpreter.test.ts` |
| Pack loader V-3 | 结构 fail-fast + 语义降级 + baseline 生成 | 新 `apps/agent/src/admission/__tests__/packLoader.test.ts` |
| SystemPromptAssembler deps | admission loader 装配进 base prompt + 不渲染 admission skill body | 现有 `__tests__/SystemPromptAssembler.test.ts` 扩展 |
| AdmissionDashboard dropdown | 渲染 + 切换写 localStorage + start POST body | 现有 `analyzing-admission-dashboard.test.tsx` 扩展 |
| analyzing-zone 不挂载 SessionTabs | 组件不再 render;删除 `接受风险` 按钮 | 现有 `analyzing-zone.test.tsx` 扩展 |
| SSR `?session=` override | 命中显式 sid + 无 query fallback 链 + 无效 sid fallback | 新 `apps/web/src/lib/__tests__/analyzing.server.test.ts` |
| /history 分析会话分区 | SSR 读 `_index.yaml` + active 高亮 + 「查看」跳 /analyzing?session= | 新 `apps/web/src/__tests__/analyzing-history-sessions.test.tsx` |

### prior art

- **API seam**:沿用 `routes-analysis-start.test.ts` 的 Fastify + `createSilentProvider` pattern(行 19, 118)
- **UI seam**:沿用 `analyzing-admission-dashboard.test.tsx` / `analyzing-zone.test.tsx` 的 jsdom 渲染 pattern + `data-testid` 锚点(`admission-start-btn` / `admission-verdict-badge`)
- **Chunk parser 验证**:沿用 `analysis-chunk-parser.test.ts` 的 `[DIM]/[VERDICT]` parse 风格

### 等价测试(尤其要)

`baseline-pack-equivalence.test.ts`(新):同一 PRD × 旧 `admission-check` Skill vs 新 `baseline-5dim` pack → per-dimension + overall verdict 对照(5 样本,ADR-0021 风险缓解明确要求)

### 不写测试的边界

- YAML parser 内部错误栈
- jq 解释器 AST 形状
- `tar` / `git clone` 进程退出码(底层单元测)
- localStorage 同步原语

## Out of Scope

- Pack 版本锁定(`pack@version` 引用)—— v1.1 留位
- Req 级 override(`/requirements/<id>/analysis/config.yaml`)—— v1.1 留位
- Workspace 级 `lastPack` 持久化(`~/.aidevspace/config.yaml` per-reqId)—— v1.1 留位
- Pack import 进度反馈 / 后台任务(Git clone 慢)—— v1.1 留位
- 全文 jq 支持 —— 仅 ADR-0021 D8 列出的 10 个语法元素
- 算法编辑器 Web UI —— CLI 单独写
- tech-brief 端到端能力(ADR-0013 D8 / ADR-0020 D14)—— 搁置
- 「⚠ 待裁决 / 接受风险」override 交互(ADR-0013 D11)—— 搁置
- 「重扫」独立按钮 —— 改为「再按开始 = 新 session」
- Turn-2 requirement-brainstorm 装载 —— 本 ADR 范围外
- 全球算法目录(跨包复用 algorithm)—— algorithm 写到 pack 自包含
- Pack 在 workspace 内的 enable / disable UI —— ADR-0021 Batch 4(本期不实装)
- 多语言 verdict 输出 + algorithm reason 翻译
- 多 session 文件清理策略(30 天 snapshot)—— 本期不实装

## Further Notes

### 兼容性

- `admission-check/SKILL.md` 删除前必须先跑 baseline 等价测试(同一 PRD × 旧 Skill vs 新 pack = 5 样本 × per-dim + overall 全等)
- chunks.jsonl 单行 schema 完全不变,旧 session 文件继续可读
- 双 turn 编排(SSE / chunk parser / verdict_finalized 之后 turn-2)沿用 ADR-0020 不动
- Session 文件系统结构(`sessions/<sid>/chunks.jsonl`)与 `_index.yaml` append-only 行为不变
- 现有 `AdmissionDimensionIdSchema`(5 维度 enum)与 `AdmissionChunkVerdict` / web `AdmissionVerdict` 类型仍存在,但其硬编码来源从 Skill body 改为 `baseline-5dim` pack 数据

### 风险与缓解

| 风险 | 缓解 |
|---|---|
| baseline-5dim 与原 admission-check Skill 不等价 | baseline-pack-equivalence.test.ts(5 样本 × per-dim + overall)|
| 算法解释器引入未测试语法 | MVP 仅 10 个语法元素;新语法须加测试 + 文档 |
| pack_id 不在 enabled_packs 让用户迷茫 | 400 错误体带 `available_packs` 列表 + UI 引导启用 |
| 用户写错 pack 不知哪里错 | V-3 分层:结构错给"哪个字段错了",语义错给"哪条规则被跳过" + warning log |
| 跨 pack 同名 unit 内容漂移 | 单元 = pack 内私有(自包含);冲突由 enabled_packs 唯一性保证 |
| `enabled_packs` 改了,旧 session 怎么办 | session 装载时快照 pack 到内存;`enabled_packs` 变化不影响进行中 session |
| 多 session 文件无界增长 | 沿用 ADR-0009 D47 的 30 天 snapshot 清理机制;`aidevspace analysis cleanup` CLI 留 v1.1 |
| dropdown 切换不立即生效被误解 | 顶部一次性 hint「切换不会立即生效,按 ▶ 开始分析 才用此 Pack」|
| localStorage 跨设备不同步 | 本期仅 localStorage;workspace 级 lastPack 留 v1.1 + ADR-0021 D4 req 级 override 一起做 |
| `/analyzing?session=<sid>` 与无 query SSR 行为不一致 | RSC 入口函数统一处理;query 优先级明确;无效 sid fallback 链 |
| 「待裁决」消失后 verdict=fail 没法 override | 用户可手动 disable 该 Pack + 切到另一 Pack 重跑(系统层面强制重决策),或接受 verdict=fail 继续推进后续工位 |

### 后续维护边界

- 任何"在 PRD 层管 override"的功能 → v1.1,本期一律不实装
- "在 workspace 层管 pack 启用"的具体 UI → ADR-0021 Batch 4,本期不做
- 算法解释器的语法扩展 → 必须加测试 + 文档,不"加 feature without coverage"

### 决策变更触发条件

- 若发现 pack 装载成为高频性能瓶颈 → 评估 pack 缓存层
- 若发现同一 pack 同 PRD 频繁 1 周内 > 20 次 → 引入清理策略
- 若用户反复请求「待裁决 / 接受风险」 → 启动 v1.1 ADR 重新讨论 override 路径
