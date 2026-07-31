# 06 — SSR `?session=<sid>` override + loadSessionChunks fallback 链 + /history 分析会话历史分区

**What to build:** Historical sessions become first-class navigable entries. The `/analyzing` route accepts a `?session=<sid>` query that takes precedence over the inferred active session. The session-chunks loader accepts a multi-source fallback chain (explicit override > active-pack latest > first-enabled-pack latest > empty). The `/history` page gains a new "分析会话历史" section that lists all sessions for the requirement from `_index.yaml`, with the active pack's latest session highlighted, and a "查看" link that jumps to the explicit-session URL.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] `/analyzing` page route reads `?session=<sid>` from `searchParams` and forwards it to the session loader
- [ ] `loadSessionChunks(dir, params)` where `params = { explicitSessionId?, activePackId?, enabledPacks }` resolves the session via: explicitSessionId → activePackId latest → `enabledPacks[0]` latest → empty
- [ ] When `explicitSessionId` is provided but no session exists with that id, the loader falls back down the chain (no crash, no 404)
- [ ] An active-session indicator appears in the page header showing "正在查看: <pack_name> · <createdAt 相对>"
- [ ] `/history` page adds a new "分析会话历史" section reading SSR from `_index.yaml`; each row shows `pack_id`, `createdAt`, session short id, verdict, chunks count, sorted by `createdAt` desc
- [ ] The active pack's latest session is visually highlighted in the list
- [ ] Each row has a "查看" button linking to `/requirements/<id>/analyzing?session=<sid>`
- [ ] New tests: SSR `?session=` resolution + fallback chain in `analyzing.server.test.ts` (or equivalent)
- [ ] New test: `/history` section rendering in `analyzing-history-sessions.test.tsx`