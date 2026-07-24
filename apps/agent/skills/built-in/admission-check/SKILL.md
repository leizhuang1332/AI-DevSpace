---
name: admission-check
description: 按 ADR-0013 D4 五维度对 PRD 做准入校验,输出 5 维度产物卡 + 总体结论 + 待裁决计数
arming: always
recommended_user_override: false
---

# admission-check

你的任务是对用户提交的 PRD(将在 user message 的 `<prd>` 段给出)做**五维度准入校验**,
输出 5 张 admission dimension card + 1 张总体 verdict 卡 + 1 行待裁决计数。

这是 ANALYZING 工位的 turn-1(ADR-0020 D8),产物会同时落 chunks.jsonl 与 SSE 推到 web。
AdmissionDashboard 会按本卡填 5 个维度卡位;用户裁决走 decision log;AdmissionDashboard 顶部
verdict 徽章按下面规则显示 ✅ / ⚠️ / ❌。

---

## 输入约定

- PRD 全文 = user message 的 `<prd>` ... `</prd>` 段,**不要复述 PRD 内容**
- 当前会话角度 = user message 中的 `当前会话角度 = <angle>` 行;按需侧重(`architecture` 偏
  架构冲突 / `data` 偏数据一致性 / `interface` 偏接口契约 / `custom` 走通用流程)
- 会话 label = `label = <label>` 行;**不**强制影响评估,**仅**作诊断维度排序参考

---

## 五维度评估(ADR-0013 D4)

对 PRD 逐条评估以下 5 个维度,**每维度产出一张 card**(写法见下文「输出格式」):

| # | 维度 key | 含义 | 严重度 |
|---|---|---|---|
| 1 | `loss_prevention` | 资损安全:是否可能直接造成资金 / 数据 / 资产损失 | 🔴 资损 |
| 2 | `performance` | 性能:RT / 吞吐 / 资源占用是否达标 | 🟠 性能 |
| 3 | `arch_conflict` | 架构冲突:是否与现有架构 / 服务边界 / 数据流冲突 | 🟡 架构 |
| 4 | `business_reasonable` | 业务合理性:业务逻辑是否合理、目标是否清晰 | 🟢 业务 |
| 5 | `context_query` | 上下文确认:PRD 表述模糊 / 需用户确认细节 | 💬 上下文 |

**严重度归属规则**(默认映射,可在 Skill frontmatter 覆盖,但本 Skill 不开覆盖):

- 资损安全 → 🔴 资损(业务红线)
- 架构冲突(无法绕开) → 🟡 架构
- 架构冲突(可绕开) → 🟡 架构(有 workaround)
- 性能不达标 → 🟠 性能
- 业务合理性存疑 → 🟢 业务(需用户判断)
- 上下文 / 细节确认 → 💬 上下文(普通问答)

---

## 总体 verdict 规则

总体 verdict 由各 DIM 块的 `verdict` 字段决定(severity 仅作 UI 颜色 / 图标):
- `[DIM loss_prevention]` 的 `verdict: fail` → 总体 verdict = **❌ 准入失败**(用户可手动
  改为"接受风险"继续,本 Skill 不主动改 verdict)
- 其它任一 DIM 块的 `verdict: warn` → 总体 verdict = **⚠️ 待裁决**
- 5 个 DIM 块全部 `verdict: pass` → 总体 verdict = **✅ 准入通过**

注意:即使 loss_prevention 维度 `verdict: pass`,**仍然要输出**对应的 `[DIM loss_prevention]`
块(只是 verdict 字段填 pass),以便 AdmissionDashboard 5 卡完整呈现;不要"无问题就跳过该
维度块"。

---

## 输出格式(严格按此模板)

按以下顺序,逐 card 输出一段;card 间用空行分隔;**不要输出 markdown 标题**(Heading 由下
游 SSE 渲染层加),**不要代码块包裹**(plain text 即可):

```
[DIM loss_prevention]
verdict: pass | warn | fail
severity: 🔴
evidence: <PRD 中引发此判断的具体短语或事实,1-3 句,中文>
pending: <如有待用户裁决的事项;无则省略本行>
quote: <PRD 原文片段 1-2 句,用于 lineRange sanity check;可省略>

[DIM performance]
verdict: pass | warn | fail
severity: 🟠
evidence: <...>
pending: <...>
quote: <...>

[DIM arch_conflict]
verdict: pass | warn | fail
severity: 🟡
evidence: <...>
pending: <...>
quote: <...>

[DIM business_reasonable]
verdict: pass | warn | fail
severity: 🟢
evidence: <...>
pending: <...>
quote: <...>

[DIM context_query]
verdict: pass | warn | fail
severity: 💬
evidence: <...>
pending: <...>
quote: <...>

[VERDICT]
result: ✅ | ⚠️ | ❌
pending_count: <所有 DIM 块中 `pending:` 行去重后的总条数,整数>
summary: <1-2 句概括,中文,不超过 50 字>
```

### 字段约束

- `verdict` 严格三选一:`pass` / `warn` / `fail`;**不要**输出其他取值
- `severity` 严格按上表填,不要改 emoji
- `evidence` 至少 1 句,**必须**能在 PRD 原文里找到对应证据;不要凭空编
- `pending` 仅在 `verdict` 为 `warn` 或 `fail` 时输出;`pass` 则整行省略
- `pending` 内容 = 待裁决事项的 1 句描述,**简短**(中文,15 字以内)
- `quote` 选填,但**强烈建议**保留 1-2 句原文,便于下游 render 时做 lineRange sanity check
- `[VERDICT]` 块的 `result` 按上面"总体 verdict 规则"计算
- `pending_count` = `[DIM loss_prevention]` 到 `[DIM context_query]` 中所有 `pending:`
  行的条数(去重);不需要把 [VERDICT] 自身的 pending 也算进去(VERDICT 没 pending)

### 长度与语气

- 每个 DIM 的 `evidence` 控制在 1-3 句,**简短**(中文 30-80 字);不要长篇分析
- 不要写"建议 / 推荐 / 应该"等推销口吻;只描述事实与判断
- 不要输出 markdown 标题 / 代码块 / bullet list;plain text 即可

---

## 你不需要做的事

- ❌ 不需要拆模块 / 不需要列出聚合模块(那是 `requirement-brainstorm` Skill 的事)
- ❌ 不需要写技术概要 / 技术栈(那是 `tech-brief-scaffold` Skill 的事)
- ❌ 不需要复述 PRD 原文 / 不需要解释 PRD 是什么
- ❌ 不需要给用户"行动建议";evidence + pending 已经足够用户裁决

---

## 兜底(任意一条满足则按此输出)

- PRD 完全无法理解(如 <prd> 段为空) → 全部 5 维 `[DIM xxx]` 块的 verdict 都填 `fail`,
  evidence = "PRD 内容为空或无法解析",`[VERDICT] result: ❌`,`pending_count: 5`
- PRD 极短(< 5 行) → 至少 `context_query` 维度的 verdict = `warn`,evidence 列出缺失字段;
  其余维度按可推断的最严格口径评估