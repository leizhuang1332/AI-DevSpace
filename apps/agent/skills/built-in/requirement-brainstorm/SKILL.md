---
name: requirement-brainstorm
description: 按三桶(subproblem / risk / option)继续 brainstorm,带 source_refs 锚定 PRD / aux 原文出处
arming: always
recommended_user_override: true
---

# requirement-brainstorm

你的任务是接续上一轮 admission-check 的 5 维度结果(SDK 同 session 自动保留 history,
不需要重复 5 维度评估),继续 brainstorm 出**三桶**产物 chunk:

- `subproblem` — 还需澄清的子问题
- `risk` — 潜在风险点
- `option` — 可选方案 / 实现路径

这是 ANALYZING 工位的 turn-2(ADR-0020 D8);产物按 ADR-0017 D3 schema 落 chunks.jsonl,
并通过 SSE 推到 web 的 `<ProductList>` 三桶 UI。**每个 chunk 一条**(一段 plain text),
文本要短,中文 1-2 句。

---

## 🔴 输出格式硬约束(违反 = 产物全部丢失)

你的输出会被 `analysis-chunk-parser` **逐行**解析。解析器**只认独占一行的方括号标记**:
`[SUBPROBLEM]` / `[RISK]` / `[OPTION]` / `[SUBPROBLEM_EMPTY]` 等。

- ✅ 标记行必须**独占一行**、顶格、无任何前后缀
- ❌ 任何**没有标记**的行一律被降级为 `kind: 'narration'`,**不进入**「识别产物」三桶 UI
- ❌ 严禁输出 markdown 标题(`#` / `##`)、表格(`|`)、有序/无序列表(`1.` / `-`)、
  emoji 分组标题(如 `## 🪣 subproblem`)—— 这些都不是标记,会导致整轮产物为空
- ❌ 不要写导语、总结、"使用建议"等包裹性文字

**本轮唯一合法的输出形态**:若干个「标记行 + `text:` 行 + `source_refs:` 块」构成的段落,
段落之间用一个空行分隔。除此之外不要输出任何内容。

---

## 输入约定

- 你已经看过 PRD 全文(turn-1 user message 给过);不要再向用户索取 PRD
- 你已经看过 turn-1 的 5 维度评估;基于其中的 `pending` / `evidence` 衍生三桶产物
- 当前会话角度 = turn-1 user message 中的 `当前会话角度 = <angle>` 行;按需侧重
  - `architecture` → 多产出 `option`(架构方案)+ `risk`(架构冲突)
  - `data` → 多产出 `subproblem`(数据语义)+ `risk`(数据一致性)
  - `interface` → 多产出 `subproblem`(接口契约)+ `option`(接口设计)
  - `custom` → 均衡三类

---

## 三桶输出规则

按以下顺序逐 chunk 输出一段;每个 chunk 内部字段严格遵循下面 schema;chunk 间空行分隔;
**不要**输出 markdown 标题 / 代码块 / bullet list;plain text 即可。

### `subproblem` 子问题桶

```
[SUBPROBLEM]
text: <1-2 句中文,15-40 字,简短清晰,可被用户裁决>
source_refs:
  - prd:<start_line>-<end_line> "<原文片段 1-2 句>"
```

### `risk` 风险桶

```
[RISK]
text: <1-2 句中文,15-40 字,具体描述风险与后果>
source_refs:
  - prd:<start_line>-<end_line> "<原文片段 1-2 句>"
```

### `option` 方案桶

```
[OPTION]
text: <1-2 句中文,15-40 字,方案要点 + 适用场景>
source_refs:
  - prd:<start_line>-<end_line> "<原文片段 1-2 句>"
```

---

## source_refs 字段约束(ADR-0017 D3)

- 每个 chunk **必须**带 ≥1 条 source_refs;否则下游 UI 会显示"⚠️ 无出处"角标
- `prd:<start_line>-<end_line>` 是 0-based 半开区间 `[start, end)`,对齐 `extractPrdAnchors`
  (packages/shared/src/drafting.ts) 既有约定
- lineRange 内必须有 PRD 真实行内容;**不要编造**
- `<原文片段>` 字段是 quote,用于 SSR 兜底渲染 + lineRange 漂移 sanity check,**强烈建议**
  保留 1-2 句
- 如果 chunk 的判断来自 aux 文件(非 PRD),用 `aux:<auxId>:<start_line>-<end_line>` 格式:
  ```
  source_refs:
    - aux:api-spec.md:12-18 "<原文片段>"
  ```
- 如果 chunk 的判断来自图片(asset),用 `asset:<assetId>` 格式(无 lineRange):
  ```
  source_refs:
    - asset:prd-1
  ```
- 多个 source 时可换行续写,但同 chunk 内 `text` 必须 1-2 句

---

## 三桶产出数量(参考下限)

不必硬凑,但请尽量覆盖下列下限(允许更多,但每桶 ≤ 8 条以避免 UI 刷屏):

- `subproblem` ≥ 3 条
- `risk` ≥ 2 条
- `option` ≥ 1 条

如果某桶确实没产物(turn-1 已充分覆盖,无新增问题)→ 可以 0 条,但请用 1 段说明:
```
[SUBPROBLEM_EMPTY]
text: turn-1 5 维度已覆盖,无新增子问题。
```

---

## 长度与语气

- 每个 chunk 的 `text` 控制在中文 15-40 字,**简短**
- 不要写"建议 / 推荐 / 应该"等推销口吻;只描述事实与判断
- 不要输出 markdown 标题 / 代码块 / bullet list;plain text 即可
- 不要重复 turn-1 admission-check 已经覆盖过的"是否合理"等元判断;只产出三桶具体内容

---

## 你不需要做的事

- ❌ 不需要再做 5 维度准入校验(turn-1 已做)
- ❌ 不需要写技术概要 / 技术栈(那是 `tech-brief-scaffold` Skill 的事)
- ❌ 不需要复述 PRD 原文
- ❌ 不需要给用户"行动建议";每个 chunk 已足够具体
- ❌ 不要输出 `(narration)` / `(thinking)` 这类过程性 chunk;本 Skill 只产三桶

---

## 兜底

- 如果 turn-1 完全没有可用信息(5 维度都 `fail` 且 PRD 为空)→ 全部 3 桶各产 1 条占位,
  text = "因 PRD 缺失无法 brainstorm",source_refs 留空(或省去整字段)

---

## 范例(仅结构参考,真实 PRD 下文字应替换)

```
[SUBPROBLEM]
text: 单笔退款金额上限是否随用户等级差异化?
source_refs:
  - prd:8-12 "退款单笔金额上限 ≤ 1000 元"

[RISK]
text: 现有退款审核流依赖财务人工,新增 1000 元以下免审路径可能导致风控盲区。
source_refs:
  - prd:14-18 "退款审核流由财务人工审核"

[OPTION]
text: 异步多阶段事件驱动 + 幂等网关,可将退款入口 RT 控制在 80ms 内。
source_refs:
  - prd:22-26 "退款失败时回滚优惠券 / 库存"
```