# 03 — Start handler 收紧 body 为 `{pack_id}` + enabled_packs 校验 + verdict 迁 service + verdict_finalized SSE

**What to build:** The session-start HTTP contract now requires `pack_id` (and nothing else for admission). Pack ID must be in the workspace's `enabled_packs` list or the request 400s with the available list. The model no longer writes `[VERDICT]` — only `[DIM]` blocks per unit. At end of turn-1 the service runs the pack's algorithm against the collected per-dimension judgments, computes a `PackVerdict`, appends a `verdict_summary` line to chunks.jsonl, and emits an SSE `verdict_finalized` event before the stream closes. The deprecated tech-brief endpoint returns 410.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `POST /analysis/start` body schema is `{ pack_id: string }`; `angle` / `label` / `session_id` fields are no longer accepted (rejected as 400 with `unrecognized_field` code)
- [ ] `pack_id` not in workspace's `analysis.enabled_packs` → 400 `{ error: 'pack_not_enabled', reason, available_packs: [...] }`
- [ ] `pack_id` triggers a load via the pack loader; structure failure → 500 with V-3 error body; semantic failure → warning log + session continues
- [ ] Session ID format becomes `sess-<packId>-<Date.now().toString(36)>` (replaces old `sess-<angle>-<ts>`)
- [ ] Model turn-1 prompt asks only for `[DIM <id>]` blocks; the model is NOT asked to output `[VERDICT]`
- [ ] End of turn-1: service runs `algorithmInterpreter` over the collected `[DIM]` chunks against the loaded pack's algorithm → produces a `PackVerdict` (✅ / ⚠️ / ❌ + reason + hitRuleId)
- [ ] A `verdict_summary` line is appended to chunks.jsonl with the `PackVerdict` + per-unit `UnitJudgment[]` payload
- [ ] An SSE event `verdict_finalized` is emitted before the stream closes, with `{ type, reqId, sessionId, ts, verdict: PackVerdict }`
- [ ] `POST /analysis/generate-brief` returns `410 Gone` + `{ error: 'feature_disabled', message: 'tech-brief 已在 ADR-0022 中搁置;请使用 ADR-0021 Pack 装载模型' }`
- [ ] chunks.jsonl single-line schema otherwise unchanged (existing parser still parses non-verdict chunks)
- [ ] `routes-analysis-start.test.ts` extended with the new body / error / 410 cases
- [ ] `routes-analysis-generate-brief.test.ts` updated for the 410 response