---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 06 — Auxiliary file create + upload (usage tag, mock conversion metadata)

**What to build:** the auxiliary-files pane header gains a "＋ 新建" button and a "📁 上传" button. "＋ 新建" asks for a filename and a usage tag, then creates a new editable Markdown file that immediately appears as a card. "📁 上传" accepts `.md` / `.docx` / `.pdf` files; Markdown uploads are stored as-is, while DOCX/PDF uploads go through the mock conversion adapter and are flagged with a "↻ 已转 MD" chip so the author can tell converted content apart from native Markdown. All files end up as Markdown regardless of origin.

**Blocked by:** 01 (`AuxFile`, `UsageTag`, `mockConvertToMarkdown`), 02 (autosave lifecycle), 04 (cards render), 05 (new files are editable in the drawer).

## Acceptance criteria

- [ ] The auxiliary pane header shows a "＋ 新建" button and a "📁 上传" button.
- [ ] "＋ 新建" prompts for a filename and a usage tag from the supported set (API 草案 / 数据字典 / 调研 / SOP / UI 草图 / 其他); submitting creates a new AuxFile with empty Markdown and the chosen tag.
- [ ] The new file appears as a card in the grid immediately, and is editable in the drawer.
- [ ] "📁 上传" accepts `.md`, `.docx`, and `.pdf` files.
- [ ] Uploading a `.md` file produces an AuxFile with `source_format: md` and `converted_to_md: false`; no conversion chip is shown.
- [ ] Uploading a `.docx` or `.pdf` file produces an AuxFile with the original `source_format` recorded, `converted_to_md: true`, and a "↻ 已转 MD" chip visible on its card.
- [ ] All uploaded files end up stored as Markdown in the editor; the original-format information is metadata, not the editable body.
- [ ] Mock conversion is deterministic: the same DOCX/PDF input produces the same Markdown output (verified by tests that exercise `mockConvertToMarkdown` with representative inputs).
- [ ] Tests cover: new file flow (filename + tag), upload of each format, conversion metadata, chip visibility, mock-conversion determinism.
- [ ] The visual matches the file-card meta-row region of `docs/design/pages/19-final-drafting.html`, including the ↻ chip styling.
