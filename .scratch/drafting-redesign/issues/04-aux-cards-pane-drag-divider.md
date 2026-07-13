---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 04 — Auxiliary file cards pane + draggable divider

**What to build:** a second pane below the PRD top pane renders the Requirement's auxiliary files as a card grid (icon, filename, usage tag). A vertical drag handle between the two panes lets the author adjust the height split; the default is roughly 60% PRD / 40% auxiliary, and the split is constrained so that at least one row of cards remains visible. When no auxiliary files exist yet, the pane shows a dashed "新建/上传" placeholder card instead of a blank area.

**Blocked by:** 01 (`AuxFile` data shape), 02 (the PRD pane the divider hangs from).

## Acceptance criteria

- [ ] An auxiliary-files pane is visible below the PRD top pane.
- [ ] Each AuxFile in the Requirement renders as a card showing its icon, filename, and usage tag (API 草案 / 数据字典 / 调研 / SOP / UI 草图 / 其他).
- [ ] A vertical drag handle sits between the PRD pane and the auxiliary pane; hovering it shows a resize cursor.
- [ ] Dragging the handle adjusts the split ratio; the change is reflected immediately.
- [ ] The default split is approximately 60% PRD / 40% auxiliary (the exact flex ratio is the implementation's choice; the user-visible behaviour is the default ratio plus a minimum-row floor).
- [ ] The split is constrained so that at least one row of auxiliary cards remains visible at all times, even at the smallest PRD allocation.
- [ ] When the auxiliary file list is empty, the pane shows a dashed "新建/上传" placeholder card rather than an empty box.
- [ ] The visual matches the auxiliary-pane and resizer region of `docs/design/pages/19-final-drafting.html`.
- [ ] Tests cover: cards render for known AuxFiles, drag updates the split, the minimum-row floor holds, the empty-state placeholder is shown when no aux files exist.
