---
Status: ready-for-agent
Type: ticket
Parent: ../PRD.md
Related-ADRs: [ADR-0002, ADR-0011, ADR-0014]
Blocked-by: []
---

# 01 — DRAFTING 工位 mock loader 改读 fs

**What to build:** 让 PM 在真实新建需求(已写入 `requirement.md`)后进入 DRAFTING 工位拿到非空数据(prdMarkdown 取文件内容),而不是空白骨架。`drafting.ts` 里现有的 `getDraftingData(reqId)` mock 实现保持不变(向后兼容组件测试和 client-safe 调用),新加 server-only 的 `getDraftingDataFromFs(reqId)`,由 RSC 入口接线调用。本 ticket 完成后,任何新建需求只要 `requirement.md` 超过 10 字节(跟后端 `deriveStatus` 阈值对齐)就跳过空骨架,1.5s 骨架 overlay 不再误触发。

**Blocked by:** None — can start immediately.

## Acceptance criteria

- [ ] 新建 server-only 数据层(参考 `apps/web/src/lib/analyzing.server.ts` 的 `.server.ts` 命名约定),导出 `getDraftingDataFromFs(reqId: string): Promise<DraftingData>`。
- [ ] 路径解析:`path.resolve(process.cwd(), '../../requirements/{reqId}/requirement.md')`(dev 时 cwd = `apps/web/`,production 部署路径处理留 TODO 注释,见 PRD N-2)。
- [ ] 判定逻辑:`existsSync` + `readFileSync` 的内容字节数 > 10 → 构造 `DraftingData`(prdMarkdown 取文件内容,其他字段参考 `REFUND_DRAFTING` 的 default,如 `toolbar.crumb = [{ label: reqId }, { label: '/' }, { label: '草稿', current: true }]`,空 `auxFiles`/`selectedRepoIds`/`repos` 跟 `emptyDrafting` 行为对齐);否则 `emptyDrafting(reqId)`。
- [ ] `req-001` 走硬编码 mock(向后兼容),即使目录里没有 `requirement.md` 也能拿到完整 `REFUND_DRAFTING` 数据。
- [ ] `drafting.ts` 原 `getDraftingData(reqId)` **不删不改动**(向后兼容 client-safe 调用)。
- [ ] 新建 fixture 测试 `apps/web/src/__tests__/drafting.server.test.ts`,用 `os.tmpdir()` 建临时 `requirements/{id}/requirement.md`,覆盖:文件不存在 / 存在但 ≤ 10 字节 / 存在且 > 10 字节 / `req-001` 命中硬编码 mock 四种状态。
- [ ] fixture 目录测试结束清理(`afterEach` 删 `rmSync({ recursive: true, force: true })`),不污染仓库根 `requirements/`。
- [ ] `pnpm --filter web typecheck && pnpm --filter web test drafting.server` 全绿。
- [ ] 现有 `drafting-zone.test.tsx` 保持绿(不依赖 server 文件)。