# 02 — SystemPromptAssembler 接 admission loader + 分段标号 prompt 渲染

**What to build:** The admission prompt the model sees in turn-1 is now driven by the loaded admission pack instead of the admission-check Skill body. The assembler reads pack units and renders them as `### N. <id> (<displayName> · <severityIcon>)` segments with an `output_marker: '[DIM <id>]'` line per unit. The dual-turn assembler helper no longer appends the admission-check Skill body to the base prompt. After this ticket: same end-user behavior (5 cards rendered, model still outputs `[DIM]` + `[VERDICT]` blocks per old contract), but the prompt content source has switched.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `SystemPromptAssembler.assembleBase` (or equivalent entry) renders admission pack units as `### N. <id> (<displayName> · <severityIcon>)` segments when an `admissionLoader` deps field is provided
- [ ] Each segment ends with `output_marker: '[DIM <id>]'` so the model knows what marker to emit
- [ ] `AssemblerDeps` interface gains an optional `admissionLoader` field
- [ ] The dual-turn assembler helper (currently in the analysis route file) no longer appends the admission-check Skill body to the base prompt — admission content comes only from the pack
- [ ] When no pack is supplied / pack load fails, the admission section is omitted (no Skill body fallback) and turn-1 prompt still flows
- [ ] Existing `admission-check/SKILL.md` is still on disk and loadable by SkillLoader (not deleted this ticket)
- [ ] Existing `SystemPromptAssembler` tests still pass; new test cases cover pack-driven prompt rendering and verify the Skill body is NOT in the rendered prompt when a pack is supplied
- [ ] `built-in-skills.test.ts` admission-check body contract test still passes (Skill body unchanged on disk)