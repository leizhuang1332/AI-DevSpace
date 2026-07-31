# 07 — baseline-pack-equivalence.test.ts (5 样本) + 删除 admission-check/SKILL.md

**What to build:** A regression-safety equivalence test proves the new baseline-5dim pack produces equivalent per-dimension judgments and equivalent overall verdicts as the original admission-check Skill, across 5 representative PRD samples. Once the test passes in CI for a full run cycle, the original admission-check Skill file is deleted and its test references are migrated to "pack-driven" assertions. The admission-check Skill is fully retired.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] New `baseline-pack-equivalence.test.ts` runs BOTH the OLD path (load admission-check Skill body, feed to model, capture `[DIM]` + `[VERDICT]`) AND the NEW path (load baseline-5dim pack, feed pack-driven prompt to model, capture `[DIM]` + service-computed verdict) on 5 representative PRD fixtures
- [ ] For each PRD: per-dimension judgment (pass / warn / fail) is identical between OLD and NEW
- [ ] For each PRD: overall verdict (✅ / ⚠️ / ❌) and reason are identical between OLD and NEW
- [ ] Test passes in CI; tracked under `apps/agent/src/admission/__tests__/` (or equivalent)
- [ ] `apps/agent/skills/built-in/admission-check/SKILL.md` is deleted
- [ ] `built-in-skills.test.ts` 5-dimension body contract assertion is removed (or rewritten to assert "Skill no longer authoritative; baseline-5dim pack is")
- [ ] SkillLoader no longer auto-loads the admission-check skill for admission purposes (any code that names it by id for admission is removed)
- [ ] Final smoke: `pnpm test` is clean; a fresh session can still be started with `pack_id: 'baseline-5dim'` and produces the expected per-dimension + overall verdict