---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: ['19e-analyzing-tech-brief-generation']
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D6, D9, D11, D12, D13, D15
Slice: 6/6
---

# 19f · ANALYZING 待裁决面板 + 跨工位可见性 + CLARIFYING 交接(Vertical Slice 6)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`
- 前置 slice: [19e](issues/19e-analyzing-tech-brief-generation.md)

## What to build

**最终切片** — 把 ANALYZING 工位重设计完整闭环。包含 3 大块:

### 块 A · 待裁决面板(改写决策 25 · ADR-0013 D6/D11/D12/D13/D15)

1. 主区新增"🛡 待裁决面板"区,**双区折叠**(D15):
   - **待裁决区(顶部,展开)**:未应用的裁决项 + [📥 应用本次裁决 (N 项)] + [🔄 重扫] 按钮
   - **已裁决区(底部,折叠)**:已应用的项,点击展开
2. 每项裁决 UI(D13):
   - 2-4 个预设选项按钮(AI 推测)
   - 自定义文本输入框(始终可用)
   - 蓝色圆点标识"已裁决,未应用"(D12)
3. `[📥 应用本次裁决 (N 项)]` 按钮 → 调 Agent `/adjudicate` → 增量更新 `modules.yaml` + `technical-brief.md`(D11/D12)
4. `[🔄 重扫]` 按钮 → 调 Agent `/regenerate` → 重新走"准入 + 技术概要 + 拆解"全流程 → 直接覆盖双产物(D11/D14)
5. AI 准入提问**不主动推送**(D6):AI 完成识别后写入 `analysis/adjudication.md`,用户主动来 ANALYZING 处理

### 块 B · 跨工位可见性

1. **StatusBar 全局"待裁决 N"指示器**:
   - 数据源:`analysis/adjudication.md` 解析 `applied: false` 项计数
   - 任意工位(DRAFTING / CLARIFYING / EXECUTING 等)都可见
   - 点击 → `router.push(/requirements/<id>/analyzing/)`
2. **ZoneBar ANALYZING Tab 数字徽章**:
   - ANALYZING Tab 上显示待裁决数
   - 数字与 StatusBar 同步
3. **移除**原"AI 分析完成 → 切到 CLARIFYING 吗?"弹窗(决策 25 改写后,平台无任何 AI 主动推送)

### 块 C · CLARIFYING 消费 modules.yaml(D9)

1. **CLARIFYING 数据源改造**:
   - **原**:`clarifying/questions.yaml` 由 AI 自行生成
   - **改**:从 `analysis/modules.yaml` 的 `modules[].clarifying_questions[]` 字段读取
2. **字段映射**:
   - `modules[].id` → `ClarifyingQuestion.module_id`
   - `modules[].name` → `ClarifyingQuestion.module_name`(展示用)
   - `modules[].clarifying_questions[].{question, options, required}` → `ClarifyingQuestion`
3. **降级逻辑**:`modules.yaml` 不存在时,CLARIFYING 显示 EmptyState 引导"先去 ANALYZING 生成技术概要"

完成此 slice 后,用户跨 6 工位应能:

- 在 ANALYZING 看到待裁决面板:双区折叠 + 预设选项 + 自定义输入 + 蓝色圆点 + 双按钮
- 在任意工位看 StatusBar "待裁决 N"指示器,点跳转 ANALYZING
- 在 ZoneBar ANALYZING Tab 看数字徽章
- 在 CLARIFYING 看 modules.yaml 的问题清单(无 modules.yaml 时显示引导)

**端到端行为**:

```
块 A · 待裁决面板
=================
[Server] getAnalyzingData(id) 读 analysis/adjudication.md
   ├─ 待裁决项: applied=false 的 items
   └─ 已裁决项: applied=true 的 items
   ↓
[Client] <AdjudicationPanel>
   ├─ 待裁决区展开:每项 <AdjudicationItem>
   │   ├─ 预设选项按钮(2-4 个)
   │   ├─ 自定义文本输入框
   │   └─ 已答后显示蓝色圆点
   ├─ 底部 [📥 应用本次裁决 (N 项)] 按钮(N = 蓝色圆点数)
   └─ [🔄 重扫] 按钮

用户点 [📥 应用本次裁决]
   ↓
POST /api/requirements/<id>/analysis/adjudicate { items: [...] }
   ↓
[Agent] 1. 读 modules.yaml + technical-brief.md
        2. AI 增量更新对应部分
        3. 写回(覆盖)
        4. 更新 adjudication.md: applied=true
        5. snapshot
   ↓
[Client] 重新读 analysis/ → 待裁决区项移到已裁决区

用户点 [🔄 重扫]
   ↓
POST /api/requirements/<id>/analysis/regenerate { session_id }
   ↓
[Agent] 重新跑 admission-check + tech-brief-scaffold
        → 直接覆盖双产物
        → 写 adjudication.md 清空(?)
        → snapshot
   ↓
[Client] 准入仪表板 + 产物预览区刷新

块 B · 跨工位可见性
====================
[Server] getGlobalAIStatus(id) 读 adjudication.md → pendingAdjudicationCount
   ↓
[Client] <StatusBar /> 任何工位都渲染 "<待裁决 N>" 按钮(可点)
[Client] <ZoneBar /> ANALYZING Tab 渲染数字徽章

块 C · CLARIFYING 交接
=====================
[Server] getClarifyingData(id)
   ├─ 读 analysis/modules.yaml → mapping → ClarifyingQuestion[]
   ├─ 不存在时返回 empty=true + 引导
   └─ 沿用原 clarifying/questions.yaml 作为 P2 降级(老需求兼容)
```

## Acceptance criteria

### 块 A 待裁决面板

- [ ] 主区新增 `<AdjudicationPanel>` 区,默认显示"待裁决区(顶部展开)" + "已裁决区(底部折叠)"
- [ ] 每项待裁决项渲染:
  - 问题正文(可滚动)
  - 2-4 个预设选项按钮(从 AI 推测的 `suggested_options`)
  - 自定义文本输入框(始终可用)
  - 用户答预设或填字后,该问题变蓝色圆点标识(待应用)
- [ ] 蓝色圆点项数 = N,显示在 `[📥 应用本次裁决 (N 项)]` 按钮的文本中
- [ ] N = 0 时,`[📥 应用本次裁决]` 按钮 disabled
- [ ] 点 [📥 应用本次裁决] → 调 `POST /adjudicate` → AI 增量更新双产物 + adjudication.md 标记 applied=true → 待裁决项移到已裁决区(折叠)
- [ ] 点 [🔄 重扫] → 弹确认弹窗(避免误操作)→ 确认后调 `POST /regenerate` → AI 重走全流程 + 双产物覆盖 + adjudication.md 清空 → 主区全刷新
- [ ] 已裁决区点击展开 → 显示所有已应用项,每项 ✅ + 简述 + 裁决时间
- [ ] **移除**原 19 / VS2 的"AI 分析完成 → 切到 CLARIFYING 吗?"弹窗(决策 25 改写后无任何 AI 主动推送)
- [ ] Agent `/adjudicate` `/regenerate` endpoints 实现(沿用 VS5 的 snapshot + 回滚模式)
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-adjudication-panel.test.tsx`:
  - 双区折叠(待裁决展开 / 已裁决折叠)
  - 预设选项点击 → 蓝色圆点
  - 自定义输入 + 提交 → 蓝色圆点
  - [📥 应用本次裁决] N 计数正确
  - [🔄 重扫] 弹确认
  - 已裁决区展开/折叠
- [ ] **Agent integration test**:`/adjudicate` + `/regenerate` 写文件正确 + snapshot 触发 + 失败回滚

### 块 B 跨工位可见性

- [ ] `<StatusBar>` 全局显示"待裁决 N"指示器(任意工位都可见)
- [ ] 点击 StatusBar 指示器 → `router.push(/requirements/<id>/analyzing/)`
- [ ] `<ZoneBar>` ANALYZING Tab 显示"待裁决 N"数字徽章(> 0 时显示,= 0 时隐藏)
- [ ] 数字徽章与 StatusBar 同步(同源)
- [ ] N > 0 时,StatusBar 指示器用 brand 色突出(决策 49 AI 状态色)
- [ ] **单元测试**:`apps/web/src/__tests__/status-bar-pending-adjudication.test.tsx`:
  - 数字渲染正确
  - 点击跳转
  - N=0 时不显示
- [ ] **单元测试**:`apps/web/src/__tests__/zone-bar-analyzing-badge.test.tsx`:
  - ANALYZING Tab 显示徽章
  - 数字正确
  - 与 StatusBar 同步

### 块 C CLARIFYING 交接

- [ ] `apps/web/src/lib/clarifying.ts` 数据源改为 `analysis/modules.yaml`
- [ ] 字段映射:
  - `modules[].clarifying_questions[].question` → `ClarifyingQuestion.question`
  - `modules[].clarifying_questions[].options[]` → `ClarifyingQuestion.options[]`
  - `modules[].clarifying_questions[].required` → `ClarifyingQuestion.required`
  - `modules[].id` → `ClarifyingQuestion.module_id`
  - `modules[].name` → `ClarifyingQuestion.module_name`
- [ ] `analysis/modules.yaml` 不存在时:
  - `getClarifyingData` 返回 `empty: true`
  - CLARIFYING 工位显示 EmptyState:"先去 ANALYZING 生成技术概要"+ CTA 跳转 ANALYZING
- [ ] `analysis/modules.yaml` 存在时:CLARIFYING 显示问题清单(按 module 分组)
- [ ] **不破坏**原 CLARIFYING 现有测试 — 增加 prop `dataSource: 'modules.yaml' | 'questions.yaml'`(默认 modules.yaml)
- [ ] **单元测试**:`apps/web/src/lib/__tests__/clarifying.test.ts` 扩展:
  - 读 modules.yaml → 字段映射正确
  - 不存在时返回 empty=true
  - 降级到 questions.yaml(P2 兼容)
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

### 端到端验收

- [ ] 用户完整流程:进入 DRAFTING 写 PRD → 进入 ANALYZING 启动分析 → AI 识别风险 → 切换 DRAFTING 看 StatusBar "待裁决 N" → 点跳 ANALYZING → 待裁决面板 → 答预设 → 应用 → modules.yaml 更新 → 切 CLARIFYING 看 modules.yaml 问题清单

## Blocked by

- [19e-analyzing-tech-brief-generation](issues/19e-analyzing-tech-brief-generation.md) — 需要先有双产物 `technical-brief.md` + `modules.yaml` 才能进入待裁决面板和 CLARIFYING 交接

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **adjudication.md 结构**(见 PRD D-IMPL-6):
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
- **预设选项来源**:AI 在生成 adjudication.md 时基于上下文推测 2-4 个答案(写入 `suggested_options`)
- **全局 AI 状态**:StatusBar 的"待裁决 N"数据流建议在 workspace layout(`apps/web/src/app/(workspace)/layout.tsx`)通过 server component 拉取,所有子页面共享
- **AdjudicationPanel 位置**:在 19a 准入仪表板 + VS5 产物预览区之间,作为主区第三块
- **重扫确认弹窗**:沿用项目 EmptyState / 通用 Dialog 组件(若存在);否则用 shadcn/ui Dialog
- **CLARIFYING 兼容**:若旧需求没有 `modules.yaml`(老数据),降级读 `clarifying/questions.yaml`(原文件),避免破坏现有功能
- **决策 25 改写落地**:VS6 是决策 25 改写的最终落地点 — 完成后整个平台**无任何 AI 主动推送**(原"切到 CLARIFYING 吗?"弹窗去除)
- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` 准入仪表板右端"⚠ 待裁决"徽章 + 待裁决面板(本 slice 新增)
- **MVP 完成标志**:本 slice 完成后,ADR-0013 全部 15 个决策落地,ANALYZING 工位重设计闭环