# 05 — AdmissionDashboard "开始分析" CTA

**What to build:** AdmissionDashboard 在空态时右端渲染 "开始分析" 主按钮;点击触发 `POST /api/requirements/<id>/analysis/start`;流式期间按钮文案切换为 running 态;一旦 AdmissionDashboard 5 维度卡 count 不全 0,按钮自然消失。这是用户与"真分析"之间的唯一显式入口。

> **2026-07-28 修订(ticket 08 · ADR-0020 D2/D9)**:按钮改为**常驻显示**。"已有 session 时无法再次触发 SDK 分析"的死路(Sessions Tabs「+ 新建」仅为前端 mock)成为主要痛点;让按钮一直可见 + 再次点击 = 再开一轮新分析。

**Blocked by:** 01(handler),02(SKILL 内容),03(req-001 干净路径)

**Status:** ready-for-agent

- [x] AdmissionDashboard 组件新增条件渲染分支:`sessions.length === 0 && admission.dimensions.every(d => d.count === 0)` 时,在右端 verdict 徽章旁显示 "开始分析" 主按钮
- [x] 按钮点击 → `POST /api/requirements/<id>/analysis/start`(走 web 端既有 `agentFetch` 路径,具体调用层由实现细节定)
- [x] 流式期间:按钮切 running 态(文案如"分析中…"+ spinner),防重(请求进行中 disabled)
- [x] SSE 推 chunks 后 AdmissionDashboard 自动更新 count,按钮渲染条件变 false 时自然消失
- [x] `AdmissionDashboard` 组件单测新增空态渲染断言(`data-testid="admission-start-btn"`)与条件触发逻辑
- [x] 视觉验收:与 `admission-verdict-badge` 平行、不抢眼、不破坏 ADR-0019 主区锁高度 + 列内独立滚动契约
- [x] 窄视口形态(<1024px,NarrowLayout)同样适用
- [x] `pnpm typecheck` 与 `pnpm test` 通过

**ticket 08 修订 checklist(2026-07-28 落地):**

- [x] `AdmissionDashboard.showStartButton` 父组件永远传 `true`(原空态条件 `sessions.length === 0 && dimensions.every(count===0)` 删除)
- [x] `data-phase` 属性独立派生自 `dimensions.every(count===0)`,与按钮渲染门解耦(修复原同源 bug)
- [x] `AnalyzingZone.handleStart` 加幂等守卫 `if (startState !== 'idle') return`,作为 disabled 二次防线
- [x] agent 端 `runTurn` 末尾(SSE send 成功路径)publish `analysis_done` 命名事件 (`{type:'analysis_done', reqId, sessionId, turn}`)
- [x] web 端 `AnalyzingZone` EventSource `addEventListener('analysis_done', ...)` 监听,按 sessionId 匹配 active session 后 `setStartState('idle')`
- [x] `packages/shared/src/sse.ts` 扩展 `SseEvent` union,新增 `analysis_done` variant
- [x] `AnalyzingZone` 单测反转 2 个 it 断言(有 sessions / 有维度 count 场景下按钮仍渲染)
- [x] `AdmissionDashboard` 单测升级 "verdict=fail 时不互斥" 测试为真正验证两按钮共存
- [x] `analyzing-loader-cta-integration.test.tsx` 反转 "已有 session → CTA 消失" 测试为 "仍可见"
- [x] agent `requirementEventsRoute.test.ts` 新增 analysis_done SSE 透传测试
- [x] E2E `analyzing-real-run.spec.ts` 新增 `data-state='running'` + `data-state='idle'` 复位断言
- [x] ADR-0020 D2/D9 加 2026-07-28 修订批注

**ADR ref:** ADR-0020 ticket 05 / D9(ticket 08 修订:D2 / D9 加修订段)

**Notes / non-goals:**

- snapshot 提交由 ticket 06
- e2e 触发由 ticket 07
- 新建 ticket 时同步在 `.scratch/` 留 issue 文件

---

**Status update (2026-07-26):** 本 issue 在 audit-2026-07-26 之后的 batch 修复中落地;见 `audit-2026-07-26.md` 修复合计 PR。

**Status update (2026-07-28):** ticket 08 落地 —— 按钮改为常驻,startState 由 `analysis_done` SSE 事件复位;ADR-0020 D2/D9 同步修订;5 个测试文件断言反转/升级 + 1 个新 SSE 透传测试。
