---
Status: ready-for-human
Type: prd
Created: 2026-07-19
Feature: prd-upload-and-edit
---

# PRD 文件上传与编辑接入(Feature PRD)

> 解决"创建 Requirement 时只能粘贴文本"与"ANALYZING 之后难以回头改 PRD"两个痛点;在 Dialog 与 DRAFTING 双入口接入 .md / .txt / .docx 上传;docx 图片抽到 `assets/`;覆盖上传无确认。

---

## 1. 一句话定位

让 PRD 不再是"长篇 markdown 文本",而是**可上传的文件** —— 产品经理交付 .docx,落地为 `requirement.md` + `assets/prd-*.{png,jpg,...}`;DRAFTING 工位随时可上传新版本覆盖。完整设计在 [ADR-0015](../../docs/adr/0015-prd-file-upload-and-editing.md)。

---

## 2. 用户故事与痛点

### 目标用户

后端开发者 / 产品经理协作下的"AI DevSpace"用户,使用 DRAFTING → ANALYZING → CLARIFYING → DESIGNING → EXECUTING → WRAP-UP 6 工位流(Vibecoding 主路径)。

### 痛点 A — 创建阶段只能粘贴

`RequirementCreateDialog` 现有"PRD 内容"步骤只接受纯文本粘贴。长 PRD(数万字)、带图 PRD、复杂表格 PRD 全部丢格式/丢图。**典型场景**:产品经理在 Notion / Word 里写完 PRD → 用户拷贝到 web → 重排版 → 丢图 → 心累。

### 痛点 B — ANALYZING 之后难回头改

PRD 经过 ANALYZING 准入校验后,用户想"再补一句"、"改个标题"、"纠正一段话"时找不到连贯的入口。`DRAFTING` 工位的 `<textarea>` 编辑器虽然能改 `requirement.md`,但**"上传一份新版本覆盖"这个动作未工具化**。

---

## 3. 决策摘要(grill 拍板,2026-07-19)

10 题 `/grill-with-docs` 决策账本(精简版;完整见 [ADR-0015](../../docs/adr/0015-prd-file-upload-and-editing.md)):

| 维度 | 决策 |
|---|---|
| 上传语义 | α 一次性导入(原文件丢弃) |
| 格式 | P0 = `.md / .txt / .docx` |
| 入口 | C 双入口(Dialog 预填 + DRAFTING 覆盖) |
| 可改范围 | B1 仅 `requirement.md` 正文,`meta.yaml` 不动 |
| 图片落地 | X2 `requirements/<id>/assets/`,相对路径 |
| 解析失败 | Z3 闸门 + Z1 顶部红条,不阻断流程 |
| 大小 | Y3 文件 ≤ 10 MB + 单图 ≤ 2 MB |
| 覆盖强度 | W4 无确认;git log 唯一后悔药(已知取舍,登记在 ADR D8) |
| 治理 | A1 一份合并 ADR + B1 `Asset` 术语 + C1 三 ticket |

---

## 4. 实施拆解

| # | Ticket | 状态 | 依赖 |
|---|---|---|---|
| 01 | [PRD 上传通道](issues/01-prd-upload-pipeline.md) | ready-for-agent | — |
| 02 | [assets/ 落地](issues/02-requirements-assets-landing.md) | ready-for-agent | ticket 01 |
| 03 | [DRAFTING 上传 + Dialog 预填](issues/03-drafting-upload-and-dialog-prefill.md) | ready-for-agent | ticket 01 |

ticket 02 与 ticket 03 可并行(ticket 03 不依赖 ticket 02 的落盘逻辑,只依赖 ticket 01 的前端闸门 + 服务端 `parseUpload`)。

---

## 5. 验收(端到端)

见 [ADR-0015 § 验证](../../docs/adr/0015-prd-file-upload-and-editing.md#验证本-adr-落地后的端到端验收)。3 个 ticket 各自的"验收"小节会重复列出相关 case。

---

## 6. 不在范围(明确剔除)

见 [ADR-0015 § 不在范围](../../docs/adr/0015-prd-file-upload-and-editing.md#不在范围明确剔除)。要点重复:

- 不动 `meta.yaml.title` / `tags` / `repos[]` / `status`
- 不做富文本 / WYSIWYG 编辑器
- 不做 `.pdf / .html / .pptx`
- 不做 `_history/` 旧版本存档
- 不做拖拽上传(留作 UI 优化)

---

## 7. 反向引用

- **设计细节**:[ADR-0015](../../docs/adr/0015-prd-file-upload-and-editing.md)
- **词汇表**:`Asset`(附件素材)已新增至 [CONTEXT.md § Asset](../../CONTEXT.md#asset附件素材)
- **关联既有决策**:决策 36(以 markdown 为单一真相源)、决策 71(Artifact 语义)
- **关联既有 ADR**:[ADR-0002](../../docs/adr/0002-filesystem-as-database.md) / [ADR-0006](../../docs/adr/0006-html-prototype-as-source-of-truth.md) / [ADR-0011](../../docs/adr/0011-requirement-workbench-zone-adaptive.md) / [ADR-0013](../../docs/adr/0013-analyzing-zone-rewrite.md)
