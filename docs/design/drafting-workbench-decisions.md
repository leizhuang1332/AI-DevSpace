---
Status: reference
Type: design-decisions
Audience: DRAFTING 工位落地开发 / 二次设计评审者
Source-of-truth:
  - docs/design/pages/19a-drafting-files-equal.html      (方案 A · 文件平等 · 未采纳)
  - docs/design/pages/19b-drafting-prd-top-files-bottom.html  (方案 B 原型)
  - docs/design/pages/19c-drafting-ide-file-tree.html    (方案 C · IDE 风格 · 未采纳)
  - docs/design/pages/19b-2a-tree-prd-only.html          (资源树变体 A · 未采纳)
  - docs/design/pages/19b-2b-tree-unified.html           (资源树变体 B · 未采纳)
  - docs/design/pages/19b-2c-no-tree-anchor.html         (资源树变体 C · ✅采纳)
  - docs/design/pages/19c-2a-prd-compress.html           (交互变体 A · 未采纳)
  - docs/design/pages/19c-2b-drawer.html                 (交互变体 B · ✅采纳)
  - docs/design/pages/19c-2c-modal.html                  (交互变体 C · 未采纳)
  - docs/design/pages/19c-2d-fullscreen.html             (交互变体 D · 未采纳)
  - docs/design/drafting-workbench-context.md            (现状速读)
  - docs/adr/0011-requirement-workbench-zone-adaptive.md (DRAFTING 工位 ADR)
  - docs/adr/0012-requirement-workbench-shell-topology.md
---

# DRAFTING 工位 · 二次设计最终决策

> 本文档是 **DRAFTING 工位二次设计 grilling 会话的结果**。
> 14 轮决策全部确认，所有原型已落地。本文档是落地的"决策单一事实源"。
>
> **过程文档**：[drafting-workbench-context.md](drafting-workbench-context.md)（现状速读 + 二次设计前的已知边界）
> **设计探索**：上述 10 个 HTML 原型，每个都有 ASCII wireframe + 优缺点分析
> **决策流程**：grilling 会话（一次一决策，本文档落地）

---

## 0 · 30 秒摘要

DRAFTING 工位从"创建 PRD 的表单页"**重定位为"准备原料 + 简单加工"**，PRD 不再是创建入口的产物，而是顶级文件。所有产物（PRD + 辅助文件）在落地态全部为 `.md`，docx/pdf 上传后 mock 转 md。

**最终方案 = 方案 B（PRD 顶置型）+ 资源树变体 C（无树 + PRD 锚点条）+ 交互变体 B（右侧抽屉）**。

| 维度 | 最终选择 | 备选（未采纳） |
|---|---|---|
| 主区默认布局 | PRD 顶置型（PRD 占上半 60%，辅助文件卡片占下半 40%，可拖拽） | 文件平等 / IDE 风格 |
| 资源树 | 无 | 仅 PRD 大纲 / 一体化导航 |
| PRD 锚点条 | PRD 编辑器顶部 H1/H2 横排锚点条（滚动定位 + 1.5s 高亮） | 资源树代替 |
| 辅助文件点击交互 | 右侧抽屉 60% 宽（从右滑入），主区半透明遮罩 | 上下分栏 / 模态框 / 全屏 |
| 文件物理格式 | 全部 `.md`（docx/pdf 上传后 mock 转 md，UI 标 ↻ 已转 MD） | 保留原格式 |
| Launch 门槛 | PRD 必填 + 仓库可选 + 软警告 | 仓库/辅助文件强必填 |
| 文件切换 | 仅依赖卡片点击（无 ⌘P 全局搜索） | ⌘P / 最近打开下拉 |
| 文件用途标签 | 上传/新建时用户选（API 草案 / 数据字典 / 调研 / SOP / UI 草图 / 其他） | 按文件名推断 / 统一图标 |
| PRD 与辅助文件关系 | 支持相对路径 Markdown 链接 `[xxx](./api.md)` | 纯独立 / wiki-link |
| 本期工程范围 | 纯前端 UI + mock（不上后端 Agent） | 接 pandoc/Tika |

---

## 1 · 14 轮决策完整记录

### 决策 1：PRD 概念如何处理
**问题**：PRD（需求主文档）在新 DRAFTING 中还存在吗？
**选择**：**A. PRD 仍是顶级文件，但可加辅助文件**
**理由**：保留 PRD 在工作流中的核心地位，ANALYZING 工位仍以 PRD 为首要消费对象；扩展 DRAFTING 工位的灵活性，支持 PRD 之外的辅助上下文。

### 决策 2：DRAFTING 主区默认呈现
**问题**：PRD 与辅助文件在视觉上是同级还是有层级差？
**选择**：用 HTML UI 原型展示（3 方案 → A/B/C） → 用户最终选 ② PRD 顶置型（方案 B）
**理由**：保留表单驱动感，PRD 始终可见 + 可编辑；与现状改动最小；用户心智负担最低。

### 决策 3：PRD 标题字段如何处理
**问题**：PRD 的"标题"字段如何处理？
**选择**：**A. 标题是单独表单字段（继承现状）**
**理由**：PRD 标题独立于文件内容，作为 meta.yaml 中的 name 与左侧导航卡片名；创建时只需要标题 + 空白文档；与 11a 现状一致，最小改动。

### 决策 4：PRD 区与辅助文件区的高度分配
**问题**：PRD 顶置区与辅助文件区的视觉分配？
**选择**：**B + C：PRD 区最大 60% 高度 + 用户可拖拽分割条**
**理由**：保证辅助文件始终可见至少 1 行；给用户自由度分配高度。

### 决策 5：PRD 是否必须有
**问题**：PRD 在 DRAFTING 里是必须有还是可以没有？
**选择**：**A. PRD 必填（必须有且不可删）**
**理由**：PRD 是需求的核心载体，进入 ANALYZING 前必须有 PRD 主文档；不可删除以保证流程完整性。

### 决策 6：资源树是否保留
**问题**：方案 B 中是否保留左侧资源树？
**选择**：HTML UI 原型展示（3 变体） → 用户最终选 **C. 去掉资源树，PRD 编辑器顶部加锚点条**
**理由**：主区横向空间最大；学习成本最低；PRD 章节大纲的导航功能由 PRD 编辑器顶部锚点条承担（H1/H2 横排）。

### 决策 7：辅助文件点击交互
**问题**：辅助文件卡片点击后如何进入查看/编辑？
**选择**：HTML UI 原型展示（4 变体） → 用户最终选 **B. 右侧抽屉（60% 宽，从右滑入）**
**理由**：主区保持原状（PRD 顶置 + 辅助列表），用户可一眼看到 PRD 上下文；抽屉专注编辑辅助文件；切换成本低（点 ✕ 关闭即返回）。

### 决策 8："进入 ANALYZING"的触发条件
**问题**：Launch 门槛是什么？
**选择**：**C. PRD 必填 + 仓库可选 + 软警告**
**理由**：硬门槛只有 PRD（标题 + prdMarkdown 有内容）；仓库勾选可选但有警告提示（"未勾选仓库，ANALYZING 可能无法关联代码"）；辅助文件完全可选。

### 决策 9：docx/pdf 自动转 md 的实现
**问题**：docx/pdf 上传后的"自动转 md"本期是否真做？
**选择**：**不做，本期只做前端 UI + mock**
**理由**：本期是 mock 阶段，所有上传/转换是表面行为；后端 Agent API 接入留待下期；UI 上仍显示 ↻ 已转 MD 标签以保持完整体验。

### 决策 10：没有资源树后文件怎么切换
**问题**：多文件场景下如何快速切换？
**选择**：**B. 仅依赖点击卡片（辅助文件数量少）**
**理由**：MVP 阶段假设辅助文件 ≤ 10 个，手动点击可行；不加 ⌘P 减少工程量。

### 决策 11：PRD 锚点条行为
**问题**：PRD 顶部锚点条上的 H1/H2 链接点击后的行为？
**选择**：**A. 滚动定位 + 临时高亮 1.5 秒**
**理由**：最直接有效；与用户对大纲跳转的心智一致；1.5 秒高亮足以引导视线而不干扰。

### 决策 12：辅助文件用途标签
**问题**：辅助文件是否需要"类型标签"？（用户反问锐化问题）
**用户洞察**：所有上传文件都转 md，**"格式"维度被合并**，按后缀名识别无意义。
**重构后问题**：卡片上的图标如何决定？
**选择**：**A. 上传时用户选用途标签**
**可用标签**：API 草案（📐）/ 数据字典（📊）/ 调研（📑）/ SOP（📄）/ UI 草图（🎨）/ 其他（📝）
**理由**：格式统一为 md 后，图标只能代表内容用途；用户选择保证语义清晰；为后续 ANALYZING 阶段提供识别基础。

### 决策 13：空 PRD 初始状态
**问题**：用户创建空需求首次进入 DRAFTING，PRD 显示什么？
**选择**：**A + 补充：PRD 自动有骨架 + 支持用户上传 .md 作为 PRD（上传后自动填充）**
**骨架内容**：
```
# {需求标题}
## 背景
## 目标
## 验收标准
## 非目标
```
**理由**：零学习成本；保证 PRD 必填 + ANALYZING 阶段有结构化输入；用户上传 .md 时直接覆盖骨架。

### 决策 14：PRD 与辅助文件互相引用
**问题**：PRD 主文档与辅助文件之间能否互相引用？
**选择**：**A. 支持相对路径 Markdown 链接**
**示例**：`[API 草案](./api-draft.md)`
**理由**：Markdown 标准语法；点击触发抽屉打开对应文件；辅助文件也可互引；编辑器不需要特殊 wiki-link 解析。

---

## 2 · 领域模型（Grilling 后锐化的概念）

### 2.1 文件对象

```
File {
  id: string              // 内部唯一 ID
  requirement_id: string  // 所属需求
  type: 'PRD' | 'AUX'     // 顶级 / 辅助（必填二选一，PRD 唯一）
  usage_tag: UsageTag     // PRD 固定 PRD；AUX 可选 (api/data/research/sop/ui/other)
  title: string           // PRD 有；AUX 默认用 filename
  filename: string        // 物理文件名（必填，.md 后缀）
  content_markdown: string// md 正文（PRD 必填；AUX 可空）
  created_at: timestamp
  updated_at: timestamp
  status: 'draft' | 'reviewed' | 'archived'
  source_format: 'md' | 'docx' | 'pdf'  // 仅 AUX 有意义，记录原始格式（mock）
  converted_to_md: bool   // 仅 AUX 有意义
}
```

### 2.2 关键不变量

1. **每个 requirement 恰好 1 个 PRD 文件，不可删除**
2. **所有文件物理格式为 `.md`**（AUX 的 docx/pdf 上传后 mock 转 md）
3. **PRD.title 与 PRD.filename 关联**（filename 默认 `prd.md`，title 独立存于 meta.yaml）
4. **辅助文件 ≤ N 个**（MVP 假设 ≤ 10，不加 ⌘P 全局搜索）

### 2.3 关键交互

| 动作 | 触发条件 | 行为 |
|---|---|---|
| 进入 DRAFTING | URL `/requirements/<id>/drafting/` 或 ZoneBar | 显示 PRD 顶置 + 辅助文件卡片；PRD 自动填充骨架 |
| 编辑 PRD | 顶置区 title input / Markdown editor | 30s 自动保存 |
| 上传/新建 PRD | 顶置区 📂 上传按钮 / ＋ 新建按钮 | 上传 .md 直接覆盖；新建 PRD 自动骨架 |
| 编辑辅助文件 | 卡片点击 | 右侧抽屉滑入（60% 宽），独立编辑器 |
| 新建辅助文件 | 卡片区 ＋ 新建按钮 | 弹窗让用户填：filename + usage_tag |
| 上传辅助文件 | 卡片区 📁 上传按钮 | 弹窗让用户选文件 + 用途标签 → mock 转 md |
| PRD 锚点跳转 | PRD 顶部锚点条 H1/H2 点击 | 滚动到对应行 + 高亮 1.5s |
| 文件间引用 | Markdown 文本中 `./xxx.md` 点击 | 抽屉打开目标文件 |
| 切换工位 | ZoneBar / StatusBar / 面包屑 | 用户主动切，AI 不主动 |
| 进入 ANALYZING | 底部 ▶ 按钮 | 校验 PRD 必填，仓库勾选软警告，通过则跳 `/requirements/<id>/analyzing/` |

---

## 3 · 与 11a 原状的差异

| 维度 | 11a 原状 | 二次设计后 |
|---|---|---|
| 创建需求入口 | DRAFTING 工位表单 | 用户在需求列表创建（已实现，本次不变） |
| 资源树 | 显示 PRD 章节大纲 | 无（PRD 锚点条替代） |
| Inline Rail | 候命 Skill 列表 | 保留候命 Skill（不变） |
| 仓库勾选 | 关联仓库 chips 字段 | 底部固定条（移到工作区下方） |
| AC checklist | PRD 下方结构化 AC 输入 | **去掉**（AC 下沉到 ANALYZING 准入校验） |
| 辅助文件 | 无 | 主区下半文件卡片列表 + 抽屉编辑 |
| 文件格式 | 仅 PRD.md | PRD + 辅助文件均 .md；docx/pdf mock 转 md |
| 自动保存 | 30s（PRD 字段） | 30s（PRD + 抽屉内辅助文件） |
| Launch 按钮 | "创建并启动 AI 分析" | "▶ 进入 ANALYZING"（语义调整，去掉"创建"） |

---

## 4 · 后续工作

### 4.1 本期（mock 阶段）落地清单

- [ ] PRD 顶置组件（含骨架自动填充）
- [ ] 辅助文件卡片列表
- [ ] 辅助文件抽屉（含 Markdown 编辑器 + 锚点跳转）
- [ ] PRD 顶部锚点条（滚动定位 + 高亮）
- [ ] 仓库勾选底部固定条 + 软警告
- [ ] 文件新建/上传流程（用途标签选择）
- [ ] Markdown 渲染（支持相对路径链接 → 抽屉跳转）
- [ ] 30s 自动保存（PRD + 抽屉内辅助文件）

### 4.2 下期（接 Agent API）扩展

- [ ] docx/pdf → md 真实转换（pandoc / Apache Tika）
- [ ] 文件历史版本（snapshot）
- [ ] 全文搜索（⌘P）
- [ ] 文件嵌套目录
- [ ] 文件协作（多光标）
- [ ] PRD 大纲点击 → 右侧预览面板

### 4.3 关键文件改动

| 文件 | 改动 |
|---|---|
| `apps/web/src/components/drafting-zone.tsx` | 主区 server 容器改为 PRD 顶置 + 辅助卡片 + 底部仓库条 |
| `apps/web/src/components/drafting-form.tsx` | PRD 编辑器（保留 11a 表单样式 + 锚点条） |
| `apps/web/src/components/drafting-aux-card.tsx` | **新增**辅助文件卡片 |
| `apps/web/src/components/drafting-aux-drawer.tsx` | **新增**辅助文件抽屉编辑器 |
| `apps/web/src/components/drafting-prd-anchor.tsx` | **新增**PRD 章节锚点条 |
| `apps/web/src/components/drafting-repo-bar.tsx` | **新增**底部仓库勾选条 |
| `apps/web/src/lib/drafting.ts` | 数据层扩展（File 对象 + usage_tag） |
| `apps/agent/src/zones/drafting.yaml` | 注册表更新（has_resource_tree: false） |
| `.scratch/ai-devspace-mvp/issues/19-zone-drafting-redesign.md` | **新增**落地 issue |

---

## 5 · 变更记录

| 日期 | 事件 |
|---|---|
| 2026-07-13 | 二次设计 grilling 会话启动 |
| 2026-07-13 | 14 轮决策全部确认 |
| 2026-07-13 | 10 个 HTML 原型落地（3 主方案 + 3 资源树变体 + 4 交互变体） |
| 2026-07-13 | **本文档创建**（决策单一事实源） |

---

## 6 · 一句话总结

**DRAFTING 不再是"创建需求的入口"，而是"PRD + 辅助文件的准备车间"**。PRD 自动骨架、辅助文件 mock 转 md、抽屉式独立编辑、锚点条替代资源树、本期纯 UI 不接 Agent。