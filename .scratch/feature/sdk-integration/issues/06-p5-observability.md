---
Status: needs-triage
Type: task
Stage: P5
---

# 06 - P5 观测性：N 条独立 SSE + 活动流折叠 + 状态色码

## 目标

落地 ADR-0010 Q10（观测性）：L1-L4 全栈、N 条独立 SSE、活动流折叠、StatusBar 静默更新。

## 范围

### Q10.2 N 条独立 SSE 通道

- [ ] `sse/SseHub.ts` 升级：每个 sessionId 一条独立 SSE
  - `subscribe(sessionId, callback)` → 订阅
  - `publish(sessionId, event)` → 推给该 session 订阅者
  - `unsubscribe(sessionId, callback)` → 取消订阅
  - session 关闭 → 自动清理订阅者
- [ ] Fastify 路由：`GET /api/requirement/:reqId/session/:sid/events`（per session SSE）
- [ ] Web 端按 sessionId 订阅（一个 Web 页面打开 N 个 session tab 时，每个 tab 订阅自己的 SSE）

### Q10.3 活动流折叠在 chat 气泡下

- [ ] AI 流式响应分类：
  - **对话流**（user/assistant 文本消息）→ 直接显示在 chat 主气泡
  - **活动流**（工具调用、文件读、grep、bash 等内部操作）→ 折叠在对应 assistant 气泡下方
- [ ] 活动流 UI 形态（按决策 43b）：12px 灰字一行 + 1px 顶部分隔线 + hover 展开 3 行详情
- [ ] 不主动弹（5 类必沉默触发时连活动流都隐藏）

### Q10.4 状态色码

- [ ] StatusBar AI 区 4 指示器（决策 49）：
  - 状态色码：灰（idle）/ 蓝脉动（观察中）/ 黄（思考中）/ 绿闪（等回答）/ 红（出错）
  - 待回答 N / 候命 N / 最近写入 N
  - 点击看详情
- [ ] 状态变化静默更新（不 Toast，不弹窗）
- [ ] 5 类必沉默（决策 44）：
  - ①用户在读（无输入+无滚动）②全屏沉浸模式 ③Web 标签不在前台 ④麦克风/摄像头 ⑤同 (skill, context) dismiss ≥ 3 次
  - 任一触发 → Inline 提示栏 + 活动流都隐藏
  - 状态色码仍更新（用户可主动看 StatusBar）

### L1-L4 全栈

- [ ] **L1 StatusBar**：实时状态色码（已在 Q10.4 覆盖）
- [ ] **L2 Chat 流**：对话流 + 活动流（已在 Q10.3 覆盖）
- [ ] **L3 per-session log.jsonl**（已在 P4 覆盖，验收用）
- [ ] **L4 全局 agent.log**（已在 P4 覆盖，验收用）

## 验收

- 同时开 3 个 session → 3 条独立 SSE，事件互不串台
- AI 调 Edit 工具 → chat 气泡下出现折叠的「✏️ Edit X.java」一行
- AI 调 Read + Grep + Bash 三个工具 → 3 行活动流，hover 展开详情
- 用户从 chat 切到别的标签 30s → 切回来活动流没有积累新事件（被沉默）
- StatusBar 颜色随 AI 状态变化（idle → 思考 → 等回答 → 完成），无 Toast
- per-session log.jsonl 记录所有 query，全局 agent.log 记录跨 session 事件

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)（1 条 SSE 起步）
- [04-p3-persistence.md](04-p3-persistence.md)
- [05-p4-errors.md](05-p4-errors.md)

## 估时

0.5 周
