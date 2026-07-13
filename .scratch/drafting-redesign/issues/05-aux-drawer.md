---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 05 — Auxiliary file drawer (60% width, backdrop, Escape, dialog semantics)

**What to build:** clicking an auxiliary file card opens a right-side drawer occupying 60% of the workbench width, with a translucent backdrop, full dialog semantics, and Escape-to-close behaviour. The drawer hosts the auxiliary file's Markdown editor and shares the same 30-second autosave cycle as the PRD editor. Closing the drawer and reopening the same file restores the latest edited content, so the author can switch context without losing work.

**Blocked by:** 01 (AuxFile), 02 (PRD pane + autosave lifecycle), 04 (the cards the user clicks to open the drawer).

## Acceptance criteria

- [ ] Clicking an auxiliary file card opens a right-side drawer over the workbench.
- [ ] The drawer is approximately 60% of the workbench width; it has both a min-width and a max-width that prevent it from collapsing or overrunning the screen.
- [ ] A translucent backdrop is rendered behind the drawer; clicking the backdrop closes the drawer.
- [ ] Pressing Escape closes the drawer.
- [ ] The drawer exposes accessible dialog semantics (`role="dialog"`, `aria-modal="true"`, an accessible label tied to the file name) and a visible close control.
- [ ] The drawer hosts a Markdown editor for the clicked file; typing updates that file's local state.
- [ ] Edits made in the drawer participate in the same 30-second autosave cycle as the PRD editor.
- [ ] Closing the drawer and reopening the same file shows the latest content (no data loss from drawer lifecycle).
- [ ] Only one drawer is open at a time; opening a second card while a drawer is open switches to the new file.
- [ ] The visual matches the drawer and backdrop region of `docs/design/pages/19-final-drafting.html`.
- [ ] Tests cover: open/close, backdrop click, Escape, dialog semantics, edit persistence across drawer lifecycle, single-drawer invariant.
