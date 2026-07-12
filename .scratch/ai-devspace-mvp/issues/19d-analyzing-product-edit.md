---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: ['19a-analyzing-zone-skeleton-admission-dashboard']
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D2③
Slice: 4/6
---

# 19d · ANALYZING 解析产物交互编辑(Vertical Slice 4)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`
- 前置 slice: [19a](issues/19a-analyzing-zone-skeleton-admission-dashboard.md)

## What to build

在 VS2 的只读 `<ProductList>` 之上,新增**产物交互编辑**能力(ADR-0013 D2 ③):

1. 每条产物卡片(📌子问题 / ⚠️风险 / 🎨方案)增加操作按钮:
   - **✏️ 编辑**:inline edit(点击后输入框替换 title)
   - **🗑 删除**:确认后删除该条
   - **🔗 合并**:多选后合并成一条(用户输入合并后的 title)
   - **+ 新增**:在该类底部加 "+ 新增 X" 按钮,弹出输入框(title + description + severity)
2. 编辑即时落盘到 `analysis/sessions/<session-id>/products.yaml`(决策 25 "文件标记形式落位")
3. 准入仪表板的"维度计数"实时更新(增加/删除/合并后)
4. 卡片状态:正常态 / 编辑态 / 删除确认态(三态切换)

完成此 slice 后,用户在 ANALYZING 工位应能:

- 在主区右侧产物列表中,每张卡片右上角看到 3 个图标按钮:✏️ / 🗑 / 🔗
- 点 ✏️ → 卡片 title 变成输入框 + [✓ 保存] [✕ 取消] 按钮 → 保存后落盘 + 仪表板数字更新
- 点 🗑 → 卡片进入"删除确认态"(变红边框 + 显示"确认删除?" + [✓ 是] [✕ 否])→ 确认后落盘删除
- 点 🔗 → 进入"合并模式"(其他同类卡片显示复选框)+ 底部出现 [合并 N 项] 按钮 → 弹对话框输入新 title → 保存
- 点 [+ 新增子问题] / [+ 新增风险] / [+ 新增方案] → 弹输入框(title 必填,description / severity 可选)→ 保存后落盘
- 数据流:server action `updateProduct(sessionId, productId, action, payload)` → 写 `products.yaml`

**端到端行为**:

```
用户点 ✏️ 卡片标题
   ↓
[Client] 卡片进入编辑态(本地 state)
   ↓
用户输入新 title + 点 [✓ 保存]
   ↓
[Client] Server Action updateProduct(sessionId, productId, 'edit', { title })
   ↓
[Agent / Web handler] 读 products.yaml → 改对应 id → 写回
   ↓ 自动 snapshot(决策 47 + ADR-0009 第 4 层)
[Client] 重读 products.yaml → 仪表板数字更新 + 卡片刷新
```

> **明确不含**:多会话 Tab(VS3 — 本 slice 假设单 Tab)、技术概要生成(VS5 — 编辑落盘到 products.yaml,VS5 才生成 modules.yaml)、待裁决面板(VS6)。

## Acceptance criteria

- [ ] 每条产物卡片(📌/⚠️/🎨)右上角有 3 个图标按钮:✏️ / 🗑 / 🔗
- [ ] 点 ✏️ → 卡片 title 变为 input + [✓ 保存] [✕ 取消] 按钮;空 title 时 [✓ 保存] disabled
- [ ] 点 ✓ 保存 → server action 调 `updateProduct` → 落盘 → 卡片恢复显示态 + 仪表板数字更新
- [ ] 点 ✕ 取消 → 卡片恢复显示态,无落盘
- [ ] 点 🗑 → 卡片变红边框 + "确认删除?" + [✓ 是] [✕ 否];[✓ 是] 落盘删除 + 卡片消失
- [ ] 点 🔗 → 进入合并模式(其他同类卡片显示复选框);底部出现 [合并 N 项](N = 选中数,< 2 时 disabled)
- [ ] 点 [合并 N 项] → 弹对话框输入新 title;[确认] → 落盘合并(原 N 条删除,新条追加)
- [ ] 每类(📌/⚠️/🎨)底部有 [+ 新增 X] 按钮;点击 → 弹输入框(title 必填 + description + severity);[保存] → 落盘新增
- [ ] 新增/编辑/删除/合并都触发准入仪表板维度计数更新
- [ ] 产物 id 稳定:编辑不改 id,删除/合并后旧的 id 不复用
- [ ] **不破坏**VS2 的 `<ProductList>` 只读测试 — 增加 prop `editable: boolean`,默认 true
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-product-edit.test.tsx`:
  - 卡片显示 3 个图标按钮
  - 编辑态切换(input 出现 + 按钮)
  - 空 title 时保存按钮 disabled
  - 删除确认态(变红 + 双按钮)
  - 合并模式切换(复选框 + 底部按钮)
  - 新增输入框(title 必填验证)
- [ ] **集成测试**:`apps/web/src/lib/__tests__/products-yaml.test.ts`:
  - 读 products.yaml → 解析为 `AnalyzingProductItem[]`
  - 写回时保留其他会话/类型数据
  - 删除 id 后 yaml 顺序稳定
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

## Blocked by

- [19a-analyzing-zone-skeleton-admission-dashboard](issues/19a-analyzing-zone-skeleton-admission-dashboard.md) — 需要工位骨架作为 ProductList 的父级

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **产品数据落盘文件**:`analysis/sessions/<session-id>/products.yaml`,与 VS2 的 `chunks.jsonl` 同级
  ```yaml
  type: object
  required: [subproblems, risks, options]
  properties:
    subproblems: { type: array, items: { $ref: '#/definitions/ProductItem' } }
    risks: { type: array, items: { $ref: '#/definitions/ProductItem' } }
    options: { type: array, items: { $ref: '#/definitions/ProductItem' } }
  definitions:
    ProductItem:
      type: object
      required: [id, title]
      properties:
        id: { type: string }
        title: { type: string }
        description: { type: string }
        severity: { enum: [red, orange, yellow, green, blue] }
  ```
- **准入仪表板联动**:编辑/删除/合并后,`getAnalyzingData` 重读 products.yaml → 重新计算各维度 count;React 状态通过 revalidatePath 触发刷新
- **写入策略**:每次编辑前自动 snapshot(决策 47),保留 30 天;用户可点 StatusBar "[↶ 回滚上次]" 找回
- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` 主区右侧"识别产物"区(本 slice 在此基础上加交互按钮)
- **id 生成**:用 `crypto.randomUUID()` 或 nanoid,确保稳定且不重复
- **合并 UX**:本 slice 实现"合并成一条"基础版(标题合并);更复杂的"摘要合并"放 P1+
- **不强制**:本 slice 不动 modules.yaml(那是 VS5 的产物);编辑只影响 products.yaml,VS5 时 AI 跑技术概要生成会读 products.yaml 决定 modules