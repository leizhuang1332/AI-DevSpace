# 05 — Pack dropdown + GET /enabled-packs + localStorage 持久化 + 一次性 hint

**What to build:** The AdmissionDashboard top bar shows a Pack selector (dropdown) populated from a new HTTP endpoint that lists the workspace's enabled packs with display metadata (`displayName`, `unitsCount`, `algorithmName`). The dropdown's default selection persists across reloads per-requirement via localStorage with a deterministic fallback chain. Switching the dropdown only updates local state — it does NOT trigger a new session; the user must press 「▶ 开始分析」 to commit. A one-time hint educates the user about the deferred-commit behavior and dismisses permanently.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] New endpoint `GET /api/requirements/:id/analysis/enabled-packs` returns `{ packs: Array<{ pack_id, displayName, unitsCount, algorithmName }> }` from the workspace's `analysis.enabled_packs`
- [ ] `AdmissionDashboard` top bar renders a single line `📦 Pack: <dropdown> · <units> units · algorithm: <name>` above the dimension cards
- [ ] Dropdown is populated from the enabled-packs endpoint; each option shows `<pack>` label + unit count + algorithm name
- [ ] Default selection follows the chain: `localStorage['aidevspace:<reqId>:lastPack']` → `enabled_packs[0]` → `baseline-5dim`
- [ ] Changing the dropdown writes to localStorage immediately but does NOT start a session
- [ ] Pressing 「▶ 开始分析」 POSTs `{ pack_id: <current dropdown value> }` and writes the selection to localStorage
- [ ] A one-time hint "切换不会立即生效，按 ▶ 开始分析 才用此 Pack" is visible at the top; once dismissed it does not reappear (even after reload)
- [ ] `admission-dashboard.test.tsx` extended: dropdown renders, switching writes localStorage, start POST body reflects dropdown value
- [ ] New test `routes-analysis-enabled-packs.test.ts` covers the endpoint shape + missing-config handling