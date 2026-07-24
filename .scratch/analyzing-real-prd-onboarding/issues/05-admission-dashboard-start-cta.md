# 05 — AdmissionDashboard "开始分析" CTA

**What to build:** AdmissionDashboard 在空态时右端渲染 "开始分析" 主按钮;点击触发 `POST /api/requirements/<id>/analysis/start`;流式期间按钮文案切换为 running 态;一旦 AdmissionDashboard 5 维度卡 count 不全 0,按钮自然消失。这是用户与"真分析"之间的唯一显式入口。

**Blocked by:** 01(handler),02(SKILL 内容),03(req-001 干净路径)

**Status:** ready-for-agent

- [ ] AdmissionDashboard 组件新增条件渲染分支:`sessions.length === 0 && admission.dimensions.every(d => d.count === 0)` 时,在右端 verdict 徽章旁显示 "开始分析" 主按钮
- [ ] 按钮点击 → `POST /api/requirements/<id>/analysis/start`(走 web 端既有 `agentFetch` 路径,具体调用层由实现细节定)
- [ ] 流式期间:按钮切 running 态(文案如"分析中…"+ spinner),防重(请求进行中 disabled)
- [ ] SSE 推 chunks 后 AdmissionDashboard 自动更新 count,按钮渲染条件变 false 时自然消失
- [ ] `AdmissionDashboard` 组件单测新增空态渲染断言(`data-testid="admission-start-btn"`)与条件触发逻辑
- [ ] 视觉验收:与 `admission-verdict-badge` 平行、不抢眼、不破坏 ADR-0019 主区锁高度 + 列内独立滚动契约
- [ ] 窄视口形态(<1024px,NarrowLayout)同样适用
- [ ] `pnpm typecheck` 与 `pnpm test` 通过

**ADR ref:** ADR-0020 ticket 05 / D9

**Notes / non-goals:**
- snapshot 提交由 ticket 06
- e2e 触发由 ticket 07
- 新建 ticket 时同步在 `.scratch/` 留 issue 文件
