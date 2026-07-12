---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: []
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D2①, D3, D4, D10
Slice: 1/6
---

# 19a · ANALYZING 工位骨架 + 准入校验仪表板(Vertical Slice 1)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`

## What to build

把 ANALYZING 工位从"原 Thinking 观察屏"重写为 **PRD 准入 + 技术概要协作工作台**的第一步:**工位骨架 + 准入校验仪表板**。

完成此 slice 后,用户打开 ANALYZING 工位应看到:

1. 工位注册表已更新:`display_name: "PRD 准入 + 技术概要"`、`main_layout: "admission-workbench"`、`default_arming` 新增 `admission-check` + `tech-brief-scaffold` Skill
2. 顶部"准入仪表板":5 张严重度维度卡(资损/性能/架构/业务/上下文)+ 右端"总体结论"徽章(准入通过/待裁决/失败)
3. 维度集合由 Skill `SKILL.md` frontmatter 的 `admission_dimensions` 字段决定(默认 5 维度,Skill 可 `add:` / `skip:`)
4. `AnalyzingData` 接口新增 `admission` 段(见 PRD D-IMPL-2)
5. 任一 🔴 资损项存在 → 默认 verdict `fail`,但 UI 暴露"接受风险"按钮,可手动改为 `pending`
6. 数据流:server-side `getAnalyzingData(id)` 从 Skill frontmatter 解析维度 → 仪表板组件渲染 → 单元测试覆盖 5 卡渲染 / verdict 计算 / "接受风险"按钮

**端到端行为**(不写实现细节):

```
打开 /requirements/<id>/analyzing/
   ↓
[Server] getAnalyzingData(id)
   ├─ 读 Skill frontmatter (admission_dimensions + admission_override)
   ├─ 计算默认维度集合 = 全局默认 5 维度 + Skill.add - Skill.skip
   ├─ 读 analysis/adjudication.md → pendingAdjudicationCount
   ├─ 读 analysis/modules.yaml(若存在)→ admission.verdict
   └─ 返回 AnalyzingData { admission: { dimensions, verdict, pendingAdjudicationCount }, sessions: [默认会话], session: { ...空态 }, ... }
   ↓
[Client] <AnalyzingZone data={...} />
   ├─ 顶部渲染 <AdmissionDashboard> 5 卡 + verdict 徽章
   ├─ 仪表板右端"待裁决 N"徽章(若 N > 0)
   ├─ verdict=fail 时显示 [接受风险] 按钮 → 调 server action 改 verdict=pending
   └─ 主区下方显示空态(等 VS2/VS3/VS5 填充内容)
```

> **明确不含**(后续 slice 处理):思考流打字机(VS2)、多会话 Tab(VS3)、产物编辑(VS4)、技术概要生成(VS5)、待裁决面板(VS6)。本 slice 只让"准入仪表板"可见可交互。

## Acceptance criteria

- [ ] 打开 `requirements/<id>/analyzing/` 时,顶部渲染 `<AdmissionDashboard>`,包含 5 张维度卡(资损/性能/架构/业务/上下文),每张卡有图标 + 数字 + 标签
- [ ] 仪表板右端有"总体结论"徽章,文案随 verdict 变化:"✅ 准入通过" / "⚠️ 待裁决" / "❌ 准入失败"
- [ ] 当 `modules.yaml` 不存在或 verdict 未定时,徽章显示"⚠️ 待裁决"
- [ ] 当任一 🔴 资损问题存在时,verdict 默认 `fail`,徽章显示"❌ 准入失败"
- [ ] verdict=`fail` 时,UI 出现 [接受风险] 按钮;点击 → verdict 变为 `pending`,徽章变"⚠️ 待裁决"
- [ ] 维度卡数量 + 顺序由 Skill `admission_dimensions` + `admission_override` 决定(可通过 mock Skill 测试)
- [ ] 默认 5 维度集合:`loss_prevention` / `performance` / `arch_conflict` / `business_reasonable` / `context_query`
- [ ] Skill 在 frontmatter `admission_override.add` 添加的维度排在默认维度之后
- [ ] Skill 在 frontmatter `admission_override.skip` 跳过的维度**不**渲染(卡片消失)
- [ ] `AnalyzingData.admission.pendingAdjudicationCount` 来自 `analysis/adjudication.md` 文件读取(`applied: false` 的项计数)
- [ ] `apps/web/src/lib/zones.ts` 中 ANALYZING 条目更新:`display_name: "PRD 准入 + 技术概要"`、`main_layout: "admission-workbench"`、`default_arming` 包含 `admission-check` + `tech-brief-scaffold`
- [ ] `~/.aidevspace/zones/analyzing.yaml` 同步更新(由 zone registry loader 落盘)
- [ ] `packages/shared/src/skill-schema.ts` 新增文件(若不存在),导出 `AdmissionDimensionIdSchema`(5 个枚举值)
- [ ] `packages/shared/src/index.ts` 导出新 schema
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-admission-dashboard.test.tsx` 覆盖:
  - 5 卡渲染(默认 5 维度)
  - Skill.add 新增维度(渲染 6 卡)
  - Skill.skip 跳过维度(渲染 4 卡)
  - verdict 三种状态切换
  - [接受风险] 按钮可见性(`fail` 时显示,`pending` 时隐藏)
  - 维度卡点击交互(预留 hook,后续 slice 填充)
- [ ] **单元测试**:`packages/shared/src/__tests__/skill-schema.test.ts` 覆盖 `AdmissionDimensionIdSchema` 接受 5 个 ID + 拒绝未知 ID
- [ ] **集成测试**:`apps/web/src/lib/__tests__/analyzing.test.ts` 覆盖 `getAnalyzingData`:
  - 文件不存在时返回 `admission.pendingAdjudicationCount: 0` + `verdict: 'pending'`
  - `adjudication.md` 含 `applied: false` 项时正确计数
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

## Blocked by

None — can start immediately.

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **不破坏**原 [analyzing-zone.tsx](apps/web/src/components/analyzing-zone.tsx) 的 `chunks / stats / summary / toolbar` 4 段接口 — 在 `AnalyzingData` 上**追加** `admission` 段(PR D-IMPL-2)
- **Skill frontmatter 解析**可在 `getAnalyzingData` 里用 `gray-matter` + `AdmissionDimensionIdSchema.safeParse` 一次性完成
- **单元测试样板**:沿用 [apps/web/src/__tests__/analyzing-zone.test.tsx](apps/web/src/__tests__/analyzing-zone.test.tsx) 的 `vitest + @testing-library/react + data-testid` 模式
- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` 顶部"准入仪表板"5 卡部分(决策 36 单一事实源)