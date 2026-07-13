---
Status: ready-for-agent
Type: task
Stage: 2
Supersedes: 18-zone-drafting.md
Related-ADRs: [ADR-0006, ADR-0011, ADR-0012]
---

# 23 - DRAFTING 工位：PRD 与辅助文件准备车间

## Problem Statement

当前 DRAFTING 工位仍以“创建需求并启动 AI 分析”的居中表单为核心，将标题、PRD、结构化验收标准和仓库选择混合在同一表单中。这与现在的 Requirement 生命周期不一致：Requirement 已在需求列表中创建，DRAFTING 应当是用户持续准备 PRD 与辅助上下文的独立工位，而不是创建入口或由 AI 推动的流程节点。

现有工位还缺少辅助文件这一等领域对象。用户无法在保留 PRD 上下文的同时创建、上传、查看和编辑 API 草案、数据字典、调研、SOP、UI 草图等材料；PRD 大纲被放在资源树中，与正在编辑的客户端内容不能自然同步；结构化 AC checklist 又提前承担了应由 ANALYZING 工位完成的准入分析职责。

用户需要一个以唯一 PRD 为主、辅助文件为辅的准备车间：在同一工作区持续编辑材料、通过 PRD 锚点快速导航、用抽屉处理辅助文件、选择相关仓库，并在材料达到最低门槛后主动进入 ANALYZING，同时不改变“工位可任意跳转、用户主导、AI 不主动推进”的平台原则。

## Solution

将 DRAFTING 重构为“PRD + 辅助文件准备车间”。主工作区采用 PRD 顶置布局：PRD 编辑器位于上部并占据主要空间，辅助文件卡片位于下部，两区可拖拽调整；仓库选择和“进入 ANALYZING”动作固定在底部。DRAFTING 不再显示资源树，改在 PRD 编辑器顶部提供随内容更新的 H1/H2 锚点条。右侧继续保留候命 Skill Inline Rail。

每个 Requirement 始终拥有且仅拥有一个不可删除的 PRD。空 Requirement 首次进入 DRAFTING 时自动获得标准 PRD 骨架，用户也可上传 Markdown 覆盖骨架。辅助文件作为独立文件集合，以卡片呈现；用户可新建或上传文件，并在保持主工作区上下文的 60% 宽右侧抽屉中编辑。所有文件统一落为 Markdown，上传来源及是否经过 mock 转换以元数据保留，用途通过显式用途标签表达。

DRAFTING 只负责准备材料，不做完整性分析。进入 ANALYZING 的硬门槛只有标题有值和 PRD 有内容；仓库为零时给出软警告，辅助文件完全可选。用户点击后仅导航到对应 Requirement 的 ANALYZING 工位，不依据 Requirement status 自动推进，也不在 DRAFTING 中启动真实 Agent 分析。

## User Stories

1. As a Requirement author, I want DRAFTING to open an already existing Requirement, so that I can focus on preparing its materials instead of recreating it.
2. As a Requirement author, I want DRAFTING to be an independent Zone URL, so that I can enter it directly and return to it at any time.
3. As a Requirement author, I want to move between Zones explicitly, so that the workspace never advances without my intent.
4. As a Requirement author, I want the main workspace to prioritize the PRD, so that the primary input to ANALYZING is always visually dominant.
5. As a Requirement author, I want the PRD pane to occupy at most roughly 60% of the available vertical workspace by default, so that auxiliary materials remain visible.
6. As a Requirement author, I want at least one row of auxiliary file cards to remain visible, so that I always know supporting materials are part of the workspace.
7. As a Requirement author, I want to drag the divider between the PRD and auxiliary-file areas, so that I can adapt the workspace to the task at hand.
8. As a Requirement author, I want repository selection and the primary action to remain available in a sticky bottom bar, so that long documents do not hide important controls.
9. As a Requirement author, I want the DRAFTING Skill Inline Rail to remain available, so that I can intentionally invoke relevant assistance without leaving the Zone.
10. As a Requirement author, I want the Inline Rail to remain passive until I act, so that AI does not interrupt or push the Requirement forward.
11. As a Requirement author, I want exactly one PRD for each Requirement, so that ANALYZING has an unambiguous primary document.
12. As a Requirement author, I want the PRD to be impossible to delete, so that a Requirement cannot lose its required primary document.
13. As a Requirement author, I want the Requirement title to remain a separate field from the Markdown content, so that metadata and document structure retain distinct meanings.
14. As a Requirement author, I want an empty Requirement to receive a standard PRD skeleton on first entry, so that I can start writing immediately.
15. As a Requirement author, I want the generated skeleton to include the Requirement title and sections for background, goals, acceptance criteria, and non-goals, so that new PRDs begin with a useful structure.
16. As a Requirement author, I want to edit the PRD directly in the main pane, so that drafting remains the central activity.
17. As a Requirement author, I want to upload a Markdown file to replace the generated PRD skeleton, so that I can reuse an existing document.
18. As a Requirement author, I want replacement of the PRD to be explicit, so that an upload cannot silently destroy work.
19. As a Requirement author, I want PRD edits to participate in the 30-second autosave cycle, so that ongoing work is not easily lost.
20. As a Requirement author, I want visible save-state feedback, so that I can tell whether the current content is pending or saved.
21. As a Requirement author, I want a horizontal anchor bar derived from PRD H1 and H2 headings, so that I can navigate long documents without a resource tree.
22. As a Requirement author, I want the anchor bar to update from the current PRD content, so that navigation never reflects only the initially loaded document.
23. As a Requirement author, I want clicking an anchor to scroll to its heading, so that I can reach the relevant section quickly.
24. As a Requirement author, I want the destination heading to be highlighted for about 1.5 seconds, so that I can immediately identify where navigation landed.
25. As a keyboard user, I want PRD anchors to be operable without a pointer, so that heading navigation is accessible.
26. As a Requirement author, I want DRAFTING to omit the old resource tree, so that document navigation is not duplicated and auxiliary files do not compete with the PRD hierarchy.
27. As a Requirement author, I want auxiliary files to appear as cards below the PRD, so that I can scan the supporting context without adopting an IDE-style file tree.
28. As a Requirement author, I want to create an auxiliary file by providing a filename and usage tag, so that new context has both a physical identity and a clear purpose.
29. As a Requirement author, I want to upload an auxiliary file and assign a usage tag, so that existing materials can join the Requirement context.
30. As a Requirement author, I want usage tags for API draft, data dictionary, research, SOP, UI sketch, and other, so that business meaning is explicit rather than inferred from a suffix.
31. As a Requirement author, I want all stored Requirement files to use Markdown, so that the workbench has one editable and linkable physical format.
32. As a Requirement author, I want the original upload format to be retained as metadata, so that I can tell whether a file originated as Markdown, DOCX, or PDF.
33. As a Requirement author, I want converted files to record whether conversion occurred, so that mock-converted content is distinguishable from native Markdown.
34. As a Requirement author, I want DOCX and PDF uploads to produce editable Markdown through a clearly identified mock conversion, so that the MVP demonstrates the intended flow without implying production conversion quality.
35. As a Requirement author, I want an auxiliary file card to expose its filename and usage, so that I can choose the right material before opening it.
36. As a Requirement author, I want clicking an auxiliary file card to open a 60%-width drawer from the right, so that I can edit the file while preserving the PRD workspace context.
37. As a Requirement author, I want the drawer to use a translucent backdrop, so that its temporary relationship to the underlying workspace is clear.
38. As a Requirement author, I want to close the auxiliary-file drawer with its close control or Escape, so that returning to the PRD is fast and predictable.
39. As a keyboard user, I want the auxiliary-file drawer to expose accessible dialog semantics and controls, so that I can understand and operate it without relying on visual placement.
40. As a Requirement author, I want to edit an auxiliary file inside the drawer, so that supporting context is a first-class part of drafting.
41. As a Requirement author, I want edits to the open auxiliary file to participate in the same 30-second autosave cycle, so that save behavior is consistent across file types.
42. As a Requirement author, I want closing and reopening an auxiliary file to preserve its latest local content, so that switching context does not discard work.
43. As a Requirement author, I want to reference auxiliary files from the PRD with standard relative Markdown links, so that relationships remain portable and readable outside the application.
44. As a Requirement author, I want clicking a relative link to an auxiliary file to open that file in the drawer, so that I can follow context without leaving DRAFTING.
45. As a Requirement author, I want auxiliary files to link to one another with the same relative Markdown syntax, so that supporting materials can form a coherent local document set.
46. As a Requirement author, I want unsupported, missing, or external links to avoid opening an incorrect local file, so that link handling is predictable.
47. As a Requirement author, I want to associate zero or more repositories with the Requirement, so that code context can be supplied when relevant without blocking early drafting.
48. As a Requirement author, I want a visible warning when no repository is selected, so that I understand ANALYZING may have less context.
49. As a Requirement author, I want the no-repository warning to remain non-blocking, so that non-code or early-stage Requirements can still proceed.
50. As a Requirement author, I want auxiliary files to remain optional, so that a simple Requirement needs only a title and PRD.
51. As a Requirement author, I want the “进入 ANALYZING” action disabled when the title is empty, so that the downstream Zone always receives required metadata.
52. As a Requirement author, I want the “进入 ANALYZING” action disabled when the PRD has no meaningful content, so that the downstream Zone always receives a primary document.
53. As a Requirement author, I want the action enabled when the title and PRD have content even if repositories and auxiliary files are absent, so that DRAFTING does not take over ANALYZING admission checks.
54. As a Requirement author, I want clicking the enabled action to navigate to this Requirement’s ANALYZING Zone, so that I can intentionally begin the next kind of work.
55. As a Requirement author, I want entering ANALYZING to avoid mutating Zone lifecycle from DRAFTING, so that navigation remains distinct from workflow state.
56. As an ANALYZING user, I want structured acceptance-criteria admission checks to occur in ANALYZING rather than DRAFTING, so that each Zone owns the correct responsibility.
57. As a returning Requirement author, I want existing title, PRD, repositories, auxiliary files, usage metadata, and local save state to repopulate the workbench, so that I can continue where I left off.
58. As a product maintainer, I want DRAFTING’s Zone registration to declare no resource tree and an enabled Inline Rail, so that the shared shell matches the product decision.
59. As a product maintainer, I want the web Zone metadata and Agent Zone registration to agree, so that different runtimes do not render contradictory equipment.
60. As a product maintainer, I want the implementation to preserve the established visual tokens and information density, so that the redesign feels native to the Requirement workbench.
61. As a product maintainer, I want the final DRAFTING HTML prototype to remain the visual acceptance baseline, so that layout and interaction details do not drift during implementation.
62. As a product maintainer, I want the superseded resource-tree and structured-AC behaviors removed rather than hidden behind dead branches, so that future maintenance follows one product model.

## Implementation Decisions

- DRAFTING is a Requirement Zone and a material-preparation workbench. It is not a Requirement creation entry point, a status-driven workflow step, or an ANALYZING admission engine.
- The workbench composition is PRD-first: an upper PRD pane, a lower auxiliary-file card pane, a draggable divider, and a sticky bottom repository/action bar. The initial PRD allocation is capped at approximately 60% while retaining at least one visible row of auxiliary cards.
- The final approved visual combination is “PRD 顶置 + 无资源树的 PRD 锚点条 + 右侧 60% 辅助文件抽屉”. The final HTML prototype is the visual source of truth for implementation and review.
- DRAFTING removes the shared Resource Tree and keeps the Skill Inline Rail. Both Agent-side Zone registration and the web metadata mirror must declare `has_resource_tree: false` and `has_inline_rail: true`.
- The shared Zone shell continues to own ZoneBar, StatusBar, breadcrumbs, main-area equipment, and explicit cross-Zone navigation. No DRAFTING behavior may infer or redirect from Requirement status.
- The DRAFTING domain model becomes file-oriented rather than form-oriented. It contains exactly one PRD file plus zero or more auxiliary files, alongside title, repository selection, skills/actions, and save-state data.
- The PRD invariant is enforced at the domain boundary: every Requirement has exactly one PRD and that PRD cannot be deleted. Empty Requirements receive a deterministic skeleton using the Requirement title and the sections 背景、目标、验收标准、非目标.
- Requirement title remains independent metadata rather than being derived from the first Markdown heading. Editing either value does not silently rewrite the other.
- PRD upload accepts Markdown and explicitly replaces the current PRD after user intent is confirmed. It does not create a second PRD.
- Auxiliary files have a stable identity, `filename`, Markdown content, `usage_tag`, `source_format`, and `converted_to_md`. Their logical type is AUX; business purpose is represented by `usage_tag`, not inferred from the filename extension.
- Supported usage tags are API 草案、数据字典、调研、SOP、UI 草图、其他. The UI may render localized labels while preserving stable internal values.
- All Requirement files are represented and edited as Markdown. Native Markdown uploads record `source_format: md` and no conversion; DOCX/PDF uploads record the original format and are mock-converted to Markdown with `converted_to_md: true`.
- Real document conversion is behind an adapter boundary. This issue supplies deterministic mock conversion behavior and must not imply that production-quality parsing exists.
- The auxiliary-file collection is flat for this scope. The UI is optimized for a small collection, with an MVP assumption of no more than roughly ten files; no nested directory model is introduced.
- Selecting an auxiliary card opens a right-side drawer occupying 60% of the workbench width. The drawer preserves the underlying PRD context, provides a translucent backdrop, exposes dialog semantics, and closes through an explicit control or Escape.
- The PRD and auxiliary editor states share one save lifecycle. A 30-second autosave cycle persists or mock-persists all dirty Drafting content and updates observable save-state feedback. Manual save behavior may reuse the same adapter if retained.
- Persistence remains behind a Drafting data/save adapter because the current Requirement API does not yet implement real storage. UI completion must not be represented as real `meta.yaml` or Markdown persistence unless that adapter is actually wired.
- The PRD anchor bar is derived live from the current Markdown, includes H1 and H2 headings, and is rendered inside the PRD editing area rather than in Resource Tree. Anchor activation scrolls to the matching heading and applies an approximately 1.5-second transient highlight.
- Standard relative Markdown links are the only intra-Requirement file-reference syntax. A resolver maps valid relative links to known auxiliary files and opens the target in the drawer; external URLs, fragments without a file target, unsupported paths, and missing files do not open an unrelated drawer item.
- Repository selection supports zero or more repositories. Zero repositories produces a visible soft warning but is never a Launch validation error.
- Structured acceptance-criteria checklist editing is removed from DRAFTING. Markdown content may still include an 验收标准 section, but completeness and structured admission analysis belong to ANALYZING.
- Launch validity is exactly: trimmed title is non-empty and PRD Markdown has meaningful non-whitespace content. Repositories and auxiliary files are optional.
- The primary action is labeled “进入 ANALYZING”. Activating it performs explicit user navigation to the current Requirement’s ANALYZING Zone; it does not launch a real Agent, mutate lifecycle status, or auto-advance on save.
- Existing outline parsing, repository selection, autosave scheduling, router navigation, and shared shell capabilities should be reused where they still match the new behavior. Superseded form-only and resource-tree paths should be removed rather than retained as parallel implementations.
- Platform/domain documentation and Zone equipment decisions must be reconciled in the same change so that ADR-level guidance, Agent registration, and web metadata no longer disagree about whether DRAFTING has a Resource Tree. The redesign does not alter the broader principles of independent Zone URLs, arbitrary user navigation, or passive AI.
- Visual implementation preserves the established dark theme, spacing scale, density, typography, and workbench shell. This issue does not introduce a new design system.

## Testing Decisions

- The confirmed primary testing seam is the complete DRAFTING workbench component. Tests render it with representative Drafting data, drive it through user-visible controls, and assert observable UI, save-adapter, and navigation behavior. The router and currently unimplemented persistence/upload/conversion adapters may be mocked at their boundaries; internal component state and implementation details must not be asserted directly.
- A good test describes behavior a Requirement author can observe: visible content and warnings, enabled/disabled actions, focusable controls, drawer/dialog state, navigation calls, save-adapter calls, and time-based save feedback. CSS class names, component decomposition, hook calls, and private state are not behavioral contracts unless they are already an explicit shared-shell contract.
- The principal workbench suite covers the complete happy path: initial PRD skeleton, title/PRD editing, live anchors, anchor navigation and transient highlight, auxiliary-file creation/upload, drawer editing and close behavior, relative-link navigation, repository soft warning, autosave, and explicit navigation to ANALYZING.
- The same suite covers validation and recovery paths: blank title, whitespace-only PRD, optional repositories and auxiliary files, unsupported or missing relative links, reopening an edited auxiliary file, Escape dismissal, and uploads that report mock conversion metadata.
- Fake timers are used only at the external time seam to verify the 30-second autosave interval and approximately 1.5-second anchor highlight. Tests should advance timers and assert visible state or adapter calls rather than inspect timer implementation.
- A small shared-shell contract suite verifies that DRAFTING renders without Resource Tree, retains the Inline Rail, and uses the shell layout associated with those equipment flags. This is a supporting contract, not a second end-to-end feature seam.
- Pure domain tests are limited to behavior that is clearer below the component seam: PRD skeleton generation, the single-PRD invariant, H1/H2 extraction, Launch validity, upload-format metadata, and safe relative-link resolution. They must test inputs and outputs, not duplicate component internals.
- Existing Drafting Zone tests provide prior art for Testing Library, `userEvent`, navigation mocking, fake timers, repository selection, and save-state assertions. Existing ZoneShell tests provide prior art for equipment contracts. Existing ANALYZING dialog/edit tests provide prior art for accessible overlay interaction and Escape dismissal.
- Existing tests that encode superseded behavior—DRAFTING Resource Tree, structured AC checklist editing, the old centered form, or “创建并启动 AI 分析”—must be updated or removed as part of the same change. Tests for platform-wide arbitrary Zone navigation remain valid.
- Browser E2E, live Requirement API contract tests, and true filesystem persistence are not required for this issue because the current Requirement API is still a stub. They must not be simulated in a way that falsely claims end-to-end persistence.
- Completion verification includes the relevant web test suites, the full repository test command, TypeScript no-emit checking, and Markdown/code formatting checks. A production build is not required for this spec-only publication and must not run concurrently with a development server.

## Out of Scope

- Real Requirement persistence to `meta.yaml`, `prd.md`, or auxiliary Markdown files when the Requirement API remains unimplemented.
- Real Agent execution, analysis-session creation, or Skill invocation from the DRAFTING primary action.
- Status-driven Zone transitions, automatic progression, or lifecycle-order changes.
- Production-quality DOCX/PDF conversion, including Pandoc, Apache Tika, OCR, layout reconstruction, and conversion-quality review.
- File history, snapshots, diff UI, undo across saved versions, or version restoration.
- Full-text search, command-palette file switching, or Cmd+P behavior.
- Nested directories, arbitrary repository-style trees, file drag-and-drop reordering, or IDE-style file management.
- Treating PRD and auxiliary files as visually equal peers.
- A left Resource Tree containing only PRD outline, a unified PRD/file tree, or any other rejected tree variant.
- Modal or full-screen auxiliary-file editing in place of the approved right-side drawer.
- A separate PRD preview/outline panel beyond the approved live anchor bar.
- Structured acceptance-criteria authoring or admission scoring in DRAFTING.
- Making repository selection or auxiliary-file presence a hard Launch requirement.
- Inferring auxiliary-file purpose from file extension or filename.
- Wiki-link syntax or a second intra-Requirement linking format.
- Preserving DOCX/PDF as the editable stored format.
- Multi-user collaborative editing, comments, presence, or multi-cursor support.
- Broad mobile or narrow-screen redesign beyond preventing obvious breakage in the existing shell.
- Changes to the global theme, information-density tokens, Zone lifecycle order, or which Zones retain Inline Rail.

## Further Notes

- This issue supersedes the previous DRAFTING UI behavior while preserving the platform decisions that a Zone is independently addressable, users can jump freely, and AI remains passive until explicitly invoked.
- The DRAFTING workbench decisions document is the product/interaction decision record for this issue, and the final DRAFTING HTML prototype is the visual source of truth. Earlier alternatives are retained only as decision history and must not be blended into the implementation.
- Existing ADR language that lists DRAFTING as having a Resource Tree is stale relative to the approved redesign. The implementation should update the relevant domain/architecture documentation rather than silently leaving contradictory sources of truth.
- “进入 ANALYZING” means explicit navigation initiated by the user. It does not contradict the prohibition on status- or AI-driven automatic advancement.
- The small-file-count assumption is an MVP constraint, not a permanent domain limit. The data model should avoid unnecessary hard caps even though the approved card UI is designed around roughly ten auxiliary files.
