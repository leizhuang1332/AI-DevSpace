---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 07 — Relative Markdown link → drawer navigation

**What to build:** the PRD's preview (and any auxiliary file's preview inside the drawer) renders clickable standard relative Markdown links. Clicking a link of the form `[name](./aux-file.md)` opens the matching auxiliary file in the drawer, or switches the open drawer to that file if one is already open. External URLs, fragment-only links, paths to non-Markdown files, paths to files that don't exist in this Requirement, and any path that escapes the Requirement's file set (`..` traversals) are ignored — they do not open an unrelated drawer item.

**Blocked by:** 01 (`resolveAuxLink`), 02 (PRD editor + preview), 04 (cards determine the target set), 05 (drawer to host the target file).

## Acceptance criteria

- [ ] The PRD preview renders headings, paragraphs, lists, code blocks, and Markdown links.
- [ ] A standard relative link `[name](./aux.md)` whose target is a known auxiliary file opens that file in the drawer.
- [ ] A link whose target is a known auxiliary file but the relative path resolves outside the Requirement's file set (e.g. `../foo.md`) is ignored.
- [ ] An external URL link (http://, https://, mailto:) is ignored.
- [ ] A fragment-only link (`#section`) is ignored.
- [ ] A relative link to a non-Markdown file or a file that does not exist in this Requirement is ignored.
- [ ] Clicking a relative link while the drawer is already open switches the drawer to the new target file (no second drawer is opened, no unrelated file is shown).
- [ ] Auxiliary files can link to other auxiliary files the same way.
- [ ] Tests cover the full resolver truth table: happy path, external, fragment, missing file, non-Markdown target, `..` traversal, and the "switch drawer" behaviour.
