# 03 — REFUND_ANALYZING 迁 fixture + req-001 短路移除

**What to build:** 删除 `apps/web/src/lib/analyzing.server.ts` 里 `requirementId === 'req-001'` 的硬短路分支;`REFUND_ANALYZING` 常量从 runtime 迁出到 `apps/web/src/__tests__/__fixtures__/analyzing-fixtures.ts`,只作测试 fixture。让 req-001 在磁盘空时首屏渲染出 AdmissionDashboard 空态(由 ticket 05 接管给"开始分析"按钮),与其它 id 行为对齐。

**Blocked by:** 01(start handler 已真接 SDK;req-001 短路不再安全)

**Status:** ready-for-agent

- [ ] `apps/web/src/lib/analyzing.ts` 不再 `export const REFUND_ANALYZING` 作为运行时常量;改为从 `__fixtures__/analyzing-fixtures` 再 export(消费方 import path 稳定优先)
- [ ] `apps/web/src/lib/analyzing.server.ts` 中 `getAnalyzingData` 删去 `req-001` 短路分支(具体行号以实现为准;此 ADR 锁定语义为"对 id 一视同仁")
- [ ] 4 个组件测试文件改 import 路径:`import { REFUND_ANALYZING } from '@/__tests__/__fixtures__/analyzing-fixtures'`
- [ ] `pnpm test` 全过(组件侧单元测试不依赖 `req-001` 特殊数据)
- [ ] 手动验证:打开 `/requirements/req-001/analyzing`,首屏渲染 AdmissionDashboard 全 0 卡 + ProductList 空骨架,不再出 `REFUND_ANALYZING`

**ADR ref:** ADR-0020 ticket 03 / D3

**Notes / non-goals:**
- 不动 AdmissionDashboard UI(ticket 05)
- 不动 SKILL.md 内容(ticket 02)
- `analyzing-fixtures` 文件不限定放 `__tests__/__fixtures__/`,只要 4 个测试 import 路径稳定
