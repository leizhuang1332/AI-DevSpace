---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
Related-Issues: [08-repo-bottom-bar-soft-warning]
Design-Reference: ../../../docs/design/pages/repo-bar-redesign-comparison-20260720.html
---

# 09 — Collapsible sticky repository bar + per-chip detach (×)

**What to build:** rewrite the existing [repo-bar.tsx](apps/web/src/components/repo-bar.tsx) so the bottom bar **collapses by default** into a single 40px row with a one-line summary (`📦 已选 N 个仓库 ▾`) plus the soft warning plus the launch button, and **expands inline** into a multi-row chip list when the user clicks the summary. Each expanded chip carries a **per-chip × detach button** that immediately removes the repo from `selectedRepoIds` (one-click, no confirmation, no animation, no toast). The N=0 empty state is **not changed** — it still uses the issue 01 ticket's `＋ 添加仓库…` + `💡 首次添加仓库时会请你填写统一分支名` hint. The soft warning `⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文` is **always visible** in both collapsed and expanded states.

**Why this issue exists:** the current implementation (issue 08) lets the bar grow to 2-3 rows when N≥5, eating 100-135px of viewport — the workspace always feels cramped at the bottom. The detach action is also missing, so once a repo is attached there's no way to remove it without opening the attach dialog and unchecking it (high friction, no clear affordance).

**Visual reference:** [repo-bar-redesign-comparison-20260720.html](../../../docs/design/pages/repo-bar-redesign-comparison-20260720.html) (方案 B column).

**Blocked by:** 08 (the bar itself).

## Frozen decisions (from 7-round grilling, 2026-07-20)

| # | Decision | Choice |
|---|---|---|
| 1 | Detach semantic | **detach** (remove from `selectedRepoIds`, global pool untouched) |
| 2 | Bar form | **方案 B · collapsible sticky** |
| 3 | Expanded form | **inline expand** (40px ↔ 100-180px on user action) |
| 4 | × button behavior | **one-click · immediate unmount** (no toast, no animation) |
| 5 | Soft warning position | **always visible in collapsed row** + **kept in expanded view below chip area** |
| 6 | Expanded content | **only show selected chips + ×** (no "selectable" group) — adding repos still goes through `attach-repos-dialog` (append mode) |
| 7 | N=0 empty state | **unchanged** — keep issue 01 ticket's `＋ 添加仓库…` + hint |

## Viewport cost (1280×800)

| State | Current (issue 08) | After this issue | Delta |
|---|---|---|---|
| N=0 empty | ~50px | ~40px | -20% |
| N=2 normal | ~65px | ~40px | -38% |
| N=8 crowded | ~135px | ~40px | **-70%** |
| N=1 soft warning | ~65px | ~40px | -38% |

## Acceptance criteria

### Collapsed / expanded toggle

- [ ] Bar default state is **collapsed** (40px single row) when `selectedRepoIds.length >= 1`.
- [ ] Bar shows the existing N=0 empty state (`＋ 添加仓库…` + hint) when `selectedRepoIds.length === 0` — the summary is NOT shown in N=0.
- [ ] Summary row contains: label `关联仓库` + `📦 已选 N 个仓库 ▾` button + soft warning (if `shouldShowRepoSoftWarning`) + launch button.
- [ ] Clicking the summary (or its `▾` caret) toggles the expanded state.
- [ ] Expanded state reveals: all `selectedRepoIds` chips, each with a trailing `×` button, plus the `＋ 添加仓库…` button (which still calls `onRequestAttach` / opens the attach dialog in append mode).
- [ ] Expanded state's bar height grows inline; the sticky bottom anchor does not change.
- [ ] When `attachedBranchName` is set and at least one chip is in the selected set, the expanded view shows the `🟢 <branch>` annotation on each chip (preserve existing behavior from issue 08 / ticket 02 验收 #9).
- [ ] Soft warning `⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文` is visible in **collapsed** state, and **also** in **expanded** state (below the chip list, not duplicated in the summary row).

### Per-chip × detach

- [ ] Each expanded chip shows a trailing `×` button (`data-testid="drafting-repo-chip-detach"`, `data-repo-id="<id>"`).
- [ ] Clicking `×` immediately removes the repo from `selectedRepoIds` (no confirm dialog, no toast, no animation).
- [ ] Removed chip unmounts in the same render.
- [ ] When the last chip is removed (`selectedRepoIds` goes from N=1 to N=0), the bar transitions to the N=0 empty state — `data-empty-state="true"` flips and the summary hides.
- [ ] When the last chip is removed at N=1, the soft warning flips from visible to hidden in the same render (because `shouldShowRepoSoftWarning([]) === true` but the warning is only shown in collapsed summary row, which doesn't render at N=0 — see N=0 invariant below).
- [ ] × does not affect global `repos` — re-attaching via the dialog still works after detach.
- [ ] × is **not** rendered in the collapsed summary — it only appears in expanded chips. (The collapsed summary is a one-line list of names without per-chip controls.)

### N=0 invariant (regression guard)

- [ ] When `selectedRepoIds.length === 0`, render exactly the issue 01 ticket N=0 state: `[＋ 添加仓库…]` button (when `onRequestAttach` is provided) + `💡 首次添加仓库时会请你填写统一分支名` hint + launch button.
- [ ] The `📦 已选 0 个仓库 ▾` summary is **not** rendered at N=0 (zero information, violates the "every element earns its pixels" rule from UI-POLISH-SPEC).
- [ ] The collapsible toggle state is reset to `collapsed` when N transitions from ≥1 to 0 (so a re-add starts collapsed).

### Non-coupling (regression guard for issue 08 验收 #7 #8)

- [ ] `canLaunch` is still computed by the parent (`DraftingZone`) based on title + PRD content alone — the bar does not read `selectedRepoIds.length` to influence `canLaunch`.
- [ ] Soft warning visibility is still driven by `shouldShowRepoSoftWarning(selectedRepoIds)` — the bar does not duplicate the rule.
- [ ] Launch button still respects `launchDisabledHint` and `canLaunch` from the parent.

### Component contract

- [ ] `RepoBarProps` adds: `onDetachRepo: (repoId: string) => void` (REQUIRED for N≥1 — parent owns the `selectedRepoIds` state).
- [ ] Existing props (`repos`, `selectedRepoIds`, `failedRepoIds`, `onToggleRepo`, `canLaunch`, `launchDisabledHint`, `onLaunch`, `onRequestAttach`, `attachedBranchName`) remain unchanged.
- [ ] New `data-*` attributes:
  - `data-collapsed="true|false"` on the bar root
  - `data-summary-count="<N>"` on the summary button
  - `data-testid="drafting-repo-bar-summary"` on the summary button
  - `data-testid="drafting-repo-bar-expanded"` on the expanded container
  - `data-testid="drafting-repo-chip-detach"` + `data-repo-id` on each × button

### Accessibility

- [ ] Summary button has `aria-expanded` matching `data-collapsed` state.
- [ ] Summary button has `aria-controls="<expanded-container-id>"`.
- [ ] Each × button has `aria-label="取消关联 <repo.name>"`.
- [ ] Bar's `role="region"` and `aria-label="仓库选择与启动操作"` (existing) remain.

## Implementation sketch

```
RepoBar (root, role=region, data-collapsed)
├── isEmptyState (N=0) → render issue 01 ticket N=0 JSX (unchanged)
└── else (N≥1)
    ├── summary row (h=40px)
    │   ├── lbl "关联仓库"
    │   ├── summary button (click → toggle, data-summary-count, aria-expanded)
    │   ├── soft warning (if shouldShowRepoSoftWarning)
    │   └── launch button (existing)
    └── expanded container (only when !collapsed)
        ├── chip list (selectedRepoIds.map)
        │   └── per chip: name + branch annotation (if any) + × detach button
        └── soft warning (if shouldShowRepoSoftWarning) — kept for visibility
        └── ＋ 添加仓库… button (when onRequestAttach)
```

## Testing plan

| Layer | What | Count |
|---|---|---|
| Unit (RepoBar) | renders N=0 empty state when `selectedRepoIds=[]` | +1 |
| Unit | renders collapsed summary when N≥1 (default) | +1 |
| Unit | clicking summary toggles `data-collapsed` | +1 |
| Unit | renders all selected chips in expanded view | +1 |
| Unit | × button calls `onDetachRepo` with the right `repoId` | +1 |
| Unit | × button is **not** present in collapsed summary | +1 |
| Unit | soft warning visible in collapsed row | +1 |
| Unit | soft warning also visible in expanded view | +1 |
| Unit | × detaching last chip (N=1 → N=0) transitions to N=0 empty state | +1 |
| Unit | `canLaunch` does not affect chip visibility / warning | +1 |
| Unit | `failedRepoIds` chips still render red border + ✕ in expanded view (regression for issue 08 ticket 02) | +1 |
| Integration (DraftingZone) | `onDetachRepo` from RepoBar removes id from `selectedRepoIds` state | +1 |
| Integration | soft warning visibility flips when last chip is removed at N=1 | +1 |

Total: **13 new test cases**. Existing tests (issue 08 + ticket 02) remain green.

## Files to touch

| File | Change |
|---|---|
| `apps/web/src/components/repo-bar.tsx` | Rewrite collapse/expand logic; add `onDetachRepo` prop; add per-chip × JSX; add new `data-*` + `aria-*` |
| `apps/web/src/components/drafting-zone.tsx` | Add `onDetachRepo` handler that filters `selectedRepoIds`; pass it to `RepoBar` |
| `apps/web/src/components/__tests__/drafting-zone.test.tsx` | Add tests for detach callback + N=0 transition |
| `apps/web/src/components/__tests__/repo-bar.test.tsx` (new, if doesn't exist) | New unit tests covering the 11 unit cases above |

## Out of scope

- Detach confirmation dialog (rejected: detach is reversible, × is already visually loud)
- Toast notification on detach (rejected: noise, no value)
- Animation on detach (rejected: extra cost, marginal UX gain)
- Drag-to-reorder chips (deferred — no user request yet)
- Bulk detach (multi-select chips with delete) (deferred — no user request yet)
- "Detach from global pool" (rejected — out of scope; would be in a separate `repo-management` ticket)
- Redesigning the attach-repos-dialog (already covered by issue 01 ticket)
- Changing the launch button placement (still sticky right, unchanged)

## Rollback plan

Single-component rewrite. Revert the commit to restore issue 08 behavior. No data model change, no schema migration, no API change — pure UI.

## Effort estimate

| Component | Effort |
|---|---|
| `repo-bar.tsx` rewrite | ~2-3h (component already exists, mostly layout restructure) |
| `drafting-zone.tsx` handler | ~15min |
| Unit + integration tests | ~2h (13 new cases, mostly attribute/role assertions) |
| Manual visual verification + adjustment | ~1h |
| **Total** | **~5-6h** |
