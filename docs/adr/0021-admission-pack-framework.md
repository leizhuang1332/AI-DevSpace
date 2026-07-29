# ADR-0021: 准入评估框架(Admission Pack Framework)—— 让"5 维度"真正成为可装载的组合

**Status:** Proposed
**Date:** 2026-07-29
**Deciders:** 项目负责人(经 `/grill-with-docs` 共识,15 轮)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 24, 38-43, 61, 67

**关联 ADR:**
- [ADR-0013](0013-analyzing-zone-rewrite.md) — D4 准入维度 / D5 术语 / D10 准入维度可配置(原 frontmatter 方案)。本 ADR 是 D10 的**完整落地形态**,把"可配置"从 Skill frontmatter 的局部扩展,提升为独立的 workspace 装载机制
- [ADR-0020](0020-analyzing-real-prd-analysis-onboarding.md) — start handler 接 SDK + 双 turn 编排;本 ADR 在其 system prompt 装配链上叠加 admission pack 装载
- [ADR-0010 Q5](0010-system-prompt-assembly.md) — `SystemPromptAssembler` 装配链;本 ADR D5 / D6 在其上注入 admission loader 作为新 deps
- [ADR-0008](0008-skill-arming-depths.md) — Skill 三档装填;本 ADR **取代** `admission-check` Skill 在 turn-1 中的角色

**覆盖 / 补充:**
- **覆盖(取代)**:`apps/agent/skills/built-in/admission-check/SKILL.md` —— admission-check Skill **整个退役**;turn-1 prompt 由 admission pack 渲染机制接管
- **覆盖(取代)**:`apps/agent/src/routes/analysis.ts` 内 `createDualTurnAssembler` 对 admission-check Skill body 的额外追加 —— 删(原因为"pack body 在 base 已渲染,二次追加造成重复")
- **覆盖(取代)**:admission-check `SKILL.md` 内硬编码的 5 维度列表 + severity 表 + verdict 规则 → 拆为 `~/.aidevspace/admission/packs/baseline-5dim/{manifest,units/*,algorithm}` 三类文件
- **补充**:`apps/agent/src/prompt/SystemPromptAssembler.ts` 接 `admissionLoader` 作为新 deps
- **新增**:`packages/shared/src/admission.ts` —— `UnitJudgment` / `Verdict` / `Pack` 三类核心类型
- **新增**:`apps/agent/src/admission/` —— `AdmissionPackLoader` / `algorithmInterpreter` / `algorithmValidator` 三个模块
- **新增**:`~/.aidevspace/admission/packs/` 工作区目录(物理) + `enabled_packs` 字段(逻辑)
- **不覆盖**:ADR-0013 D4 / D5 / D11-D15 任何既有决策(准入维度卡片 UI / 待裁决 / 重扫等保持不变)
- **不覆盖**:ADR-0017 D1-D6(chunks.jsonl schema 不变,仅 SSE 增加 `verdict_finalized` 事件)
- **不覆盖**:ADR-0020 start handler 的双 turn 编排;只在 turn-1 的 system prompt 装配处介入

---

## Context

### 起点

ADR-0013 D4 把"5 维度"固化为 ANALYZING 工位准入校验的核心机制:D4 定义了 5 个维度(`loss_prevention` / `performance` / `arch_conflict` / `business_reasonable` / `context_query`) + 5 级 severity 表 + 总体 verdict 规则(任一 🔴 fail → ❌)。D10 提出"准入维度可配置"的远期方向(Skill frontmatter `admission_dimensions:` 声明 + `add` / `skip` 覆盖)。

ADR-0020 把分析工位正式接通 Claude Code SDK,turn-1 跑 admission-check Skill。**但当前 admission-check Skill 的 5 维度硬编码在 markdown body 里**,完全没走 D10 描述的可配置路径。

用户需求(2026-07-29 触发):
> 不同企业或不同部门,甚至不同需求,分析产品文档时的侧重点都不一样,所以我需要做到能灵活配置自由装载任意规范约束。

### 痛点

1. **5 维度是"写死的"**。换金融 / 互联网 / 教育场景 → 仍然跑同一组 5 维度;损失防控要变成"金融合规 / 等保 / 跨境数据"等没有入口。
2. **verdict 规则硬编码**。`[DIM loss_prevention] fail → ❌` 这条规则绑死在 markdown 里;同一组维度在不同严格度下行为不可调。
3. **Skill = "prompt 片段"的定位被 admission-check 用歪**。Skill 是平台固化的资产(admission-check / requirement-brainstorm / tech-brief-scaffold / requirement-critique 共 4 个,放 `apps/agent/skills/built-in/`),而 admission 维度是**用户运行时配置**;把这两件事绑在一起,既限制了 Skill 系统的稳定性,也限制了 admission 维度配置的灵活性。
4. **D10 的 `admission_dimensions:` frontmatter 方案从未落地**。决策 67 已锁定但代码层面空缺。
5. **"自由装载任意规范约束"无载体**。用户既不能在 workspace 内组合,也不能从 Git URL / 本地目录拿第三方 pack 进来。

### 真实场景(决定性输入)

金融企业 A 的工程师打开 ANALYZING 看 PRD-001;他应该自动套用金融业基线 pack(资损 + 资本合规 + 审计追溯 + finance-strict 算法)。同一台机器切换到互联网 B 公司的 PRD,他应该能切到 web 基线 pack(资损 + 性能 + 架构冲突 + 业务合理 + web-loose 算法)。这两个 pack 的 `loss_prevention` 单元内容**不同**(金融强调资金流可追溯,互联网强调用户余额扣减一致性)。

---

## 决策

通过 15 轮 grilling 会话,沉淀 D1–D15 决策。**整体框架 = 三层抽象 + 单目录物理布局**。

### 三层抽象(领域模型)

| 层 | 定义 | 谁在维护 | 频次 |
|---|---|---|---|
| **评估单元(Admission Unit)** | PRD 准入评估的单一视角;产出 per-dimension `pass / warn / fail` judgment | 平台核心 / 行业专家 | 低(季度) |
| **评估策略(Admission Algorithm / Policy)** | 拿 N 个单元 judgment 算**唯一**总体 verdict 的规则集 | 平台核心 | 低 |
| **评估包(Admission Pack)** | 用户的实际装载单位 = 一组 units + 一个 algorithm + UI 提示 | 用户 / 企业管理员 | **高(按需)** |

**关键设计分叉点**:verdict 计算归属。评估单元只声明"我看什么"(`admissionPrompt` 字段);verdict 严格度归评估策略管;**评估包是用户操作的对象**(不是单元,也不是策略)。

### D1 · 评估单元数量 = N(无固定 5)

5 维度不是核心机制,**只是 baseline pack 的预设配置**。任意评估单元集都是合法的 pack 内容。

### D2 · 仅 turn-1 受 admission pack 控制

turn-1 = admission check,由 pack 装配;**turn-2 = requirement-brainstorm 三桶(subproblem / risk / option)独立配置**,不在本 ADR 范围。

### D3 · verdict 算法是 pack 的属性

评估策略写在 `algorithm.yaml` 里,作为 pack 的属性。不独立成"全球策略目录"(跨包复用率几乎为 0);不写到 prompt 里让模型自己算(模型行为不可验证)。

### D4 · 装载作用域 = workspace + req + session 三层

- **workspace**:`~/.aidevspace/config.yaml` 里的 `enabled_packs: [...]` 列表
- **req**:`requirements/<req-id>/analysis/config.yaml` 内可 override(本期不实现,**为 v1.1 留位**)
- **session**:`POST /analysis/start` body 的 `pack_id`(本期为唯一装载入口)

### D5 · 物理布局 = `~/.aidevspace/admission/packs/<id>/`

单一目录,**每个 pack 自包含**:

```
~/.aidevspace/admission/packs/<id>/
├── manifest.yaml           # 元数据 + units 顺序 + algorithm 引用
├── units/
│   ├── <unit-id>.yaml      # 每个评估单元一个文件
│   └── ...
└── algorithm.yaml          # verdict 算法
```

**pack 自包含 = 每个 pack 是可分发的整体**。`tar czf finance-baseline-v1.tgz finance-baseline-v1/` 一键分享;GitHub release 直接挂。

**命名**:`admission` 主题(避免与"agent 评估工程 / MLOps eval"混淆),`units / algorithm / packs` 子目录保留(逻辑概念,不冲突)。

### D6 · unit prompt 拼接 = 分段标号格式

每个评估单元的 `admissionPrompt` 字段按 `### N. <id> (<displayName> · <severityIcon>)` 标号,末尾追加 `output_marker: '[DIM <id>]'` 作为给模型的格式契约。**不**走 Skill loader 装 admission(见 D7)。

### D7 · 干掉 admission-check Skill;pack 作为 Assembler deps

`apps/agent/skills/built-in/admission-check/SKILL.md` **退役**。`SystemPromptAssembler` 接收 `admissionLoader` 作为新 deps(C.2 形态);`assembleBase` 渲染 admission pack 内容作为 system prompt 的一段,不再从 `Active Skills` 段装 admission。

**dualTurnAssembler 的"再追加 active skill body"段删除**——原本是为了 turn-1 / turn-2 切换 admission-check / requirement-brainstorm Skill body;现在 admission 已独立,turn 切换不影响 admission 段。

### D8 · verdict 算法 DSL = JSON 规则列表 + jq 简化版表达式

```yaml
# algorithm.yaml
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

支持的表达式子集(共 10 个语法元素):

| 语法 | 例 |
|---|---|
| `.field` | `.severity` |
| `==` / `!=` | `.verdict == "warn"` |
| `and` / `or` / `not` | `.v == "x" and .s == "y"` |
| `any(A; pred)` | `any(units[]; .verdict == "fail")` |
| `all(A; pred)` | `all(units[]; .verdict == "pass")` |
| `[A \| select(pred)]` | `[units[] \| select(.severity == "🔴")]` |
| `length` / `count` | `length >= 2` |
| `true` / `false` | `true` |

实现:自写解释器,约 200-400 LOC TS。**不**用 JSONLogic(冗长) / Python(沙箱重) / 完整 jq(体积大)。

### D9 · id 命名空间 = 物理目录路径天然提供

`units/<id>.yaml` 文件名就是 id;不同 pack 的同名 unit 内容**可不同**(金融 loss_prevention ≠ 互联网 loss_prevention)。**冲突**通过"已 enabled 的 id 不允许覆盖"规则解决:用户导入同名 pack 必须先 disable 旧的。

### D10 · API = `/analysis/start` body 必填 `pack_id`

```json
{
  "angle": "architecture",
  "label": "...",
  "session_id": "...",
  "pack_id": "finance-baseline-v1"     // 必填
}
```

`pack_id` 不在 `enabled_packs` → **400 + 显式错误**:

```json
{
  "error": "pack_not_enabled",
  "reason": "pack_id 'foo' is not in enabled_packs; available: [baseline-5dim, finance-baseline-v1]",
  "available_packs": ["baseline-5dim", "finance-baseline-v1"]
}
```

**workspace default 仅作 UI 提示**,不参与 API fallback。

### D11 · manifest schema = M-1(文件引用)

```yaml
id: finance-baseline-v1                  # 必须与目录名一致
displayName: 金融行业基线 v1
version: 1.0.0
description: 银行 / 支付 / 跨境合规场景
tags: [finance, compliance, baseline]

units:
  - id: loss_prevention
    file: units/loss_prevention.yaml     # 引用,不复制
  - id: capital_compliance
    file: units/capital_compliance.yaml

algorithm: algorithm.yaml                # 引用,不内联

displayHints:
  primaryBlockers: [loss_prevention, capital_compliance]
  recommendedAngle: [architecture, data]
```

**unit 文件解耦**:`units/<id>.yaml` 包含 `id / displayName / severityIcon / outputMarker / admissionPrompt / outputSchema` 六字段。`admissionPrompt` 是单元的**评估 prompt**,注入到 system prompt 的分段标号段。

### D12 · verdict 计算 = service 层(model 不输出 [VERDICT])

- 模型在 turn-1 **只输出** `[DIM xxx]` 块
- turn-1 结束时,service 层从 jsonl 读出 `[DIM]` chunks → 执行 `algorithm.yaml` → 计算 verdict → 写入 chunks.jsonl 末尾 + 推 SSE `verdict_finalized` 事件
- AdmissionDashboard verdict 徽章读 `verdict_finalized` 事件显示

**algorithm.yaml 必须真正生效**——否则"自由装载算法"是空摆设。模型不再承担 verdict 计算责任。

### D13 · enabled_packs + 本地目录 / Git URL 导入

- **启用列表**:`~/.aidevspace/config.yaml` 的 `analysis.enabled_packs: [...]`(workspace 级)
- **导入来源**:本地目录(开发 / 测试) + Git URL(发布 / 共享)。`git+https://...#subdir=...&ref=...` 格式
- **导入执行面**:CLI 底层 + Web UI 调 CLI(`aidevspace pack import <path|url>` 是 single source of truth)
- **物理位置**:导入的 pack 与 built-in 同目录 `~/.aidevspace/admission/packs/<id>/`
- **built-in 物理位置**:**应用 bundle 不携带 pack**;首次启动自动生成 `baseline-5dim` 到 workspace(K-B 形态)

### D14 · 装载校验 = 结构 fail-fast / 语义降级 warning(V-3)

| 层级 | 错误 | 处理 |
|---|---|---|
| **结构** | manifest YAML parse 失败 / 缺必填字段 / manifest id 与目录名不一致 | **fail-fast**(500 + 明确错误) |
| **结构** | unit / algorithm 文件缺失 | **fail-fast** |
| **结构** | unit 缺 `admissionPrompt` | **fail-fast** |
| **结构** | `outputMarker` 跨 unit 冲突 | **fail-fast** |
| **语义** | algorithm 表达式 syntax 错 | **降级**(跳过该规则 + log warning + session 仍跑) |
| **语义** | unit 重复 / algorithm 规则 id 重复 | **降级** + warning |

YAML schema 错是 pack 文件坏了,**不可挽救**——fail-fast;算法表达式错是 pack 作者写错了某条规则,**部分能跑**——降级。

### D15 · 评估包 ID 冲突 = 显式禁止已 enabled 覆盖

导入的 pack id 与**已 enabled 的** pack id 重复 → 拒绝导入,提示用户先 disable 旧 pack。物理层冲突(`packs/<id>/` 目录已存在)由 loader 启动时统一处理。

---

## 数据契约

### 评估单元 Unit

```yaml
id: loss_prevention                       # slug, 与文件名一致
displayName: 资损安全                      # UI 显示
severityIcon: '🔴'                         # 🔴 / 🟠 / 🟡 / 🟢 / 💬
outputMarker: '[DIM loss_prevention]'     # parser 识别的标记
admissionPrompt: |                        # 注入到 system prompt 的评估 prompt
  ...
outputSchema:                             # parser 输出 schema
  verdict: { type: enum, options: [pass, warn, fail] }
  evidence: { type: string, maxChars: 80 }
  pending: { type: string?, optional: true }
  quote: { type: string?, optional: true }
```

### Algorithm

```yaml
id: finance-strict                        # 算法 id(在 pack 内唯一)
displayName: 金融严格策略
rules:
  - id: blocker_fail                      # 规则 id(在算法内唯一)
    when: '<jq-simplified expression>'    # 表达式;string 单行
    result: '✅' | '⚠️' | '❌'             # 三选一
    reason: '<中文一句话>'                 # 命中时显示给 UI 的原因
  - else:
    result: '✅'
    reason: '全部维度 pass'
```

### 运行时类型(`packages/shared/src/admission.ts`)

```typescript
export type Verdict = '✅' | '⚠️' | '❌'

export interface UnitJudgment {
  id: string                              // 'loss_prevention'
  displayName: string                     // '资损安全'
  severity: string                        // '🔴'
  verdict: 'pass' | 'warn' | 'fail'
  evidence: string
  pending?: string
  quote?: string
}

export interface PackVerdict {
  packId: string
  verdict: Verdict
  reason: string                          // 命中的算法规则 reason
  hitRuleId?: string                      // 命中的规则 id(给 UI 解释用)
  computedAt: string                      // ISO 8601
}
```

---

## 与现有契约的兼容

### 与 ADR-0017 chunks.jsonl 兼容

- chunks.jsonl 单行 schema 不变(`id / ts / label / kind / tone / text / session_id / [可选 source_refs] / [可选 admission]`)
- **新增** SSE 事件 `verdict_finalized`(在 turn-1 结束、SSE 流关闭前推一次):
  ```typescript
  {
    type: 'verdict_finalized',
    reqId: string,
    sessionId: string,
    ts: number,
    verdict: PackVerdict,
  }
  ```
- Web 端 AdmissionDashboard verdict 徽章:接 `verdict_finalized` 事件 → 缓存到 session-level state;无事件则降级显示"⏳ 计算中"

### 与 ADR-0020 start handler 兼容

- handler 整体编排不变(单 session 双 turn)
- 介入点仅在 turn-1 的 system prompt 装配:
  1. `provider.createSession(...)` 注入 `assembler: dualTurnAssembler`(原 dualTurnAssembler 不再追加 admission skill body,见 D7)
  2. `runDualTurnAnalysis` 在 turn-1 send 完成后,订阅 `verdict_finalized` SSE 事件 → 写 chunks.jsonl 末尾一行 verdict 摘要

### 与 admission-check Skill 完全不兼容(刻意)

- `apps/agent/skills/built-in/admission-check/SKILL.md` **删除**
- SkillLoader 仍可加载该目录但**不应再被 admission 段使用**
- baseline-5dim pack 自动生成后,**与原 SKILL.md 行为等价**(对照测试覆盖)

---

## 剩余张力(未在本 ADR 闭环,留给实现时决策)

1. **算法解释器沙箱** —— jq-simplified 表达式是用户写的,导入的 pack 可能带攻击性表达式;需明确"哪些语法元素是安全的"
2. **Pack 版本锁定** —— `enabled_packs: [finance-baseline-v1]` 是 id 引用,是否同时锁 `finance-baseline-v1@1.0.0`?
3. **Session 与 pack 文件快照** —— session 跑期间 pack 文件被改了,chunks.jsonl 已写、verdict 已算,如何处理?
4. **Req 级 override 在 API-1 下的实现** —— Q4 提了 req 级 config,但 D10 只取一个 pack_id;req 级 override 怎么注入?
5. **Turn-2 是否感知 pack** —— D2 说 turn-2 独立,但 turn-2 prompt 是否可读"基于 finance-baseline-v1"做强调?
6. **baseline-5dim 自动生成的写入时机** —— 首启时?首次启用时?失败重试策略?
7. **Git URL 导入的 subdir 不存在** —— 怎么 fail?
8. **`config.yaml` schema 校验** —— `enabled_packs` 字段是否做结构校验?
9. **`verdict_finalized` SSE 事件具体字段** —— D12 提了,具体 schema 待实施定
10. **Pack import 进度反馈** —— Git clone 可能很慢;要不要支持 progress / 后台任务?

---

## Considered Options(关键节点)

| 节点 | 候选 | 选择 | 否决理由 |
|---|---|---|---|
| 维度数量 | A 固定 5 / B Skill frontmatter 配置 / C N 个自描述单元 | **C** | A 限死;B 实施复杂且与 Skill 概念混 |
| 算法归属 | A 单元自描述 / B 包级声明 / C 全局固定 / D 算法独立可装载 | **B** | A 让单元跨包不可复用;C/D 与三层抽象不契合 |
| 物理布局 | α 三目录平铺 / β 单目录嵌套 / γ 二目录混合 | **β** | α 三目录对用户复杂;γ 规则不一致 |
| 包文件形态 | α 三目录平铺 / β 自包含 / γ pack 内有 units/ | **β** | 与本 ADR D5 同源 |
| unit prompt 拼接 | C1 整体 markdown / C2 分段标号 / C3 走 Skill 装载 | **C2** | C1 易漏边界;C3 污染 Skill loader |
| Skill 装载 vs Pack | A Skill body 模板 / B 叠加 / C 干掉 Skill | **C** | 见 D7 论证 |
| 表达式语法 | a JSONLogic / b jq 简化版 / c Python 一行 | **b** | a 冗长;c 沙箱重 |
| API 改造 | API-1 pack_id 必填 / API-2 emphasis / API-3 内联 pack | **API-1** | API-2 留 v1.1;API-3 与 pack 自包含冲突 |
| 导入来源 | J-A 仅 built-in / J-B 本地目录 / J-C 本地 + Git / J-D 完整 registry | **J-C** | J-A 太限制;J-D MVP 过重 |
| 校验策略 | V-1 严格 fail-fast / V-2 宽松 / V-3 分层 | **V-3** | V-2 错定位模糊;V-1 把可降级也升级为硬错 |

---

## Consequences

### 正面

- **真正落地"自由装载任意规范约束"**——金融 / 互联网 / 教育场景各自有 baseline pack,用户随时切换
- **verdict 严格度可调**——同一组单元 + 不同算法 = 不同行为;不需改 pack,只换 `algorithm.yaml`
- **pack 自包含可分发**——`tar czf finance-baseline-v1.tgz finance-baseline-v1/` 一键分享;GitHub release 直接挂;用户 git clone 即装
- **算法可解释**——AdmissionDashboard verdict 徽章可显示"finance-strict 第 2 条规则命中:warn 维度 ≥2"
- **Skill 域保持纯净**——Skill loader 只管 prose;pack loader 只管结构化配置;两个域不互相侵入

### 负面 / 代价

- **实施量大**——Batch 1-4 共 15 项工作;baseline-5dim 自动生成 + algorithm 解释器 + Settings UI 都需新写
- **算法解释器是新增维护负担**——jq-simplified 表达式子集要写测试 + 文档 + 后续 bug fix
- **Pack 文件 YAML 解析**——结构 fail-fast 意味着 YAML parser 错误会变成 API 500,要确保解析路径稳定
- **decision 67 升级**——ADR-0013 D10 的"frontmatter 声明"方案完全被本 ADR 取代,文档需更新
- **配置复杂度上升**——`~/.aidevspace/admission/packs/` + `~/.aidevspace/config.yaml` 的 `enabled_packs` + workspace default 三处用户要理解

### 风险缓解

| 风险 | 缓解 |
|---|---|
| baseline-5dim 与原 admission-check Skill 行为不等价 | 对照测试:同一 PRD,旧 Skill 5 维 + 硬编码 verdict 规则 vs 新 pack 的 algorithm.yaml + 5 unit,产出应一致(per-dimension verdict + overall verdict 各 5 组样本) |
| 算法解释器引入未测试语法 | MVP 仅支持 D8 列出的 10 个语法元素;新语法需加测试 + 文档 |
| Pack 装载 fail-fast 影响 session 启动 | 错误信息含 `available_packs` 列表;UI 引导用户启用对应 pack |
| 用户写错 pack 不知道哪里错 | V-3 校验分层:结构错给"哪个字段错了",语义错给"哪条规则被跳过" + warning log |
| 跨 pack 同名 unit 内容漂移 | 单元 = pack 内私有(β 自包含);不做全局 unit 共享;冲突由 enabled_packs 唯一性保证 |
| `enabled_packs` 改了,旧 session 怎么办 | session 装载时快照 pack 内容到内存;`enabled_packs` 变化不影响进行中 session(v1.1 再加 `pack_version` 字段) |

---

## 实施路径(Batch 1-4)

**Batch 1 · 数据契约 + 算法执行(最小可运行)**
1. `packages/shared/src/admission.ts` —— `UnitJudgment` / `Verdict` / `Pack` types
2. `apps/agent/src/admission/packLoader.ts` —— `AdmissionPackLoader` + manifest/unit/algorithm YAML 解析 + V-3 校验
3. `apps/agent/src/admission/algorithmInterpreter.ts` —— jq-simplified 表达式解释器(约 300 LOC TS)
4. baseline-5dim pack 自动生成代码(首启 hook)
5. chunks.jsonl + SSE 增加 `verdict_finalized` 事件

**Batch 2 · Skill 装载机制改造**
6. 改造 `SystemPromptAssembler` 注入 admission loader(D7)
7. C2 分段标号 prompt 渲染逻辑
8. 删除 `apps/agent/skills/built-in/admission-check/SKILL.md`
9. 改造 `analysis.ts` 的 `createDualTurnAssembler` —— 不再追加 Skill body,去重

**Batch 3 · API + 错误处理**
10. `/analysis/start` body 加 `pack_id` 必填
11. pack_id 不在 enabled_packs → 400 + E-A 错误体
12. pack 装载失败 → 500 + V-3 错误体

**Batch 4 · UX(Web + CLI)**
13. Web Settings → Admission Packs 页面(启用列表 + 导入按钮)
14. CLI `aidevspace pack import / list / enable / disable / uninstall`
15. Git URL 导入逻辑(G-A subdir + ref)

---

## Status 流转

- [x] Proposed:2026-07-29,15 轮 grilling 沉淀
- [ ] Accepted:实施完成后由项目负责人确认
- [ ] Deprecated:由 ADR-NNNN 取代时填写

---

## 变更日志

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-29 | 初稿:基于 15 轮 grilling 会话,沉淀 D1-D15,定义 Admission Pack Framework 完整形态 | Grilling 会话 |