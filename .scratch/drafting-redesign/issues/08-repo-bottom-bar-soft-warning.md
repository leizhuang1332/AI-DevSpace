---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 08 — Sticky repository bottom bar + soft warning

**What to build:** a sticky bottom bar runs the full width of the workbench and contains the repository multi-select chips, an inline soft warning, and the "▶ 进入 ANALYZING" action (now moved into the bar from its earlier standalone position). The soft warning "⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文" appears when zero or one repository is selected and disappears once two or more are selected. The warning is non-blocking: the launch button's enabled state is governed by the PRD/title content alone, never by repository count.

**Blocked by:** 01 (DraftingRepo data shape), 02 (the launch button that now moves into the bar).

## Acceptance criteria

- [ ] A sticky bottom bar is visible at the bottom of the workbench, always present while the user scrolls.
- [ ] The bar contains the repository multi-select chips, the soft warning area, and the "▶ 进入 ANALYZING" action.
- [ ] The bar remains visible during vertical scroll of the workbench.
- [ ] When zero or one repository is selected, the warning "⚠ 仅 N 个仓库 · ANALYZING 可能无法完整关联代码上下文" is visible.
- [ ] When two or more repositories are selected, the warning is hidden.
- [ ] The warning is purely visual: the "▶ 进入 ANALYZING" button's enabled state is determined by title + PRD content alone, not by repository count.
- [ ] Selecting or deselecting a repository chip updates the warning visibility in the same render.
- [ ] The visual matches the `.repo-bar` region of `docs/design/pages/19-final-drafting.html`.
- [ ] Tests cover: warning visibility across the 0 / 1 / 2+ repo threshold, warning does not disable the launch button, launch validity is independent of repository count.
