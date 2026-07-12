---
Status: ready-for-agent
Type: task
Stage: 2
BlockedBy: ['19a-analyzing-zone-skeleton-admission-dashboard']
ParentPRD: PRD-analyzing-rewrite.md
Implements: ADR-0013 D2②
Slice: 2/6
---

# 19b · ANALYZING 解析过程观察(思考流 + 打字机 + 插话)(Vertical Slice 2)

## Parent

- PRD: `.scratch/ai-devspace-mvp/PRD-analyzing-rewrite.md`
- 父 ADR: `docs/adr/0013-analyzing-zone-rewrite.md`
- 父 issue(已标 wontfix): `issues/19-zone-analyzing.md`
- 前置 slice: [19a](issues/19a-analyzing-zone-skeleton-admission-dashboard.md)

## What to build

承接 19a 的工位骨架,在主区填充**"解析过程观察"**的核心体验:

1. 主区左侧:**思考流组件**(沿用原打字机逻辑 + 单会话版)
2. 主区右侧:**Summary**(大图标 + 标题 + 描述 + 3 stats)+ **识别产物分类列表**(📌子问题 / ⚠️风险 / 🎨方案,先只读)
3. 主区底部:**插话输入条** — 用户随时补充上下文或反向提问 AI

完成此 slice 后,用户在 19a 仪表板之下应能:

- 看到 AI 思考流打字机逐字呈现(20ms/字,决策 32),每条 chunk 带时间戳 + 标签 + 文字
- 点击思考流任意位置立即跳过当前 chunk 打字
- ⏸ 暂停 / ▶ 继续打字机
- ↶ 重置清空所有进度从 chunk-0 开始
- 底部"💬 插话输入条"输入文本 + 提交 → 触发 SSE 推送新 chunk(UI 体现为"插话后 AI 在下一轮思考中考虑")
- 数据流:`getAnalyzingData` 从 `analysis/sessions/<session-id>/chunks.jsonl` 或 mock 读取思考流;`interject` 调 Agent `/analysis/interject` endpoint(新建),Agent 接收文本后通过 SSE 把新 chunk 推回

**端到端行为**:

```
打开 /requirements/<id>/analyzing/
   ↓
[Server] getAnalyzingData(id)
   ├─ 读 analysis/sessions/<session-id>/chunks.jsonl → chunks[]  ← VS2 新增数据源
   ├─ 读 analysis/sessions/<session-id>/products.yaml → products (VS4 完整编辑,VS2 只读)
   └─ 返回 AnalyzingData { ..., session: { chunks, summary, stats, products(只读) } }
   ↓
[Client] <AnalyzingZone>
   ├─ 仪表板(19a)
   ├─ 主区:
   │   ├─ 左 <ThinkingStream chunks={...} /> (打字机 + 暂停/重置/跳过)
   │   ├─ 右 <Summary /> + <ProductList /> (只读 3 类)
   │   └─ 底部 <InterjectInput onSubmit={...} />
   └─ AI 思考条(由全局 shell 注入,内容来自 ANALYZING)
```

**插话 SSE 接入**:

```
用户输入文本 + 点 [提交]
   ↓
[Client] POST /api/requirements/<id>/analysis/interject { text, session_id }
   ↓
[Agent] /analysis/interject → 启动 admission-check Skill → 产生新 chunks
   ↓ SSE (decision 31)
[Agent] EventSource push chunk → [Client] 追加到打字机流末尾
```

> **明确不含**(后续 slice 处理):多会话 Tab 切换(VS3 — 本 slice 假设单 Tab)、产物编辑(VS4 — 本 slice 只读)、技术概要生成(VS5)、待裁决面板(VS6)。

## Acceptance criteria

- [ ] 主区左侧渲染 `<ThinkingStream>`:打字机 20ms/字,每条 chunk 显示时间戳 + 标签 + 文字 + 脉动光标
- [ ] 打字机"⏸ 暂停 / ▶ 继续"按钮可见可点击,点击后打字机停止/恢复
- [ ] "↶ 重置"按钮可见可点击,点击后清空当前会话所有进度,从头开始打 chunk-0
- [ ] 点击思考流任意位置立即跳过当前 chunk 打字(完整显示)
- [ ] 主区右侧渲染 `<Summary>`(大图标 + 标题 + 描述)+ 3 stats(子问题 N / 风险点 N / 方案方向 N)
- [ ] 主区右侧渲染 `<ProductList>` 3 类(📌子问题 / ⚠️风险 / 🎨方案),**只读**(卡片无编辑按钮 — 等 VS4)
- [ ] 主区底部渲染 `<InterjectInput>`,含输入框 + [提交] 按钮
- [ ] 输入文本 + 点 [提交]:
  - 输入框清空
  - 触发 `POST /api/requirements/<id>/analysis/interject`
  - SSE 推送新 chunk 追加到打字机流末尾(用 fake-timer 测试推进)
- [ ] 打字机暂停时,插话仍可提交(新 chunk 入队但不显示,直到继续)
- [ ] `apps/agent/src/routes/analysis.ts` 新建文件,导出 `/interject` endpoint
- [ ] `apps/agent` integration test 覆盖 `/interject` 接受 SSE 流
- [ ] `apps/web/src/lib/analyzing.ts` 新增 `session.chunks` 数据源读取(从 `analysis/sessions/<session-id>/chunks.jsonl`)
- [ ] **不破坏**原 [analyzing-zone.tsx](apps/web/src/components/analyzing-zone.tsx) 打字机 phase 状态机(`idle / typing / pausing / done`)— 沿用 fake-timer 测试模式
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-thinking-stream.test.tsx`:
  - 打字机 20ms/字(vi.useFakeTimers + vi.advanceTimersByTime)
  - 暂停/继续切换
  - 重置清空进度
  - 点击跳过当前 chunk
  - 完成时显示"切到 CLARIFYING 吗?"(沿用原行为,改写决策 25 后此弹窗去除 — 见 VS6)
- [ ] **单元测试**:`apps/web/src/__tests__/analyzing-interject-input.test.tsx`:
  - 输入文本 + 点 [提交] → 触发 SSE listener
  - 输入空文本时按钮 disabled
  - SSE 推送新 chunk → 思考流追加显示
- [ ] `pnpm tsc --noEmit` 无错
- [ ] `pnpm test` 全绿

## Blocked by

- [19a-analyzing-zone-skeleton-admission-dashboard](issues/19a-analyzing-zone-skeleton-admission-dashboard.md) — 需要工位骨架 + 仪表板作为主区上层

---

## Implementation notes (hints, not prescription)

> 这些是 hints,实施时可按需调整;不在验收标准里硬约束。

- **沿用**原 [analyzing-zone.tsx](apps/web/src/components/analyzing-zone.tsx) 的打字机 phase state machine + INTER_CHUNK_PAUSE_MS 节奏
- **chunks.jsonl 格式**:每行一个 JSON object `{ id, ts, label, tone, text, session_id }`,按写入顺序追加
- **InterjectInput** 用 Server-Sent Events(`EventSource`)接收新 chunk,与现有 SSE agent client 对齐(决策 31)
- **summary + stats** 数据可从 `chunks.jsonl` 派生(解析最后几条 meta chunk),不强制独立字段
- **HTML 原型对照**:`docs/design/pages/11h-A-zone-multisession-tabs.html` 中部"思考流 + 识别产物"两列 + 底部"插话输入条"
- **完成提示"切到 CLARIFYING 吗?"**:本 slice 沿用原行为;VS6 改写决策 25 后去除