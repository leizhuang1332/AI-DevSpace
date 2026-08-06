# 04 — Agent TaskCardTranscript + 派生 snapshot

**What to build:** TaskCard transcript 物理读写 + 派生父 analyzing snapshot + Run 引用解析,实现 ADR-0028 D1 + D3 + D6 形态。

**Blocked by:** 01 — Shared TaskCard schema

**Status:** ready-for-agent

- [ ] transcript.yaml 读写至 `~/.aidevspace/requirements/<id>/board/tasks/<cardId>/transcript.yaml`(物理独立于父 transcript)
- [ ] 派生初始 snapshot:父 analyzing.transcript 末尾 K=10 条消息(rollout 用户可配),`schema_version: 1` + `snapshot_at` + `snapshot_hash: sha256`
- [ ] messages 字段含 ts / role(user|assistant) / content / refs(prd_section | run_id | asset)
- [ ] TranscriptRefParser 解析 user 输入文本 `#[id]` 引用,展开为指向父 Run 产物的可读 link
- [ ] 写入永远 `tool_calls: []`(TaskCard transcript 不发 Run,守门 ADR-0028 D2)
- [ ] schema_version 字段便于未来升级
- [ ] 单测覆盖:transcript round-trip(写入 → 读出 = 一致)+ 派生 snapshot 复算 hash + #[id] 解析 3 种用例 + tool_calls 永远空
- [ ] **守门保留**:不调 Provider / 不发 Run
- [ ] `pnpm --filter @ai-devspace/agent test` GREEN
