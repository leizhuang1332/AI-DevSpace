---
Status: ready-for-agent
Type: ticket
Parent: ../PRD.md
Related-ADRs: [ADR-0002, ADR-0011, ADR-0014]
Blocked-by: [01-drafting-fs-loader, 02-analyzing-designing-fs-loader]
---

# 03 — page.tsx 切换到 fs loader + 验证组件测试

**What to build:** 把 RSC 入口(`apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx`)从 mock loader 切到 fs loader,让真实需求在 ANALYZING / DESIGNING 工位不再显示空态、DRAFTING 工位不再闪 1.5s 骨架。本 ticket 是 4 个 bug 中 1/2/3 号的最终落地——完成此 ticket 后,bug 1(ANALYZING 空态)、bug 2(DESIGNING 空态)、bug 3(drafting 骨架)对真实新建需求全部消失。

**Blocked by:** 01 (DRAFTING fs loader) + 02 (ANALYZING + DESIGNING fs loader)—— 03 用到 01/02 导出的 server-only 函数。

## Acceptance criteria

- [ ] `page.tsx` 的 `drafting` 分支:`getDraftingData(reqId)` → `getDraftingDataFromFs(reqId)`,import 来源从 `@/lib/drafting` 改成 `@/lib/drafting.server`。
- [ ] `page.tsx` 的 `designing` 分支:`getDesigningData(reqId)` → `getDesigningDataFromFs(reqId)`,import 来源从 `@/lib/designing` 改成 `@/lib/designing.server`。
- [ ] `page.tsx` 的 `analyzing` 分支**不需要改动**:因为 02 的 default options 自动接管,调用形式 `getAnalyzingData(params.id, { ...(lastSessionId ? { lastSessionId } : {}) })` 保持原样。
- [ ] 其他工位(executing / clarifying / wrapup)import 不动(本 ticket 不在 scope 内,见 PRD O-3)。
- [ ] `pnpm --filter web typecheck` 全绿(import 路径正确)。
- [ ] `pnpm --filter web test` 全套绿:
  - 现有 `drafting-zone.test.tsx` / `analyzing-zone.test.tsx` / `designing-zone.test.tsx` 不变(走 `req-001` 硬编码 mock,向后兼容)
  - 01 / 02 新增的 fixture 测试仍绿
- [ ] 手动验证(开发期,可选):启动 dev server,新建一个需求 → 写点 PRD Markdown → 跳到 ANALYZING 工位 → 应该看到骨架 overlay 或内容(不再看到"请回 DRAFTING"提示)。具体行为取决于是否已经接 Agent(见 PRD O-1,本期不接 Agent)。