# 01 — Pack framework foundation (types + loader + interpreter + baselineGenerator)

**What to build:** The runtime infrastructure that lets the platform load admission packs from disk. Three-layer model: Admission Unit (single evaluation lens), Admission Algorithm (verdict rules), Admission Pack (user-facing bundle of units + algorithm + UI hints). A new admission module owns: YAML parsing for manifest / unit / algorithm files, a jq-simplified expression interpreter, algorithm syntax validator, and a baseline-5dim auto-generator on first workspace touch. V-3 validation: structure errors (YAML parse fail, missing fields, id mismatch, outputMarker collision) fail-fast; semantic errors (algorithm expression syntax, rule id collision) degrade to warning + skip the bad rule + still let the session run. New shared types land in `packages/shared/src/admission.ts`. **Nothing wires the loader into any caller yet** — this ticket only makes the infra exist and testable in isolation.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] `packages/shared/src/admission.ts` exports `Verdict` (`'✅' | '⚠️' | '❌'`), `UnitJudgment`, `PackVerdict`, `AdmissionUnit`, `AdmissionAlgorithm`, `AdmissionPack`, `AdmissionPackManifest` types per ADR-0021
- [ ] A new `apps/agent/src/admission/` module exists with `packLoader.ts`, `algorithmInterpreter.ts`, `algorithmValidator.ts`, `baselineGenerator.ts`
- [ ] `packLoader` reads a pack from `~/.aidevspace/admission/packs/<id>/{manifest.yaml, units/<id>.yaml, algorithm.yaml}`; structure errors throw, semantic errors log warning + return best-effort Pack
- [ ] `algorithmInterpreter` supports the 10 grammar elements (`.field` / `==` / `!=` / `and|or|not` / `any|all(A; pred)` / `[A | select(pred)]` / `length|count` / `true|false`) with `else`-branch handling
- [ ] `baselineGenerator` auto-creates `baseline-5dim` pack on first call if missing (5 units: `loss_prevention 🔴` / `performance 🟠` / `arch_conflict 🟡` / `business_reasonable 🟢` / `context_query 💬`, algorithm = baseline-loose), idempotent
- [ ] Existing 5-dimension shared types (`AdmissionDimensionIdSchema` / `DEFAULT_ADMISSION_DIMENSIONS` / `AdmissionDimensionMeta` / `ADMISSION_DIMENSION_META`) and web `AdmissionVerdict` remain unchanged (parallel infra)
- [ ] `apps/agent/src/admission/` tests pass: packLoader V-3 (structure fail-fast + semantic degrade), algorithmInterpreter (10 grammar elements + hit/else), baselineGenerator (idempotent first-call)
- [ ] `admission-check/SKILL.md` and its dependents untouched
- [ ] No public API surface change — this ticket does not add HTTP endpoints or UI