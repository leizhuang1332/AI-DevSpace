## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical states, recorded as a `Status:` line in each issue's frontmatter (`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## git 操作特批

此项目允许执行以下git操作：
- `git add`
- `git commit`
- `git push`

## Next.js dev ↔ build 隔离

`next dev` 和 `next build` **共用 `apps/web/.next/` 目录**，且 `build` 会覆盖 dev 的运行时缓存（HMR manifest、CSS URL version 戳等）。

**规则**：

- dev server 在跑时，**不要**再跑 `next build` —— 会让 dev 服 CSS / 路由 404
- 需要验证 build 通过时，先 `taskkill //F //IM node.exe`（或单杀 next 进程）→ `rm -rf apps/web/.next` → `pnpm build` → 跑完再 `pnpm dev`
- 简单替代：用 `tsc --noEmit`（typecheck）+ `pnpm test` 验证代码正确性，build 只在提 PR 前跑一次
- 真要 build 而 dev 在跑，加 `NEXT_TELEMETRY_DISABLED=1 NEXT_BUILD_DIR=.next-build pnpm build` 隔离（Next 14 暂不支持 env 改 build dir，仅 pin 习惯 — 当前需手动切）
