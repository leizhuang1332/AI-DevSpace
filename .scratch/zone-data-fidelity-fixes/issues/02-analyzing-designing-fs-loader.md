---
Status: ready-for-agent
Type: ticket
Parent: ../PRD.md
Related-ADRs: [ADR-0002, ADR-0011, ADR-0013, ADR-0014]
Blocked-by: []
---

# 02 — ANALYZING + DESIGNING 工位 mock loader 改读 fs

**What to build:** 让 PM 在真实需求下进入 ANALYZING 工位不再被空态"请回 DRAFTING"误导,进入 DESIGNING 工位不再被空态"请去 ANALYZING"误导——这两个工位的 mock loader 也要跟 DRAFTING 一样读真实 fs。ANALYZING 通过 default options 注入路径(最小侵入),DESIGNING 新建 server-only 数据层(因为 `designing.ts` 是 client-safe,fs IO 不能塞进去)。

**Blocked by:** None — can start immediately. 可跟 01 并行开发,二者无文件冲突。

## Acceptance criteria

### ANALYZING 部分

- [ ] 修改 `apps/web/src/lib/analyzing.server.ts` 的 `getAnalyzingData(reqId, options?)`:当 caller **没传** `options.analysisDir` 时,默认注入 `analysisDir = path.resolve(process.cwd(), '../../requirements/{reqId}/analysis')`;同理 `analysisSessionsDir`。
- [ ] 显式传 `options` 仍可覆盖(为后续 agent API 留口子);`lastSessionId` 透传逻辑不变。
- [ ] `req-001` 命中硬编码 mock(向后兼容)的短路逻辑保持原样,在 default options 注入**之前**判定。

### DESIGNING 部分

- [ ] 新建 server-only 数据层(参考 `analyzing.server.ts` 模式),导出 `getDesigningDataFromFs(reqId: string): Promise<DesigningData>`。
- [ ] 路径解析:`requirements/{reqId}/design/` 目录 + 内部至少一个 yaml 存在 → 非空。
- [ ] 产物 schema(参考 PRD D-2):`requirements/{reqId}/design/{stage,candidates,design_doc,tradeoff}.yaml` 四文件,字段名跟 `REFUND_DESIGNING` 内部硬编码(`REFUND_DESIGN_DOC` / `REFUND_CANDIDATES` / `REFUND_TRADEOFF`)逐字段对齐(id / title / tag / pros / cons / metrics / recommended 等),字段命名 snake_case,adapter 函数做 camelCase 转换。
- [ ] 任一必需 yaml 缺失或为空 → `emptyDesigning(reqId)`。
- [ ] `req-001` 命中硬编码 mock(向后兼容),短路在 fs 检查**之前**。
- [ ] `designing.ts` 原 `getDesigningData(reqId)` **不删不改动**。

### 测试部分

- [ ] 新建 fixture 测试 `apps/web/src/__tests__/analyzing-default-fs.test.ts`:覆盖 `getAnalyzingData` 在不传 options 时自动注入路径,并能成功从 fixture 目录读到 `_index.yaml` + `chunks.jsonl`。
- [ ] 新建 fixture 测试 `apps/web/src/__tests__/designing.server.test.ts`:覆盖 `design/` 不存在 / `candidates.yaml` 缺失 / 4 个 yaml 齐备且非空 / `req-001` 兜底 四种状态。
- [ ] fixture 用 `os.tmpdir()` 隔离,`afterEach` 清理。
- [ ] `pnpm --filter web typecheck && pnpm --filter web test analyzing-designing` 全绿。
- [ ] 现有 `analyzing-zone.test.tsx` / `designing-zone.test.tsx` 保持绿(向后兼容硬编码 mock 路径)。