---
Status: ready-for-agent
Type: prd
Created: 2026-07-12
Feature: ai-devspace-mvp
Supersedes: docs/adr/0013-analyzing-zone-rewrite.md
Implements: ADR-0013
SupersededBy_Issue: 19-zone-analyzing.md (wontfix, 已由本 PRD 替代)
RelatedIssues:
  - 17-zone-executing.md (样板模式)
  - 18-zone-drafting.md
  - 20-zone-clarifying.md (交接消费方)
  - 21-zone-designing.md
  - 22-zone-wrapup.md
---

# PRD · ANALYZING 工位重设计(从"观察屏"到"PRD 准入 + 技术概要协作工作台")

> 本 PRD 把 [ADR-0013](../docs/adr/0013-analyzing-zone-rewrite.md) 的 15 个决策(D1–D15)转化为可实施的产品需求。
>
> 现有 issue [19-zone-analyzing.md](issues/19-zone-analyzing.md) 已标 `wontfix` + `SupersededBy: ADR-0013`,本 PRD 替代其作为实施入口。

---

## Problem Statement

当前 ANALYZING 工位仅承担"旁观 AI 解析"单一职能(原 [ADR-0011 §6](../docs/adr/0011-requirement-workbench-zone-adaptive.md) 的 Thinking 形态):用户看 AI 思考流 + 打字机流 + 暂停/重置按钮,无产物可编辑、无双向协作、无多会话,完成后弹"切到 CLARIFYING 吗?"提示。

这个定位**与 DRAFTING → ANALYZING → CLARIFYING 的语义断链**:

- **DRAFTING 产出粗粒度 PRD**(业务语言,只表达"最后要达成的目标和状态")
- **CLARIFYING 接收细粒度"可独立开发的聚合模块"**(技术语言,处理落地细节)
- **中间存在巨大语义鸿沟**:业务语言 PRD → 技术语言开发概要 + 聚合模块清单

这个鸿沟目前**没有任何工位承载**:ANALYZING 太轻,CLARIFYING 太具体,DRAFTING 不该越界。

后果:

1. **PRD 准入校验缺失** — AI 直接基于未审的 PRD 推进,4 类风险(资损 / 性能 / 架构 / 业务合理性)在 EXECUTING 才暴露,代价大
2. **技术概要无显式形态** — AI 直接从 PRD 跳到 Task,中间聚合模块拆分不透明,用户无法介入
3. **AI 提问无沉淀机制** — 当前提问触发切 CLARIFYING(原决策 25),与"不打扰"哲学相悖,频繁打扰用户
4. **多会话无载体** — 同一 PRD 需从"架构 / 数据 / 接口"多角度分析时,无 Tab 切换

用户原话(2026-07-12):

> "现有功能只有观察 ai 分析过程,这么一个简单功能就开一个工作台太浪费了,应该还要承载更多功能"

---

## Solution

把 ANALYZING 工位重设计为 **PRD 准入 + 技术概要协作工作台**,承载 4 核心职能:

1. **解析参数配置**(启动前) — 选 Skill / 选知识 / 选仓库分支 / 设优先级
2. **解析过程观察**(进行中) — AI 思考流 + 实时打字机 + 上下文插话
3. **解析产物交互编辑**(进行中/完成后) — 识别子问题/风险/方案可增删改合并
4. **多会话并行观察**(横向) — 顶部 Tab 切换(架构 / 数据 / 接口 等角度)

**核心 UX 形态(详见 11h-A HTML 原型):**

```
ANALYZING 工位主区(顶到底):
┌──────────────────────────────────────────────────────────┐
│ 准入仪表板(5 维度卡 + 总体结论)                          │
│ 🔴 资损 2  🟠 性能 3  🟡 架构 1  🟢 业务 0  💬 上下文 4  │
│                                              ⚠️ 待裁决 10 │
├──────────────────────────────────────────────────────────┤
│ 会话 Tab  [架构 3] [数据 5*] [接口 8] [+ 新建]  📊 生成  │
├───────────────────────────┬──────────────────────────────┤
│ 🧠 思考流(当前会话)       │ 🎯 识别产物(可交互编辑)      │
├───────────────────────────┴──────────────────────────────┤
│ 启动前: 解析参数配置面板(运行后折叠为 ⚙️ 入口)         │
├──────────────────────────────────────────────────────────┤
│ 💬 插话输入条(用户随时补充上下文/反向提问)              │
├──────────────────────────────────────────────────────────┤
│ AI 思考条(全局,内容由工位注入)                          │
└──────────────────────────────────────────────────────────┘
```

**AI 提问不再主动推送** — 改写原决策 25:AI 完成识别后写入"待裁决面板"(`analysis/adjudication.md`),用户主动来 ANALYZING 处理;StatusBar "待裁决 N" + ZoneBar ANALYZING 状态指示共同提醒;其他工位可点 StatusBar 数字跳转过来。

**产物 = 双文件(Markdown + YAML),一次落盘**:

```
requirements/<req-id>/analysis/
  ├─ technical-brief.md      ← 业务背景 + 架构叙述 + 技术栈说明
  └─ modules.yaml            ← 聚合模块清单(结构化,被 CLARIFYING 消费)
  └─ adjudication.md         ← 待裁决项(被 StatusBar 读取)
```

**与 CLARIFYING 交接**:直接共享 `modules.yaml`(双向引用,无快照/无冻结点)。CLARIFYING 下次进入自动 reload 最新版本。

---

## User Stories

> 以下用户故事全部以"后端开发者,使用 Vibecoding"为目标用户;验收标准均来自 [ADR-0013](../docs/adr/0013-analyzing-zone-rewrite.md) D1–D15。

### A. PRD 准入校验

1. As a 后端开发者,当我完成 DRAFTING 工位的 PRD 后,我想进入 ANALYZING 工位触发 AI 做准入校验,so that 在写代码前发现 PRD 的资损/性能/架构/业务合理性 4 类风险
2. As a 后端开发者,我想看到顶部"准入仪表板"显示 5 个严重度维度(资损/性能/架构/业务/上下文),so that 一眼看到 PRD 在哪些维度有风险
3. As a 后端开发者,我想每个维度卡显示具体问题数(N 项),so that 知道工作量
4. As a 后端开发者,我想仪表板右端显示"总体结论"(准入通过 / 待裁决 / 准入失败),so that 知道 PRD 当前能否往下走
5. As a 后端开发者,当任一 🔴 资损问题存在时,我想默认总体结论为 ❌ 失败,so that 资损红线不被越过
6. As a 后端开发者,当总体 ❌ 失败时,我想可以点"接受风险"按钮手动改为继续,so that 已知风险下不阻塞流程
7. As a 后端开发者,我想准入维度集合不是全局写死,而是按 Skill 不同而不同(如退款分析 vs 会员分析),so that 不同业务领域关注不同风险
8. As a 后端开发者,我想 Skill 可以在 frontmatter 声明新增维度(`add:`)、跳过默认维度(`skip:`),so that Skill 作者能精准控制维度集合

### B. 解析参数配置

9. As a 后端开发者,我想在启动 ANALYZING 前选择 Skill,so that 不同分析角度用不同 Skill
10. As a 后端开发者,我想选择注入的知识(domain / patterns / bugs),so that AI 参考相关领域知识
11. As a 后端开发者,我想选择关联仓库的分支,so that 分析结果绑定到正确代码基线
12. As a 后端开发者,我想设置优先级(资损优先 / 性能优先 / 全维度),so that 重点突出
13. As a 后端开发者,启动后,我可以把配置面板折叠为顶部的 ⚙️ 入口,so that 主区不被配置项占满

### C. 解析过程观察

14. As a 后端开发者,我想看到 AI 思考流(每个 chunk 带时间戳 / 标签 / 文字),so that 知道 AI 当前在做什么
15. As a 后端开发者,我想打字机效果是 20ms / 字(决策 32),so that 阅读节奏合适
16. As a 后端开发者,我想点击思考流任意位置立即跳过当前 chunk 打字,so that 不被慢速打字卡住
17. As a 后端开发者,我想有"⏸ 暂停 / ▶ 继续"按钮控制打字机,so that 中途离开时 AI 不再往前推
18. As a 后端开发者,我想底部有"💬 插话输入条",可以随时补充上下文或反向提问 AI,so that 不打断流式观察又能即时纠正方向
19. As a 后端开发者,我想插话后 AI 在下一轮思考中考虑我的输入,so that 协作更紧密

### D. 解析产物交互编辑

20. As a 后端开发者,我想右侧"识别产物"区显示 3 类:📌 子问题 / ⚠️ 风险点 / 🎨 候选方案,so that 一眼看到 AI 识别的关键信息
21. As a 后端开发者,我想每条产物卡片可以"✏️ 编辑"(inline edit),so that 调整措辞或数值
22. As a 后端开发者,我想每条产物可以"🗑 删除",so that 移除不准确的识别
23. As a 后端开发者,我想多条子问题可以"合并",so that 相似问题去重
24. As a 后端开发者,我想可以"新增"产物(用户自己识别出 AI 漏的),so that 产物更完整
25. As a 后端开发者,我希望编辑即时落盘到 `analysis/adjudication.md` / `modules.yaml`,so that 决策 25 "不打扰,但陪伴" 的"输出物以文件标记形式落位"落地

### E. 多会话并行观察

26. As a 后端开发者,我想在顶部看到当前需求的所有 ANALYZING 会话 Tab(如架构 / 数据 / 接口),so that 知道有哪些分析角度在进行
27. As a 后端开发者,我想点 Tab 切换当前主区显示的会话,so that 一次只看一个深度,避免视觉负担
28. As a 后端开发者,我想 Tab 上有"已识别子问题数"数字徽章,so that 知道哪个 Tab 跑得远
29. As a 后端开发者,我想可以新建会话 Tab,so that 从新角度分析 PRD
30. As a 后端开发者,我想准入仪表板 5 维度是全局共享(不分子会话),so that 看到的是 PRD 整体准入状态
31. As a 后端开发者,我想切换 Tab 保留各会话的滚动位置(sessionStorage),so that 回到 Tab 不丢上下文

### F. 待裁决项沉淀(改写原决策 25)

32. As a 后端开发者,AI 完成识别后,我想看到"待裁决面板"(🛡),so that 不被 AI 主动推送打断
33. As a 后端开发者,我想待裁决面板默认展开"待裁决"区(顶部),so that 优先处理新问题
34. As a 后端开发者,我想每项裁决项支持 2-4 个预设答案(AI 推测的常见答案)+ 自定义文本输入框,so that 快速回答常见问题又能灵活处理特殊场景
35. As a 后端开发者,我裁决一项后,该问题标记为"已裁决,未应用"(蓝色圆点),so that 知道还没真正生效
36. As a 后端开发者,我想点 [📥 应用本次裁决 (N 项)] 按钮批量提交,so that AI 一次性增量更新产物
37. As a 后端开发者,我想裁决后的项移到"已裁决"折叠区(底部,可展开),so that 主区不被历史淹没
38. As a 后端开发者,我想 StatusBar 全局显示"待裁决 N"数字(其他工位也可见),so that 知道 ANALYZING 工位有事待处理
39. As a 后端开发者,在 DRAFTING/EXECUTING 工位,我想点 StatusBar "待裁决 N"数字直接跳到 ANALYZING,so that 任何工位都能快速响应

### G. 技术概要与聚合模块生成

40. As a 后端开发者,我想点 [📊 生成技术概要] 按钮,AI 一次性产出 `technical-brief.md` + `modules.yaml` 两个文件,so that 一次拿到完整产物
41. As a 后端开发者,我想 `technical-brief.md` 包含业务背景 / 架构选型 / 技术栈说明 / 风险缓解,so that 业务和团队成员都能读懂
42. As a 后端开发者,我想 `modules.yaml` 是结构化聚合模块清单(每模块:name/description/deps/complexity/clarifying_questions),so that CLARIFYING 工位能直接消费
43. As a 后端开发者,我想"生成技术概要"按钮始终可用(准入通过时 + 待裁决时 + 准入失败时都可点),so that 不被状态锁住

### H. 裁决后流程

44. As a 后端开发者,当我裁决多项后,我想点 [📥 应用本次裁决] 按钮,AI 一次性增量更新 `modules.yaml` + `technical-brief.md` 对应部分,so that 单条裁决不浪费 AI 调用
45. As a 后端开发者,我想大改(技术栈重选 / 架构冲突未解 / 大量裁决后)可以点 [🔄 重扫] 按钮,AI 重新走"准入校验 + 技术概要生成 + 拆解聚合模块"全流程,so that 一次性刷新所有产物
46. As a 后端开发者,我想 [🔄 重扫] 和 [📥 应用本次裁决] 是两个独立按钮,并排在待裁决区底部,so that 我能选择是微调还是大改

### I. 重扫后产物处理

47. As a 后端开发者,当 [🔄 重扫] 后,我希望 `modules.yaml` + `technical-brief.md` 直接覆盖旧版,so that 主目录干净
48. As a 后端开发者,我想重扫后的旧版仍可通过 StatusBar "[↶↶ 回滚本次会话全部]" 找回,so that 重扫翻车能一键回到重扫前

### J. 与 CLARIFYING 交接

49. As a 后端开发者,当技术概要 + 聚合模块生成完成,我可以切到 CLARIFYING 工位,so that 开始每个模块的落地细节澄清
50. As a 后端开发者,CLARIFYING 工位直接读 `analysis/modules.yaml`,so that 没有快照 / 交接包 / 冻结点等仪式成本
51. As a 后端开发者,我在 ANALYZING 修改 `modules.yaml` 后,切到 CLARIFYING 自动 reload 最新版本,so that 双向引用生效
52. As a 后端开发者,我在 CLARIFYING 中若发现 `modules.yaml` 有问题,我想直接切回 ANALYZING 编辑,so that 工位之间无墙

### K. 配置与状态

53. As a 后端开发者,我想 ANALYZING 工位注册表更新:`display_name: "PRD 准入 + 技术概要"`、`main_layout: "admission-workbench"`、`default_arming` 新增 `admission-check` / `tech-brief-scaffold` Skill,so that 工位集合反映新定位
54. As a 后端开发者,我想 ANALYZING `default_arming` 的 `admission-check` Skill 在 frontmatter 声明 `admission_dimensions:` 字段,so that Skill 决定当前激活的准入维度
55. As a 后端开发者,StatusBar 全局显示"待裁决 N"指示器,可在任意工位点击跳转 ANALYZING,so that 待裁决跨工位可见
56. As a 后端开发者,ZoneBar ANALYZING Tab 在有待裁决时显示数字徽章,so that 工位入口处就有提示

---

## Implementation Decisions

### D-IMPL-1 · 单一最高测试 seam:`AnalyzingZone` 组件 + `AnalyzingData` 数据契约

- **测试 seam 选择**:`apps/web/src/components/analyzing-zone.tsx` 组件 + `apps/web/src/lib/analyzing.ts` 数据契约
- **理由**:所有 UX 改动经由一处,UI 测试覆盖 5 个核心场景(准入仪表板 / 会话 Tab / 待裁决面板 / 产物编辑 / 技术概要生成);Skill frontmatter 解析与 Agent REST endpoint 作为下层 seam,各自独立测试
- **现有样板**:已有 `apps/web/src/__tests__/analyzing-zone.test.tsx`(原"观察屏"测试),重写时**保留 vitest + @testing-library/react 风格**,保持 seam 一致

### D-IMPL-2 · `AnalyzingData` 接口扩展(替代原 `chunks/stats/summary/toolbar` 4 段)

新增字段(基于 ADR-0013 D2/D4/D7/D8):

```ts
// apps/web/src/lib/analyzing.ts
export interface AnalyzingData {
  requirementId: string
  empty: boolean

  // ─── 准入仪表板(5 维度)───
  admission: {
    dimensions: AdmissionDimension[]      // 5 个维度,顺序由 Skill frontmatter 决定
    verdict: 'pass' | 'pending' | 'fail'  // 总体结论
    pendingAdjudicationCount: number       // 待裁决 N(给仪表板右端徽章)
  }

  // ─── 多会话 ───
  sessions: AnalysisSession[]              // Tab 列表;首项为当前主区会话
  activeSessionId: string

  // ─── 当前会话内容 ───
  session: {
    chunks: AnalyzingChunk[]               // 思考流(D2 ② 兼容原 chunks)
    summary: AnalyzingSummary              // 大图标 + 标题 + 描述 + 三 stats
    stats: AnalyzingStats                  // 子问题 / 风险点 / 方案
    products: AnalyzingProductGroup        // 📌子问题 / ⚠️风险 / 🎨方案(可编辑)
  }

  // ─── 启动前参数配置(已运行时折叠为 ⚙️)───
  config: AnalyzingConfig                  // 选 Skill / 知识 / 分支 / 优先级
  configCollapsed: boolean                 // 是否折叠

  // ─── 产物 ───
  techBriefPath: string                    // requirements/<id>/analysis/technical-brief.md
  modulesYamlPath: string                  // requirements/<id>/analysis/modules.yaml
  adjudicationPath: string                 // requirements/<id>/analysis/adjudication.md
  canGenerateBrief: boolean                // 启动后一直为 true
  techBriefPreview?: string                // 已生成时显示预览

  // ─── 工具栏 ───
  toolbar: AnalyzingToolbar                // 兼容原 toolbar 接口(暂停/重置)
}

export interface AdmissionDimension {
  id: string                               // loss_prevention / performance / arch_conflict / business_reasonable / context
  label: string                            // "资损安全"
  icon: string                             // 🔴
  severity: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
  count: number                            // 当前激活项数
}

export interface AnalysisSession {
  id: string                               // session uuid
  label: string                            // "架构角度"
  angle: 'architecture' | 'data' | 'interface' | 'custom'
  detectedCount: number                    // 已识别子问题数(Tab 徽章)
  isStreaming: boolean
}

export interface AnalyzingProductGroup {
  subproblems: AnalyzingProductItem[]      // 📌
  risks: AnalyzingProductItem[]            // ⚠️
  options: AnalyzingProductItem[]          // 🎨
}

export interface AnalyzingProductItem {
  id: string                               // 用于编辑/删除的稳定 key
  title: string                            // "退款金额上限?"
  description?: string
  severity?: 'red' | 'orange' | 'yellow' | 'green' | 'blue'
}
```

> **决策来源**:ADR-0013 D2 ②③ · D4 · D7 · D8。`AnalyzingData` 接口扩展**不破坏**原 `chunks / summary / stats / toolbar` 4 段(下游 `AnalyzingZone` 组件改造内部实现即可)。

### D-IMPL-3 · 工位注册表更新

`apps/web/src/lib/zones.ts` 中 ANALYZING 条目更新(对应 ADR-0013 §工位注册表):

```yaml
id: analyzing
name: ANALYZING
display_name: PRD 准入 + 技术概要        # 原:解析
icon: 🧠
route_segment: analyzing
has_resource_tree: false
has_inline_rail: false
main_layout: admission-workbench          # 原:thinking-layout
status_color: blue
status_pulse: true                        # 保持
default_arming:
  - admission-check                       # NEW
  - tech-brief-scaffold                   # NEW
  - requirement-brainstorm
  - requirement-critique
thinking_bar: required
entry_triggers:
  - "DRAFTING 工位 PRD 完成时,弹出建议:进入 ANALYZING 校验"
exit_triggers: []                         # 无自动退出
```

> 同步更新 `~/.aidevspace/zones/analyzing.yaml`(由 zone registry loader 读取,无需新增 schema)。

### D-IMPL-4 · Skill frontmatter 新增 `admission_dimensions` 字段

`SKILL.md` frontmatter 新增 2 个字段(对应 ADR-0013 D10):

```yaml
---
name: refund-analyzer
triggers: [...]
default_arming: [...]
admission_dimensions:                    # NEW · Skill 激活哪些默认维度
  - loss_prevention
  - performance
  - arch_conflict
  - business_reasonable
admission_override:                      # NEW · 维度调整
  add: [coupon_consistency]
  skip: [business_reasonable]
---
```

`packages/shared/src/skill-schema.ts` (新增,不存在则新建)导出 `AdmissionDimensionIdSchema`:

```ts
export const AdmissionDimensionIdSchema = z.enum([
  'loss_prevention',
  'performance',
  'arch_conflict',
  'business_reasonable',
  'context_query',
])
export type AdmissionDimensionId = z.infer<typeof AdmissionDimensionIdSchema>
```

### D-IMPL-5 · Agent REST endpoint 新增 3 个(对应 D-IMPL seam 选择 #2)

Web 端不直连 FS(决策 37),新增 3 个 Agent endpoint,均在 `apps/agent/src/routes/analysis.ts`(新建):

| Endpoint | Method | Body | 职责 |
|---|---|---|---|
| `/requirements/:id/analysis/adjudicate` | POST | `{ item_id, answer, apply: boolean }[] }` | 写入裁决;若 `apply=true` 则增量更新 `modules.yaml` + `technical-brief.md` |
| `/requirements/:id/analysis/regenerate` | POST | `{ session_id?: string }` | 触发 Skill 重扫;返回 SSE 流(思考流 + 产物) |
| `/requirements/:id/analysis/generate-brief` | POST | `{}` | 一次性生成 `technical-brief.md` + `modules.yaml` |

**写入行为:**

- 所有写文件操作前自动 snapshot(决策 47 + ADR-0009 第 4 层)
- `adjudicate` 写 `adjudication.md`(追加,不覆盖)
- `regenerate` 覆盖 `modules.yaml` + `technical-brief.md`(旧版靠 snapshot 找回)
- `generate-brief` 同上

### D-IMPL-6 · 产物文件结构

`requirements/<req-id>/analysis/` 下 3 个文件:

```yaml
# modules.yaml schema
type: object
required: [modules]
properties:
  modules:
    type: array
    items:
      type: object
      required: [id, name, description]
      properties:
        id: { type: string }
        name: { type: string }
        description: { type: string }
        deps: { type: array, items: { type: string } }
        complexity: { enum: [low, medium, high] }
        clarifying_questions:
          type: array
          items:
            type: object
            required: [id, question]
            properties:
              id: { type: string }
              question: { type: string }
              options: { type: array, items: { type: string } }
              required: { type: boolean }
```

`adjudication.md` 结构(Markdown + YAML frontmatter):

```markdown
---
created: 2026-07-12T14:23:01+08:00
session_id: sess-abc-123
---

# 待裁决项

## 待裁决(已回答,待应用)

- item_id: q-1
  question: 退款金额上限?
  suggested_options: [1000, 5000, 10000, 不限]
  answer: 5000
  answered_at: 2026-07-12T14:25:00+08:00
  applied: false

## 已裁决(已应用)

- item_id: q-2
  ...
  applied: true
  applied_at: 2026-07-12T14:26:00+08:00
```

### D-IMPL-7 · StatusBar "待裁决 N" 接入

`apps/web/src/components/status-bar.tsx` 增加全局"待裁决 N"指示器:

- 数据源:从 `requirements/<id>/analysis/adjudication.md` 解析 `pendingAdjudicationCount`
- 任意工位都可见
- 点击 → `router.push(/requirements/<id>/analyzing/)`
- 其他工位(DRAFTING/EXECUTING 等)也能看到提示

### D-IMPL-8 · ZoneBar ANALYZING Tab 徽章

`apps/web/src/components/zone-bar.tsx`:

- ANALYZING Tab 上有"待裁决 N"数字徽章(对应 ADR-0013 D6)
- 徽章数与 StatusBar 同步
- 点击 Tab 行为不变,徽章只是提示

### D-IMPL-9 · CLARIFYING 改造(消费 modules.yaml)

`apps/web/src/lib/clarifying.ts` 数据源改造(对应 ADR-0013 D9):

- **原**:`clarifying/questions.yaml` 由 AI 自行生成
- **改**:从 `analysis/modules.yaml` 的 `clarifying_questions` 字段读取
- 字段映射:modules[].clarifying_questions[].{question, options, required} → ClarifyingQuestion
- `modules.yaml` 不存在时,CLARIFYING 显示引导"先去 ANALYZING 生成技术概要"

### D-IMPL-10 · 改写 CONTEXT.md 决策 25

新增决策 25 文本(已在 CONTEXT.md v1.0.2 落地,实施时不再重复改):

> 25 · **AI 主动推送触发 = 全部取消**(包括原"AI 提问等用户回答"也被降级为"待裁决项沉淀")。AI 输出物以文件标记形式落位,以 StatusBar "待裁决 N" + 工位仪表板常驻提醒。彻底贯彻决策 24 "不打扰,但陪伴"哲学。

### D-IMPL-11 · HTML 原型作为视觉对照基线

- **保留** [11h-A-zone-multisession-tabs.html](../docs/design/pages/11h-A-zone-multisession-tabs.html)(决策 36 单一事实源)
- **存档** [11h-B/C/D](.html)(被拒方案,留作设计历史)
- **保留** [11e-stage-adaptive-analyzing.html](../docs/design/pages/11e-stage-adaptive-analyzing.html)(原观察屏原型,存档,不再作实施对照)

### D-IMPL-12 · 与现有 11h-A 原型的关键差异

| 11h-A 原型已有 | 新增(本 PRD) |
|---|---|
| 准入仪表板 5 卡 | — |
| 会话 Tab 横向 | — |
| 思考流(左)+ 识别产物(右) | 产物卡片支持 inline edit / delete / merge(D2 ③) |
| AI 思考条 | — |
| 启动前参数配置 | — |
| 插话输入条 | — |
| **缺失** | **待裁决面板**(双区折叠,裁决后增量更新,见 ADR-0013 D11/D12/D15) |
| **缺失** | **技术概要生成按钮**(`[📊 生成技术概要]`,落盘 modules.yaml + technical-brief.md,见 D8) |
| **缺失** | **重扫按钮**(`[🔄 重扫]`,见 D11) |
| **缺失** | **应用本次裁决按钮**(`[📥 应用本次裁决 (N 项)]`,见 D12) |
| **缺失** | **预设选项 + 自定义文本**(裁决项回答载体,见 D13) |
| **缺失** | **准入维度按 Skill 装配**(frontmatter admission_dimensions,见 D10) |
| **缺失** | **StatusBar "待裁决 N" 全局指示器**(跨工位可见,见 D6) |
| **缺失** | **ZoneBar ANALYZING Tab 数字徽章**(待裁决数,见 D6) |
| **缺失** | **CLARIFYING 消费 modules.yaml**(直接共享文件,见 D9) |

### D-IMPL-13 · 不破坏原"thinking 流"形态

原 [analyzing-zone.tsx](../apps/web/src/components/analyzing-zone.tsx) 的打字机 + 暂停/重置逻辑(decision 32 + ADR-0011 §6)在重写后保留为 **会话主区的"思考流"组件**,继续提供打字机效果;区别是它现在从属于某个 Tab 会话,不再独占主区。

---

## Testing Decisions

### 总体原则

- **只测外部行为**,不测内部状态(原 [analyzing-zone.test.tsx](../apps/web/src/__tests__/analyzing-zone.test.tsx) 风格)
- **不测 snapshot**:HTML 输出结构会随实现细节变化,只断言用户感知的行为(可见文本 / 点击效果 / ARIA 属性)
- **fake-timer 测打字机**:沿用原测试的 `vi.useFakeTimers()` 模式

### 测什么

#### 1. `AnalyzingZone` 组件(vitest + @testing-library/react)

**5 个核心场景**(对应 D-IMPL-1 seam):

| 测试场景 | 断言 |
|---|---|
| 准入仪表板渲染 | 5 个维度卡可见,每个有数字;verdict 显示"准入通过/待裁决/失败";待裁决 N 徽章可见 |
| 会话 Tab 切换 | 多 Tab 列表渲染,点击切换 `activeSessionId` 改变主区;Tab 徽章显示各会话 detectedCount |
| 待裁决面板 | "待裁决"区展开,"已裁决"区折叠;每项有预设选项按钮 + 自定义文本框;点选项 → 标记蓝色圆点(待应用);点 [应用本次裁决] → 调 agent endpoint |
| 产物可编辑 | 每条 📌/⚠️/🎨 卡片有 ✏️ / 🗑 / 合并 / + 按钮;点击 inline edit 触发 input 显示 |
| 技术概要生成按钮 | `[📊 生成技术概要]` 始终可见;点击 → 调 `/generate-brief`;成功后显示预览 + `[应用本次裁决]` 状态 |
| 重扫按钮 | `[🔄 重扫]` 可见;点击 → 调 `/regenerate`;有确认弹窗(避免误操作) |
| 思考流打字机 | 沿用 fake-timer 测试,断言 20ms / 字 + 点击跳过 |
| 插话输入条 | 输入文本 + 提交 → 触发 SSE 推送新 chunk |
| 空态 | `empty=true` 时显示 EmptyState 引导去 DRAFTING |

#### 2. `getAnalyzingData` server function(单元测试)

- `analysis/adjudication.md` 解析为 `pendingAdjudicationCount`
- `analysis/modules.yaml` 解析为 `sessions[].products`
- 文件不存在时返回 `empty: true` 或 `admission.pendingAdjudicationCount: 0`

#### 3. Agent endpoints(integration test)

- `POST /analysis/adjudicate`:验证文件写入 + 自动 snapshot 触发
- `POST /analysis/regenerate`:验证产物覆盖 + SSE 流格式
- `POST /analysis/generate-brief`:验证双文件落盘

#### 4. Skill schema(单元测试)

- `AdmissionDimensionIdSchema` 接受 5 个默认 ID
- 拒绝未知 ID
- `admission_override.add/skip` 类型校验

#### 5. CLARIFYING 消费 modules.yaml(单元测试)

- `getClarifyingData` 优先读 `analysis/modules.yaml`,降级到 `clarifying/questions.yaml`
- 字段映射正确

### Prior Art(现有测试样板)

- [apps/web/src/__tests__/analyzing-zone.test.tsx](../apps/web/src/__tests__/analyzing-zone.test.tsx) — 原"观察屏"测试,保留 fake-timer + data-testid 模式
- [apps/web/src/__tests__/drafting-zone.test.tsx](../apps/web/src/__tests__/drafting-zone.test.tsx) — DRAFTING 工位测试,Form 交互模式
- [apps/web/src/__tests__/clarifying-zone.test.tsx](../apps/web/src/__tests__/clarifying-zone.test.tsx) — CLARIFYING 工位测试,Q&A 流程
- [packages/shared/src/__tests__/zones-schema.test.ts](../packages/shared/src/__tests__/zones-schema.test.ts) — 15 字段 schema 验证,扩展 `AdmissionDimensionIdSchema` 测试时对齐风格

---

## Out of Scope

> 明确剔除本 PRD 范围,避免蔓延。

1. **AI 主动推送任何形式** — 决策 25 改写后,平台无任何 AI 主动通知(待裁决靠 StatusBar 被动提醒)
2. **状态机驱动 UI 流转** — 决策 15 反对;工位切换 = 用户主动(继承)
3. **新版 ANALYZING 与原"观察屏"并存** — 原 [analyzing-zone.tsx](../apps/web/src/components/analyzing-zone.tsx) 完全替换,不留兼容层
4. **ANALYZING 之外的工位改造** — DRAFTING / CLARIFYING / DESIGNING / EXECUTING / WRAP-UP 不在本 PRD 范围;只有 CLARIFYING 因消费 modules.yaml 需小幅改动(D-IMPL-9)
5. **Skill 自动触发** — `entry_triggers: ["DRAFTING 完成时建议进入 ANALYZING"]` 仅在 UI 弹"建议",不自动切工位
6. **多 LLM Provider 切换** — 决策 35 全局一个 Provider(继承)
7. **Web 端代码编辑** — PRD v1.0 不做
8. **Snapshot 机制重设计** — 沿用 ADR-0009 第 4 层 + 决策 47(自动 snapshot 30 天);不新加版本管理
9. **真插件市场 / Skill 远程安装** — 决策 8 MVP 不做
10. **跨需求 / 跨会话的聚合模块共享** — MVP 单需求单会话,后续 P1+ 考虑
11. **modules.yaml 双向同步冲突解决** — 单用户单写者,无冲突;冲突解决 P2+ 再考虑
12. **AI 思考流 SSE 协议改造** — 沿用现有 `@fastify/sse` + 决策 31(继承)

---

## Further Notes

### 依赖本 PRD 完成的子 Issue(对应 ADR-0013 §落地 Issue)

按 [ADR-0013](../docs/adr/0013-analyzing-zone-rewrite.md) §"落地 Issue(待拆分)",需拆分为 8 个实施 issue(由 agent 实施时创建在 `.scratch/ai-devspace-mvp/issues/`):

| Issue | 主题 | 优先级 | 依赖 |
|---|---|---|---|
| 19a-analyzing-admission-dashboard.md | 准入仪表板 5 维度卡组件 | **P0** | — |
| 19b-analyzing-session-tabs.md | 多会话 Tab 切换组件(基于 11h-A) | P1 | 19a |
| 19c-analyzing-product-edit.md | 识别产物交互编辑(增/删/改/合并) | P1 | 19a |
| 19d-analyzing-config-panel.md | 解析参数配置面板 | P2 | — |
| 19e-analyzing-prompt-input.md | 插话输入条 | P2 | — |
| 19f-analyzing-tech-brief-gen.md | 生成技术概要按钮(Markdown + YAML 双产物) + Agent `/generate-brief` endpoint | **P0** | 19a |
| 19g-analyzing-adjudication-panel.md | 待裁决面板(双区折叠 + 预设选项 + 应用/重扫按钮) + Agent `/adjudicate` `/regenerate` endpoints | P2 | 19a, 19f |
| 19h-analyzing-zone-yaml-update.md | 工位注册表更新(ZoneSchema 扩展 + zones.ts 中 ANALYZING 条目更新 + default_arming swap) | P3 | — |

**实施顺序建议**(根据依赖关系):

```
19h (注册表) ──┬── 19d (配置) ──┐
              ├── 19e (插话) ──┤
              └── 19a (仪表板) ──┬── 19b (Tab) ──┐
                                  ├── 19c (编辑) ┤
                                  └── 19f (概要) ──┴── 19g (裁决面板)
```

**MVP 优先级**:
- P0:19a (准入仪表板), 19f (技术概要生成) — 核心
- P1:19b (多会话), 19c (产物编辑) — 关键 UX
- P2:19d (参数配置), 19e (插话), 19g (待裁决面板) — 增强
- P3:19h (注册表更新) — 配套

### 关联 ADR / 决策

- **本 PRD 实现** [ADR-0013](../docs/adr/0013-analyzing-zone-rewrite.md) D1–D15
- **关联决策** [CONTEXT.md](../CONTEXT.md) 决策 15 / 23 / 24 / 25(改写)/ 38 / 43 / 44 / 49 / 58–72(v1.0.2 新增)
- **关联 ADR** [ADR-0011](../docs/adr/0011-requirement-workbench-zone-adaptive.md) §5/§6(覆盖)· [ADR-0012](../docs/adr/0012-requirement-workbench-shell-topology.md) §9(工位注册表沿用)· [ADR-0009](../docs/adr/0009-ai-failure-defense.md) 第 4 层(snapshot 沿用)· [ADR-0006](../docs/adr/0006-html-prototype-as-source-of-truth.md) §"HTML 原型作为单一事实源"
- **样板** [issue 17-zone-executing.md](issues/17-zone-executing.md) · [issue 18-zone-drafting.md](issues/18-zone-drafting.md)

### 现有 issue 状态

- [issue 19-zone-analyzing.md](issues/19-zone-analyzing.md) — 已标 `wontfix` + `SupersededBy: ADR-0013`(本次改动**不改**这个状态,只是引用为 superseded)
- 实施时由 agent 创建 19a-19h 8 个 issue,沿用 issue tracker 命名约定

### UX 设计参考

- HTML 原型基线:[11h-A-zone-multisession-tabs.html](../docs/design/pages/11h-A-zone-multisession-tabs.html)(决策 36 单一事实源)
- 原型对比页:[11h-zone-multisession-form-compare.html](../docs/design/pages/11h-zone-multisession-form-compare.html)
- 原"观察屏"存档:[11e-stage-adaptive-analyzing.html](../docs/design/pages/11e-stage-adaptive-analyzing.html)

### 实施后验证清单

- [ ] `apps/web/src/components/analyzing-zone.tsx` 完全重写,主区布局符合 11h-A 原型
- [ ] `apps/web/src/lib/analyzing.ts` 接口扩展为 `AnalyzingData`(D-IMPL-2)
- [ ] `apps/web/src/lib/zones.ts` 中 ANALYZING 条目更新(D-IMPL-3)
- [ ] `apps/web/src/components/status-bar.tsx` 含全局"待裁决 N"指示器
- [ ] `apps/web/src/components/zone-bar.tsx` ANALYZING Tab 有数字徽章
- [ ] `apps/web/src/lib/clarifying.ts` 数据源改为 `analysis/modules.yaml`(D-IMPL-9)
- [ ] `apps/agent/src/routes/analysis.ts` 新增 3 个 endpoint(D-IMPL-5)
- [ ] `packages/shared/src/skill-schema.ts` 新增 `AdmissionDimensionIdSchema`(D-IMPL-4)
- [ ] `~/.aidevspace/zones/analyzing.yaml` 同步更新
- [ ] 测试:5 个核心场景(准入仪表板 / 会话 Tab / 待裁决面板 / 产物编辑 / 技术概要生成)全部通过
- [ ] 测试:打字机 fake-timer 兼容(D-IMPL-13)
- [ ] 测试:CLARIFYING 消费 modules.yaml 字段映射正确
- [ ] `pnpm tsc --noEmit` 无错(代替 `next build`,符合项目 CLAUDE.md "Next.js dev ↔ build 隔离" 规则)
- [ ] `pnpm test` 全绿