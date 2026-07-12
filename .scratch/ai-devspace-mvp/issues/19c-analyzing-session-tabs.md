---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: ['19a-analyzing-zone-skeleton-admission-dashboard']
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D2④, D7
Slice: 3/6
---

# 19c · ANALYZING 多会话 Tab 切换(Vertical Slice 3)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`
- 前置 slice: [19a](issues/19a-analyzing-zone-skeleton-admission-dashboard.md)

## What to build

在 19a 准入仪表板之下,VS2 思考流之上,新增**多会话并行观察** UX(ADR-0013 D7):

1. 会话 Tab 横向导航条:类似浏览器 Tab 风格
2. 每个 Tab 显示:**会话名**(架构 / 数据 / 接口 等)+ **数字徽章**(该会话已识别子问题数)
3. "+ 新建"按钮 → 创建新会话(默认 angle=`custom`,用户可命名)
4. 点击 Tab → 主区切换到该会话的思考流 + 产物(VS2 的 `<ThinkingStream>` / `<ProductList>` 仍渲染,但数据源按 `activeSessionId` 切换)
5. 准入仪表板**全局共享**,不分子会话(任意 Tab 都能看到同一个仪表板)
6. 切换 Tab 保留各会话的滚动位置(sessionStorage,key=`analysis-scroll-<session-id>`)

完成此 slice 后,用户在 ANALYZING 工位应能:

- 看到顶部 Tab 条(如:`[架构 3] [数据 5*] [接口 8] [+ 新建]`),当前 Tab 用 brand 紫色高亮 + 2px 下划线
- 点 [+] 弹小对话框输入会话名 → 新会话出现在 Tab 列表末尾,自动切到该 Tab
- 点其他 Tab → 主区显示该会话的 chunks + products;VS2 的打字机暂停/重置按 Tab 独立工作
- 刷新页面后 Tab 列表保留(从 `analysis/sessions/_index.yaml` 读)
- 准入仪表板在所有 Tab 上方始终显示,数字全局聚合

**端到端行为**:

```
打开 /requirements/<id>/analyzing/
   ↓
[Server] getAnalyzingData(id)
   ├─ 读 analysis/sessions/_index.yaml → sessions[] (id, label, angle, detected_count, is_streaming)
   ├─ 默认 activeSessionId = sessions[0].id (或 cookie last_session_id)
   └─ 返回 AnalyzingData { admission, sessions, activeSessionId, session: <active 的内容> }
   ↓
[Client] <AnalyzingZone>
   ├─ <AdmissionDashboard /> (19a) — 全局共享
   ├─ <SessionTabs
   │     sessions={sessions}
   │     activeId={activeSessionId}
   │     onSwitch={...}
   │     onCreate={...} />
   ├─ 主区用 session.id === activeSessionId 的内容渲染:
   │     <ThinkingStream chunks={session.chunks} /> (VS2)
   │     <ProductList products={session.products} /> (VS2 只读 / VS4 编辑)
   └─ <InterjectInput sessionId={activeSessionId} /> (VS2)
```

> **明确不含**:产物编辑(VS4)、技术概要生成(VS5)、待裁决面板(VS6)。本 slice 让 Tab 切换可用,数据可来自 mock。

## Acceptance criteria

- [ ] 顶部 Tab 条横向显示所有 `sessions`,每个 Tab 有 label + 数字徽章(`detected_count`)
- [ ] 当前 active Tab 用 brand 紫色高亮 + 2px 下划线;非 active Tab 灰文字
- [ ] "+ 新建"按钮可见;点击 → 弹小对话框输入会话名 + 选 angle(架构/数据/接口/自定义);[确认] → 新会话追加到列表末尾 + 切换为 active
- [ ] 点击 Tab → 主区立即显示该会话的 chunks + products;准入仪表板不变
- [ ] `sessionStorage` 保留各会话滚动位置:`analysis-scroll-<session-id>` = scrollTop;切换 Tab 回来恢复
- [ ] `cookie last_session_id` 决定默认 active Tab(下次进入时)
- [ ] 准入仪表板 5 维度计数是**全局聚合**(所有 Tab 合并),不分子会话
- [ ] `getAnalyzingData` 读 `analysis/sessions/_index.yaml`(文件不存在时返回默认单会话 `[架构]`)
- [ ] Tab 列表支持**关闭会话**([×] 按钮,最后一个 Tab 不可关闭)— 本 slice 仅 UI;后端删除逻辑放 VS5 之后(因关闭会清空 chunks.jsonl,需联动)
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-session-tabs.test.tsx`:
  - 多 Tab 渲染(测试数据 3 个 Tab)
  - 点击 Tab 切换 activeId
  - [+] 按钮触发新建对话框
  - 默认 activeId = sessions[0].id
  - 数字徽章显示各 Tab detected_count
- [ ] **集成测试**:`apps/web/src/lib/__tests__/analyzing.test.ts` 扩展:
  - `_index.yaml` 解析为 sessions 数组
  - 默认会话(文件不存在)返回 `{ sessions: [{ id: 'default', label: '架构', angle: 'architecture', detected_count: 0, is_streaming: false }], activeSessionId: 'default' }`
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

## Blocked by

- [19a-analyzing-zone-skeleton-admission-dashboard](issues/19a-analyzing-zone-skeleton-admission-dashboard.md) — 需要工位骨架作为 Tab 容器的父级

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` "会话 Tab 横向导航条" + "准入仪表板全局共享"
- **会话数据结构**(`analysis/sessions/_index.yaml`):
  ```yaml
  sessions:
    - id: sess-default
      label: 架构
      angle: architecture     # architecture / data / interface / custom
      detected_count: 3
      is_streaming: false
      created_at: 2026-07-12T14:00:00+08:00
    - id: sess-data
      label: 数据
      angle: data
      detected_count: 5
      is_streaming: true
      created_at: 2026-07-12T14:10:00+08:00
  ```
- **滚动位置持久化**:用 `sessionStorage` 而非 localStorage(每个 Tab 关闭浏览器即清)
- **activeId 默认值**:cookie `last_session_id` > sessions[0].id > `default`
- **新建会话**:本 slice 仅前端 mock;后端落盘逻辑可推迟到 VS5(技术概要生成时一并处理 sessions 持久化)
- **数据流注意**:VS2 的 `getAnalyzingData` 现在需要按 `activeSessionId` 过滤 chunks;VS2 测试可能要小幅扩展覆盖多会话场景