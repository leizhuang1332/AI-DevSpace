# 04 — SkillLoader 双 root union + SystemPromptAssembler 装配链改造

**What to build:** `SystemPromptAssembler.deps` 由 `skillsRoot: string` 改为 `skillsRoots: string[]`;`loadAll` 对每个 root 各扫一次,做 **union by name,user-wins**(home 路径下的同名 Skill 优先)。让 ticket 02 的 `built-in` 在 dev 环境与 `~/.aidevspace/skills/` 用户 home 自定义 Skill **同装配链**工作。`SkillLoader` 公共 API(`loadAll(rootDir)` / `findByName(rootDir, name)`)不动,变更收敛在 `SystemPromptAssembler` 一层。

**Blocked by:** 01(handler 路径已就),02(已落 built-in Skill 实际内容,用于验证合并行为)

**Status:** ready-for-agent

- [ ] `SystemPromptAssembler` 的 `deps` 由 `skillsRoot: string` → `skillsRoots: string[]`
- [ ] `assembleBase` / `assembleDynamic` 都做 `Promise.all(skillsRoots.map(skillLoader.loadAll))` 然后 union by name,user-wins
- [ ] SkillLoader 公共 API(`loadAll(rootDir)` / `findByName(rootDir, name)`)不变
- [ ] empty home 情形验证:仅 `apps/agent/skills/built-in` 一个 root 时,装入行为与旧版一致
- [ ] SkillLoader 已有单测全过
- [ ] `SystemPromptAssembler` 单测新增 `union by name user-wins` 用例:built-in 与 home 各放一个同名 Skill,home 的优先;不同名 Skill 都保留
- [ ] `pnpm typecheck` 与 `pnpm test` 通过

**ADR ref:** ADR-0020 ticket 01 / D5 / D6

**Notes / non-goals:**
- 这是 wide refactor 例外(`/to-tickets` skill 的 expand-contract 原则适用);SkillLoader API 不动,变更收敛在 Assembler 一层
- `recommended_user_override` 字段消费在下个 PR(ADR-0020 D12)
- bootstrap 注入路径:Agent 启动时从 `~/.aidevspace/skills`(若存在)与 `apps/agent/skills/built-in/` 两个目录拼装 `skillsRoots` 数组
