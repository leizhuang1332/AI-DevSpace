# ADR-0015: PRD 文件上传与编辑接入方式

**Status:** Accepted
**Date:** 2026-07-19
**Deciders:** 项目负责人(经 `/grill-with-docs` 拍板)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 36("以 markdown 为单一真相源" / ADR-0006),决策 71(Artifact 语义)

**关联 ADR:**
- [ADR-0002](0002-filesystem-as-database.md) — 纯文件系统存储(meta.yaml + 产物目录);本 ADR 落地点 `requirements/<id>/assets/` 沿用此约定
- [ADR-0006](0006-html-prototype-as-source-of-truth.md) — markdown 为单一真相源;`α` 一次性导入是此原则在 PRD 上的延伸
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md) — DRAFTING 工位"写需求 PRD";本 ADR 的"上传覆盖"挂在该工位上
- [ADR-0013](0013-analyzing-zone-rewrite.md) — ANALYZING 准入校验吃 `requirement.md` 作为输入;`assets/` 抽取后准入校验读 docx 图仍可走相对路径

**关联 ticket:** `.scratch/prd-upload-and-edit/issues/01..03`

---

## Context

### 起点

PRD(产品需求文档)是这个产品的核心对象([CONTEXT.md](../CONTEXT.md) § Requirement,决策 36 锁"以 markdown 为唯一真相源")。当前 PRD 在文件系统中就是 `requirements/<req-id>/requirement.md` 这一个 markdown 文件,由 [ticket 05](file:///Users/Ray/TraeProjects/AI-DevSpace/.scratch/ai-devspace-mvp/issues/05-requirement-crud.md) 端到端跑通了 CRUD。

但有两个**真实痛点**没解决(2026-07-19 项目负责人 `/grill-with-docs` 拍板):

1. **创建时只能粘贴**:`RequirementCreateDialog` 现有"PRD 内容"输入只接受纯文本粘贴。
   - 长 PRD(数万字)的浏览器粘贴常常丢失样式、丢失图片、丢失表格对齐
   - 外部协作场景:产品经理常以 `.docx` 写作并交付;团队长期依赖"先把 docx 转成 md 再粘贴"的低效率手工链路
2. **ANALYZING 之后难回头改**:DRAFTING 工位的 `<textarea>` 编辑器虽然能改 `requirement.md`,但走完 ANALYZING 工位后,用户再难快速定位"再改一下需求"的入口——这不是 DRAFTING 工具的缺陷,是落盘路径上的"覆盖动作"没有显式化。

**项目硬约束**(从已有决策推导,无可让步):
- 决策 36 / ADR-0006:所有内容是 markdown 文件,UI POLISH SPEC、设计稿、PRD 没有例外
- [CONTEXT.md](../CONTEXT.md) 决策 71:`artifacts/` 是 AI 产出物的语义,**不允许混入用户原始输入**
- 没有数据库,所有数据走文件系统(ADR-0002)
- Next.js 14 Edge-friendly:解析库优先选纯 JS、无 native binding(影响 mammoth vs pdf-parse 选型)

### 三个候选方向的早期淘汰

`/grill-with-docs` 在第 2 题直接淘汰了"附件式(β)"与"持续同步(γ)":

| 方向 | 落点 | 为什么不做 |
|---|---|---|
| β 附件式 | 文件存 `attachments/`,md 是副本 | 与决策 36(md 为唯一真相源)直接冲突;用户也没有"继续在 docx 里改"的合理诉求 |
| γ 持续同步 | 外部 SaaS 是真相源,本产品是投影 | 需要对接 Notion / 飞书的双向同步、权限、评论锚点,是另一个产品;不在 MVP 范围 |

唯一可用方向是 **α 一次性导入**。

### 用户决策(2026-07-19,`/grill-with-docs` Q2)

> "选择 α:上传即解析入 requirement.md,丢原文件"

### 一组待决策的设计维度

`/grill-with-docs` 在 α 之上提了 6 个维度,逐个拍板如下(下文 Decision 直接引用编号):

| 维度 | 决策 | 备注 |
|---|---|---|
| 上传语义 | α:文件 → 解析 → 烤进 `requirement.md`,原文件不保留 | Q2 |
| 支持格式 | P0:`.md / .txt / .docx`;其余延后 | Q3 |
| 入口摆位 | C:**双入口** = `RequirementCreateDialog`(预填)+ DRAFTING 工位(覆盖替换);两处共用 `validateUpload` 与上传组件 | Q4 |
| 可改范围 | B1:**仅** `requirement.md` 正文;`meta.yaml`(`title` / `tags` / `repos[]` / `status`)一律不动 | Q5 |
| 图片落地 | X2:docx 解出的图片抽到 `requirements/<id>/assets/prd-<n>.<ext>`,markdown 用相对路径 `![](assets/prd-1.png)` | Q6 |
| 解析失败兜底 | Z3(闸门 `ext`+`magic bytes`+`MIME`)+ Z1(顶部红条,不阻断) | Q7 |
| 大小上限 | Y3:**文件 ≤ 10 MB** + **单图 ≤ 2 MB**;任一图超限整体拒绝 | Q8 |
| 覆盖强度 | W4:**上传即覆盖 `requirement.md`,无 modal / 无 diff / 无历史快照**;git log 是唯一后悔药 | Q9 |

---

## Decision

### D1. 上传语义为 α

任何上传入口最终都走到同一个流:**文件 → 校验 → 解析 → 抽取图片 → 写入 `requirement.md` + `assets/` → 丢弃原文件**。

原文件不保留在 `<id>/uploads/` 之类的位置。它与 α 一起构成"以 `requirement.md` 为唯一真相源"在 PRD 上的延伸(决策 36)。

### D2. 格式边界:仅 `.md` / `.txt` / `.docx`

- `.md / .txt`:直接读取,零成本
- `.docx`:用 [`mammoth`](https://github.com/mwilliamson/mammoth.js) 转换为 markdown;图片默认输出 `data:` URI,**但本 ADR D5 会二次抽出**
- `.pdf (文本型)`、`.pdf (扫描型)`、`.html`、`.pptx`:**不做**

为何不做 pdf 文本型:`pdfjs-dist` 包体 ~500KB;扫描型需 OCR(`tesseract.js` 或 PaddleOCR),首次启动慢、有 native binding 污染"轻 Web app"体感。如果真实需求出现,P1 加入。

### D3. 入口摆位:双入口 C

- **`RequirementCreateDialog` 增加"上传"按钮**(预填模式)
  - 选文件 → `validateUpload()` 通过 → 解析 markdown 到 textarea,**不写盘**
  - 用户继续走现有"创建"流程(填 title / 选 repo / 点创建),在那一刻才落盘
- **DRAFTING 工位增加"上传新版本"按钮**(覆盖模式)
  - 选文件 → `validateUpload()` 通过 → 解析 → **直接覆盖 `requirement.md`**(W4 强度)+ 同步写盘 `assets/`(若有图)
  - 刷新当前页面 state,本地 `prdMarkdown` 重新加载

两处共用前端 `apps/web/src/lib/requirement-upload.ts`,后端共用 `apps/agent` `RequirementService.parseUpload(buffer, filename)` + `RequirementService.landAssets(reqId, images)`。

### D4. 可改范围为 B1(仅正文)

DRAFTING 工位只允许改 `requirement.md` 正文(`<textarea>` 已经存在,无需新编辑器)。

- **不动** `meta.yaml.title` / `meta.yaml.tags[]`(即使改也是 5 行代码,但本次不做)
- **不动** `meta.yaml.repos[]`(加减会触发 `git worktree` 增删,属于 06-repo-worktree 的边界)
- **不动** `meta.yaml.status`(状态推进由用户切工位触发,不在上传路径上动)

这一约束的代价是**docx 文件内首行如果是 `# 新标题`,落地后 `meta.yaml.title` 不会跟着更新**。本 ADR 接受这个不一致(用户单独在列表页/详情页 header 改 title 即可)。

### D5. docx 图片落地 X2(`assets/`)

- 服务端解析 .docx 时,把 mammoth 输出的每个 `data:image/png;base64,...` 抽出
- 按出现顺序命名为 `prd-1.<ext>`、`prd-2.<ext>` …… 写入 `requirements/<req-id>/assets/`
- markdown 中的对应位置替换为相对路径:`![](assets/prd-1.png)`
- `RequirementService.get(reqId)` 返回值补充 `assets: [{name, url, size, mime}]`
- `RequirementService.list()` 的资源树扫描**忽略 `_` 前缀目录**(沿用既有 `_archived/` 处理),**`assets/` 不带下划线因此纳入**——这是有意为之,因为 assets 是用户后续会想引用的资源(下拉工位、ANALYZING 等可能用)

`assets/` 子目录与现有 `artifacts/` 语义不重叠(见 [CONTEXT.md](../CONTEXT.md) 决策 71):
- `artifacts/`:AI 产出物(SQL / OpenAPI / 序列图 / 测试用例等)
- `assets/`:用户原始输入中的非代码资源(docx 图片为主)

### D6. 前端闸门 Z3(`validateUpload()`)

抽到 `apps/web/src/lib/requirement-upload.ts`,Dialog / DRAFTING 两处共享,导出:

```ts
validateUpload(file: File): {ok: true} | {ok: false, reason: 'ext' | 'mime' | 'magic' | 'size' | 'image-too-large'}
```

判定规则:

| 检查 | 触发 `ok: false` |
|---|---|
| 扩展名 | ext ∉ `.md .txt .docx` |
| MIME | 不在白名单:`text/markdown`、`text/plain`、`application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| Magic bytes | `.docx` 必须以 `PK\x03\x04` 开头;`.md/.txt` 无 magic,用 ext 兜底 |
| 文件大小 | `file.size > 10 MB` |
| 内嵌图片 | docx 解析后,**任一图片**解 base64 字节数 > 2 MB,整体拒绝(在 `parseUpload()` 服务端做,因为前端看不到 base64) |

未通过时 Dialog/DRAFTING 显示顶部红条文案:

> ⚠️ 无法解析此文件(可能加密或格式不兼容 / 超过大小上限 / 包含过大图片)。下方空白,你可以继续粘贴文本,或者换一份文件再试。

### D7. 大小上限 Y3

| 阈值 | 值 | 位置 |
|---|---|---|
| 上传文件 | ≤ 10 MB | 前端闸门 |
| docx 内任一图片 | ≤ 2 MB(解 base64 后) | 服务端 `parseUpload()` |

10 MB 选 5 MB/10 MB/分档(决策 Y1/Y2/Y3)中的 Y3——文件上限给 PM 足够空间,但单图 2 MB 是 `assets/` 落地的可读性闸门。

### D8. 覆盖强度 W4(已知取舍)

**DRAFTING 的"上传新版本"无任何确认交互**:点按钮 → 选文件 → 直接覆盖 `requirement.md` → 重新渲染。

**取消了我作为推荐方的 W3(diff 预览 + 输入"覆盖" + 历史快照)**——项目负责人明确选择 W4,理由是:

> 当前工具是单人 / 早期 / git log 是真实后悔药

**此决策的代价登记在此**(给未来的协作者):

- **T1 误传错的 docx**(例如 PM 导出时选错附件版本)→ 内容直接覆盖,用户必须靠 git log 自救
- **T2 DRAFTING textarea 里有未触发 autosave 的本地编辑** → 上传覆盖会丢弃这部分编辑(用户认知中的"当前草稿")
- **T3 多人协作场景** → 此方案下"上传即覆盖"是定时炸弹;**ADR 备注:若引入多人协作必须重新审视本决策**

为何不强行加 modal:W3 的 7 步确认流程在"高频换版"场景下会成阻力,且 git 是这个项目的真理源(`/Users/Ray/TraeProjects/AI-DevSpace/.scratch/ai-devspace-mvp/issues/02-workspace-init.md` 起的 git 全程在跑)。本 ADR 接受 W4 的代价,但**未来若有协作者加入或产品化到对外客户场景,优先升级到 W2.5(diff 预览 + 一键确认),不直接跳到 W3(避免 W3 的"输入覆盖"输入法造成新摩擦)**。

---

## Consequences

### 正面

- **痛点 A 直接解决**:docx 用户上传即落地,无需"先转 md 再粘贴"的手工环节
- **痛点 B 解锁**:DRAFTING"上传新版本"按钮即用即改,且不破坏现有 `requirement.md` 数据契约
- **决策 36 / 71 一致性**:`assets/` 子目录不污染 artifacts/ 语义,术语清晰
- **包体可控**:mammoth 纯 JS,Edge-friendly;前端+服务端没有 native binding 污染
- **解析管道共享**:Dialog / DRAFTING 共用 `validateUpload` + `parseUpload` + `landAssets`,实现简单、测试完备

### 负面 / 已知代价

- **α 的有损代价**(老问题,但本 ADR 仍然接受):docx 的修订批注 / 目录 / 脚注 / 嵌入版式 转入 md 会丢;**用户上传一份带配图的产品 PRD,大概率丢图以外的格式信息**
- **W4 的代价**(本 ADR 接受,见 D8)
- **`assets/` 子目录让 `RequirementService.list()` 资源树扫描需要明确"含 assets/ 不含 _*/"规则**——已在 D5 阐述
- **`meta.yaml.title` 不会随 docx 文件首行 `# title` 同步更新**——用户必须单独改(在 D4 接受)
- **pdf / html / pptx 暂不支持**——若产品定位升级,需要新 ADR 重审 D2

### 对未来 ticket 的强约束

- 任何后续在 DRAFTING 引入"标题 / 标签 / 关联 repo 编辑器"的 PR,需先把本 ADR 升版(扩 D4)+ 关联到新 ADR
- 任何把 DRAFTING 改为多人实时协作的 PR,需重审 D8(W4 → 至少 W2.5)
- `assets/` 落地规则一旦上线,后向兼容旧 Requirement(没有 `assets/` 的)需要 `RequirementService.get()` 返回空 `assets[]`

---

## Alternatives considered

仅记录**用户曾严肃考虑**但**被反选**的方案。详见 `/grill-with-docs` Q1–Q9 决策账本:

- β(附件式)→ 与决策 36 冲突,淘汰于 Q2
- γ(持续同步)→ 是另一个产品,淘汰于 Q2
- W2.5(diff 预览 + 一键确认,无 _history/)→ 用户明确选 W4,登记在此作未来升级参考
- W3(完整 diff + 输入确认 + 未保存警告 + 历史快照)→ 用户嫌繁琐,选 W4
- 仅 Dialog 上传 / 仅 DRAFTING 上传 → 痛点 A/B 二选一,被 C 双入口取代
- `_history/` 子目录(存档旧版本)→ 与 W4 互斥,未引入

---

## 实施细节(本 ADR 落地的 ticket)

三个 ticket,落到 `.scratch/prd-upload-and-edit/issues/`:

1. **`.scratch/prd-upload-and-edit/issues/01-prd-upload-pipeline.md`**
   - apps/agent:`RequirementService.parseUpload(buffer, filename)` —— `.md/.txt` 直读;`.docx` 走 mammoth;返回 `{markdown, images: [{name, base64, mime}]}`
   - apps/web:`lib/requirement-upload.ts` 提供 `validateUpload(file)` —— Z3 闸门 + Y3 文件大小检查
   - 装依赖:`mammoth`

2. **`.scratch/prd-upload-and-edit/issues/02-requirements-assets-landing.md`**
   - apps/agent:`RequirementService.landAssets(reqId, images)` —— 把 mammoth 给的 base64 images 按顺序写盘到 `requirements/<id>/assets/prd-<n>.<ext>`,替换 markdown data URI 为相对路径
   - `RequirementService.get(reqId)` 返回值补充 `assets[]`
   - `RequirementService.list()` 资源树扫描忽略 `_` 前缀目录
   - apps/web:MarkdownPreview 渲染时把 `assets/prd-1.png` 解析成正确 src

3. **`.scratch/prd-upload-and-edit/issues/03-drafting-upload-and-dialog-prefill.md`**
   - apps/web:`components/drafting-prd-pane.tsx` 加"上传新版本"按钮(D8 W4 强度)
   - `RequirementCreateDialog`:加"上传文件"按钮,在 textarea 旁,选完文件就预填
   - 两处共用 `lib/requirement-upload.ts`
   - 单元测试覆盖两条入口

### Ticket 间依赖

```
ticket 01 (parseUpload + validateUpload)
   ↓
ticket 02 (landAssets,继承 ticket 01 的图片数组)
   ↓
ticket 03 (UI 入口,继承 ticket 01 的 validateUpload)
```

ticket 02 与 ticket 03 可并行(ticket 03 不依赖 02 的落盘逻辑,只依赖 01 的前端闸门)。

---

## 验证(本 ADR 落地后的端到端验收)

> 由 ticket 01/02/03 的"验收"小节共同承担,本节是汇总视角。

1. **创建场景**:在 Dialog 上传一份 1 MB 的 docx(含 3 张 ≤ 2 MB 的 PNG)→ 解析后 textarea 预填成功 → 填 title / 选 repo / 创建 → 列表页出现新 Requirement → 详情页 DRAFTING 进入看到完整 PRD(含图片以 `assets/prd-1.png` 路径渲染)
2. **回头修改场景**:在 DRAFTING 上传一份新版本的 docx → 不弹 modal → 立即看到新版 PRD → git log 中能找到旧版 commit
3. **闸门测试**:上传 `.rar` / `.exe` / 加密 docx / 超过 10 MB 的 docx / 包含 5 MB 图片的 docx 五种,均被前端闸门(前三)或服务端图像字节检查(后二)阻断并显示顶部红条
4. **回归**:粘贴纯 markdown 创建需求,现有流程不变(meta.yaml 字段冻结、不引入 status)
5. **资源树**:`list()` 返回的 resource tree 不应包含 `assets/` 下的图片文件而仅列出 `requirement.md`(下划线规则为更通用的兜底,实际是否纳入可视化由 UI 决定)

---

## 不在范围(明确剔除)

- `meta.yaml.title` / `tags` / `repos` / `status` 在 DRAFTING 可改(D4 锁 B1)
- 多人协作编辑(W4 锁)
- docx 修订批注 / 注释 / 目录 / 脚注无损转换(α 的已知代价,接受)
- 富文本/WYSIWYG 编辑器(TipTap / Monaco / CodeMirror)(B1 用现有 textarea 即可;若日后扩 D4,再起 ADR)
- `.pdf` (文本型 + 扫描型) / `.html` / `.pptx`(D2 锁 P0)
- Dialog 选 repo 阶段预填 docx 图(ticket 03 范围之外)
- `_history/` 旧版本存档子目录(与 W4 互斥)
- 拖拽上传(留作 UI 优化,不在本 ADR 范围;同入口的"按钮点开文件选择器"已能满足功能)

---

## 反向引用(本 ADR 引用 / 被引用)

**本 ADR 引用:**
- [CONTEXT.md](../CONTEXT.md) 决策 36 / 71
- [ADR-0002](0002-filesystem-as-database.md)
- [ADR-0006](0006-html-prototype-as-source-of-truth.md)
- [ADR-0011](0011-requirement-workbench-zone-adaptive.md)
- [ADR-0013](0013-analyzing-zone-rewrite.md)

**本 ADR 新增术语(进 CONTEXT.md):**
- `Asset`(附件素材):详见 [CONTEXT.md](../CONTEXT.md) § Asset

**未来可能引用本 ADR 的场景:**
- 任何 PRD 解析相关工作都从本 ADR 起手
- DRAFTING 编辑器升级 → 重审 D4
- 多人协作引入 → 重审 D8

---

## 关键提醒(给 ticket 实施者)

- **不要在 W4 上做软确认**(modal / diff / 输入确认)——本 ADR 已明确为 W4,任何"善意加一道保护"都是 scope creep
- **`assets/` 与 `artifacts/` 严格隔离**:混用是技术债,违背决策 71
- **Z3 闸门不要漏 MIME**:`text/plain` 与 `application/octet-stream` 是常见浏览器跨平台上传的 MIME 漂移
- **`magic bytes` 仅在 `.docx` 上要求**(ZIP 头);`.md/.txt` 无 magic,以 ext + MIME 双保险即可
- **`assets/` 命名顺序**要保证 mammoth 输出顺序稳定(mammoth 已知稳定,但 ticket 02 要写测试断言)
- **不要在 ticket 03 里顺手改 `meta.yaml`**——任何超 D4 的改动需先升 ADR
