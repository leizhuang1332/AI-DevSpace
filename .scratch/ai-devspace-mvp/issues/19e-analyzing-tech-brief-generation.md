---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: ['19a-analyzing-zone-skeleton-admission-dashboard', '19d-analyzing-product-edit']
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D8, D14
Slice: 5/6
---

# 19e · ANALYZING 技术概要生成(双产物落盘)(Vertical Slice 5)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`
- 前置 slice: [19a](issues/19a-analyzing-zone-skeleton-admission-dashboard.md), [19d](issues/19d-analyzing-product-edit.md)

## What to build

承接 19a 仪表板 + 19d 产物编辑,在主区工具栏 / 待裁决面板区提供**"📊 生成技术概要"**按钮,实现**双产物一次落盘**(ADR-0013 D8):

1. Web 端工具栏新增 `[📊 生成技术概要]` 按钮(始终可见,无论 verdict 如何)
2. 点击 → 调 Agent `POST /api/requirements/<id>/analysis/generate-brief`
3. Agent 端:
   - 启动 `tech-brief-scaffold` Skill(已在 19a 装入 default_arming)
   - 读当前会话的 `products.yaml`(19d 产物) + `requirement.md` + 相关知识
   - AI 生成两份产物:
     - `analysis/technical-brief.md`(叙述性:业务背景 / 架构选型 / 技术栈 / 风险缓解)
     - `analysis/modules.yaml`(结构化:聚合模块清单,每模块 `{ id, name, description, deps, complexity, clarifying_questions }`)
   - 写文件前自动 snapshot(决策 47 + ADR-0009 第 4 层)
4. 写完后:**直接覆盖**旧版(无版本号,旧版靠 snapshot 找回 — ADR-0013 D14)
5. Web 端:**显示产物预览**(双 Tab:📄 Markdown / 📋 YAML)+ 文件路径 + 生成时间戳
6. 失败回滚:若 AI 中途出错,snapshot 自动恢复 + UI 显示错误(决策 46 第 3 层)

完成此 slice 后,用户在 ANALYZING 工位应能:

- 在主区任何位置看到 `[📊 生成技术概要]` 按钮(主 CTA,brand 色)
- 点按钮 → 按钮变 spinner + 禁用 + 弹"正在生成..."提示(决策 24 "克制在场" — 不喧哗)
- 生成成功 → 主区出现"产物预览区"(双 Tab 切换 Markdown / YAML)+ 文件路径链接 + 时间戳
- 生成失败 → 弹错误 + "已回滚到生成前"提示
- 后续点 [🔄 重扫] — 本 slice **不实现**(留 VS6);但按钮位预留

**端到端行为**:

```
[Web] 用户点 [📊 生成技术概要]
   ↓
POST /api/requirements/<id>/analysis/generate-brief { session_id }
   ↓
[Agent] 1. snapshot current analysis/ dir → .aidevspace/snapshots/<req-id>/<ts>/
        2. 启动 tech-brief-scaffold Skill
        3. 注入 products.yaml + requirement.md + Knowledge
        4. AI 生成 → 双产物内容
        5. 写 technical-brief.md + modules.yaml (覆盖)
        6. 返回 { ok: true, brief_path, modules_path, generated_at }
   ↓
[Web] 显示产物预览区:
   - 📄 technical-brief.md 渲染(Markdown viewer)
   - 📋 modules.yaml 渲染(代码高亮 + 结构化展示)
   - 时间戳: "2026-07-12 14:23 · 文件路径: ~/.aidevspace/requirements/<id>/analysis/technical-brief.md"
   - [🔄 重扫] 按钮(VS6 实现,本 slice 仅占位 disabled)
```

> **明确不含**:多会话 Tab(VS3 — 单 Tab 也能演示)、待裁决面板(VS6)、跨工位可见性(VS6)、CLARIFYING 交接(VS6)。

## Acceptance criteria

- [ ] 主区工具栏(或固定 CTA 区)显示 `[📊 生成技术概要]` 按钮,brand 色,始终可见
- [ ] 按钮在 verdict 任意状态(`pass` / `pending` / `fail`)都可见可点
- [ ] 点击按钮 → 按钮变 spinner + disabled;同时显示"正在生成..."toast(决策 30 三态)
- [ ] Agent `POST /api/requirements/<id>/analysis/generate-brief` endpoint 实现:
  - 启动 `tech-brief-scaffold` Skill 上下文
  - 写文件前自动 snapshot(决策 47)
  - 失败时回滚到 snapshot(决策 46)
- [ ] 成功后:
  - `analysis/technical-brief.md` 写入(叙述性,4 章节:业务背景 / 架构选型 / 技术栈 / 风险缓解)
  - `analysis/modules.yaml` 写入(结构化,`modules[]` 每项含 `{ id, name, description, deps, complexity, clarifying_questions }`)
- [ ] 写入采用"直接覆盖"策略(无版本号,无 .v1 / .v2 备份)
- [ ] Web 端收到响应后,主区显示"产物预览区":
  - 双 Tab:`[📄 technical-brief.md] [📋 modules.yaml]`
  - Markdown Tab:渲染 Markdown(react-markdown + 代码高亮)
  - YAML Tab:代码高亮 + 结构化展开(每模块卡片 + 依赖箭头)
  - 底部信息:文件路径 + 生成时间戳(ISO 8601)
- [ ] 失败时:
  - 文件系统回滚到生成前(snapshot 恢复)
  - UI 显示错误 toast + "已自动回滚"提示(对应决策 46 第 3 层)
- [ ] **不破坏**VS1 准入仪表板 / VS2 思考流 / VS3 Tab 切换 / VS4 产物编辑 — 它们都在生成后仍可用
- [ ] 重新点 [📊 生成] → 直接覆盖(无警告)— 因为已是用户主动行为
- [ ] **Agent integration test**:`apps/agent/src/__tests__/routes-analysis.test.ts`:
  - `POST /generate-brief` 启动 Skill + 写双文件
  - 失败时回滚到 snapshot
  - 旧版 modules.yaml 被覆盖(不保留版本)
- [ ] **Web 单元测试**:`apps/web/src/__tests__/analyzing-tech-brief.test.tsx`:
  - 按钮可见性(任何 verdict 都可见)
  - 点击触发 endpoint 调用
  - 成功后渲染产物预览区(双 Tab + 时间戳)
  - 失败时显示错误 toast
- [ ] **集成测试**:`apps/web/src/lib/__tests__/analyzing.test.ts` 扩展:
  - 双产物存在时 `techBriefPreview` 字段填充
  - `canGenerateBrief: true` 始终返回(无论 verdict)
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

## Blocked by

- [19a-analyzing-zone-skeleton-admission-dashboard](issues/19a-analyzing-zone-skeleton-admission-dashboard.md) — 需要工位骨架 + 准入仪表板作为按钮容器
- [19d-analyzing-product-edit](issues/19d-analyzing-product-edit.md) — 技术概要生成的输入来自 products.yaml,需先有产物编辑能力

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **modules.yaml schema**(见 PRD D-IMPL-6):
  ```yaml
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
- **technical-brief.md 章节模板**:
  ```markdown
  # <需求标题> · 技术概要

  ## 1. 业务背景与目标
  ## 2. 架构选型
  ## 3. 技术栈
  ## 4. 风险与缓解
  (详见 modules.yaml 的 deps / complexity 字段)
  ```
- **快照机制**:沿用现有 `apps/agent/src/services/SnapshotService`(若存在;否则引用 ADR-0009 第 4 层)
- **失败回滚**:snapshot 文件在写失败时自动 `fs.copy(snapshot, target)`,UI 显示 `[↶ 已回滚]`
- **Skill 输入**:`tech-brief-scaffold` Skill frontmatter 声明需要的 context:`requirement.md` + `products.yaml` + `knowledge/index.yaml`
- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` 顶部"📊 生成"按钮位(右对齐)
- **不实施**:VS6 的 [🔄 重扫] 按钮在本 slice 渲染为 disabled + tooltip "由待裁决面板启用"(VS6 启用)