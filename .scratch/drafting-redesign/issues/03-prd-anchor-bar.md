---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 03 — PRD anchor bar (H1/H2 live, scroll, 1.5s highlight)

**What to build:** a horizontal anchor bar above the PRD editor lists every H1 and H2 heading in the current Markdown. Clicking an anchor scrolls the editor to that heading and applies a brief (~1.5s) visual highlight so the author immediately sees where they landed. The bar updates as the author edits the document; it disappears when the document has no H1/H2 headings; and it is operable without a pointer device.

**Blocked by:** 01 (`extractPrdAnchors`), 02 (the PRD top pane where the bar mounts).

## Acceptance criteria

- [ ] A horizontal anchor bar is rendered above the PRD Markdown editor.
- [ ] The bar lists every H1 and H2 heading in the current PRD Markdown (in source order); H3 and deeper are not listed.
- [ ] The bar updates live as the author edits the document; the list always reflects the latest Markdown.
- [ ] When the PRD has no H1 or H2 headings, the bar is hidden (or renders an empty state) rather than showing stale content.
- [ ] Clicking an anchor scrolls the PRD editor to the corresponding heading.
- [ ] The destination heading is visually highlighted for approximately 1.5 seconds; the highlight clears automatically (verified via fake timers at the external time seam).
- [ ] Each anchor is focusable via keyboard and activatable with Enter.
- [ ] The visual matches the anchor-bar region of `docs/design/pages/19-final-drafting.html`.
- [ ] Tests cover: bar reflects current headings, click scrolls to correct line, highlight clears after the 1.5s window, bar is empty-hidden when no H1/H2, keyboard activation works.
