# 02 — 4 个 `built-in` SKILL.md 实写 / 骨架

**What to build:** 在 git 落 4 份 `apps/agent/skills/built-in/<name>/SKILL.md`,前两份有完整 prompt 正文,后两份为占位骨架(frontmatter + 占位正文 + `recommended_user_override` 字段视适用)。让 ticket 01 的 handler turn-1 / turn-2 真正能从 SkillLoader 读出 prompt 文本。

**Blocked by:** 01(`start` handler 已确定读取哪些 Skill)

**Status:** ready-for-agent

- [ ] `admission-check/SKILL.md`:frontmatter 含 `name / description / arming: always`;body 给出按 ADR-0013 D4 五维度产物的 prompt(引导 SDK 输出 5 个 admission dimension card + 总体 verdict + 待裁决计数)
- [ ] `requirement-brainstorm/SKILL.md`:frontmatter 含 `name / description / arming: always / recommended_user_override: true`;body 给出按 ADR-0013 D5 三桶 prompt(输出 `subproblem / risk / option` 三类 chunk,带 `source_refs`)
- [ ] `tech-brief-scaffold/SKILL.md`:frontmatter 含 `name / description / arming: on-arming`;body 仅占位 `⚠️ 占位:prompt 待下个 PR 填充`
- [ ] `requirement-critique/SKILL.md`:frontmatter 含 `name / description / arming: on-arming / recommended_user_override: true`;body 仅占位
- [ ] 4 个 SKILL.md 通过 SkillLoader 的 `findByName(rootDir, name)` 单元测试(应当返回 Skill,且 `frontmatter.name` 与目录名一致)
- [ ] turn-1 在该 Skill 装入后能引导 SDK 输出 5 维度 admission chunks(provider stub 仿真验证即可,不依赖真 API)
- [ ] `pnpm typecheck` 与 `pnpm test` 通过

**ADR ref:** ADR-0020 ticket 04 / D7

**Notes / non-goals:**
- SkillLoader 多根装载由 ticket 04;本 ticket 假设只走单根 `apps/agent/skills/built-in`
- `analyzing.yaml` 的 `default_arming` 不动(handler 内硬过滤)
- `recommended_user_override` 字段消费在下个 PR(ADR-0020 D12)
