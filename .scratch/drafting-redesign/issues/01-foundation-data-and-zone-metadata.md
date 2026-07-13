---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 01 — Foundation: drafting data layer + zone metadata sync

**What to build:** the new drafting-domain types and pure functions that all later tickets depend on, and the mechanical cleanup that reconciles the agent YAML, the web metadata mirror, and the ADR wording so they all agree that DRAFTING no longer has a Resource Tree.

**Blocked by:** None — can start immediately.

## Acceptance criteria

- [ ] The drafting module exposes an `AuxFile` model with stable id, filename, Markdown body, a `usage_tag` drawn from a fixed set (api / data / research / sop / ui / other), `source_format` (md / docx / pdf), and `converted_to_md` boolean.
- [ ] A pure `generatePrdSkeleton(title)` returns Markdown containing the title as H1 plus the four H2 sections 背景 / 目标 / 验收标准 / 非目标; the helper is testable in isolation.
- [ ] A pure `extractPrdAnchors(markdown)` returns only H1 and H2 headings (level 1 + 2), each with the source line number for scroll targets; deeper levels are ignored.
- [ ] A pure `resolveAuxLink(currentFile, target, auxFiles)` returns the matching AuxFile only for valid relative paths to known Markdown files within the Requirement; external URLs, fragment-only targets, paths to non-Markdown files, missing files, and `..` traversals all return `null`.
- [ ] A `validateLaunch({ title, prdMarkdown })` returns a launch-validity result that is `canLaunch: true` iff trimmed title is non-empty and PRD Markdown has non-whitespace content; it does not depend on repositories or auxiliary files.
- [ ] A `mockConvertToMarkdown(file)` adapter accepts `.md` / `.docx` / `.pdf` inputs and returns a deterministic Markdown body plus `source_format` and `converted_to_md` metadata; `.md` inputs record `converted_to_md: false`, `.docx` / `.pdf` record `converted_to_md: true`.
- [ ] The agent-side Zone registration and the web-side `ZONE_META` entry for DRAFTING both declare `has_resource_tree: false` and `has_inline_rail: true`.
- [ ] The PRD-outline branch (the DRAFTING-specific tree view in the shared resource-tree module) is removed; no production code path remains that renders a DRAFTING outline tree, and the resource-tree module no longer imports DRAFTING-specific data types for that branch.
- [ ] ADR-0011 §5 (工位与资源树 / Inline 栏对应表) no longer lists DRAFTING as having a Resource Tree; the DRAFTING row reflects the new equipment (Inline Rail only).
- [ ] Unit tests cover the new pure functions (skeleton, anchors, link resolver, launch validity, mock conversion) and pass.
- [ ] Zone-shell and drafting-zone tests are updated so that DRAFTING no longer expects a Resource Tree; the full web test suite still passes for non-DRAFTING zones.
