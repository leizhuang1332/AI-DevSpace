---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/23-zone-drafting-redesign.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 02 — PRD top pane + skeleton + "进入 ANALYZING" launch

**What to build:** a Requirement opened in DRAFTING shows a workbench whose primary surface is a single PRD editor — title input plus Markdown editor — at the top of the page. An empty Requirement is auto-filled with a deterministic skeleton so the author can start writing immediately. The same 30-second autosave cycle writes (or mocks) the save and updates an observable "已保存 · x 秒前" timestamp. The single bottom action is "▶ 进入 ANALYZING": it is enabled iff the title and the PRD have meaningful content, and clicking it navigates to this Requirement's ANALYZING Zone without mutating any workflow status. The old centered Form (with its structured AC checklist, save-draft action, and "创建并启动 AI 分析" button) is gone.

**Blocked by:** 01 — the new data layer and zone metadata must already be in place; the launch validity, skeleton generator, and equipment flags are all consumed here.

## Acceptance criteria

- [ ] Navigating to a Requirement's DRAFTING Zone shows a PRD top pane containing the title input and a Markdown editor.
- [ ] A Requirement with no PRD content is pre-filled with the standard skeleton (title as H1, four H2 sections 背景 / 目标 / 验收标准 / 非目标) so the author can start writing immediately.
- [ ] Editing the title input updates the title state; editing the Markdown editor updates the PRD state.
- [ ] After 30 seconds of holding content, an observable "已保存 · x 秒前" timestamp updates; clearing all content suppresses the autosave tick.
- [ ] The single bottom action reads "▶ 进入 ANALYZING".
- [ ] The action is disabled when the title is empty or the PRD contains only whitespace.
- [ ] The action is enabled when both the title and the PRD have content, regardless of repositories or auxiliary files (which are not yet rendered at this point).
- [ ] Clicking the enabled action navigates the browser to `/requirements/<id>/analyzing/`; it does not advance any Requirement status, start any Agent, or trigger any side effect beyond navigation.
- [ ] The old centered Form (with its structured AC checklist add/remove interactions) and the old "创建并启动 AI 分析" / "💾 保存草稿" actions are removed; no code path still references them.
- [ ] The previous DRAFTING tests that covered AC items, the "创建并启动 AI 分析" action, and the save-draft action are replaced with tests that cover the new PRD pane, skeleton fill, autosave, launch validity, and the launch navigation.
- [ ] The visual matches the PRD-top region of `docs/design/pages/19-final-drafting.html` (title input, Markdown editor, autosave indicator; no anchor bar, no auxiliary cards, no repository bar yet).
