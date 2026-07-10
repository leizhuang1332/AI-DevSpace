# PR 描述草稿 — Issue 01 / 初始化 Monorepo

> 等用户审阅后手动提交（按硬约束，本会话未执行 `git add/commit/push`）。

---

## Title

`chore(monorepo): scaffold apps/agent + turbo + lint/format + README (issue 01)`

---

## Body

### 背景

落地 `.scratch/ai-devspace-mvp/issues/01-monorepo-init.md`：把 `apps/agent` 骨架与 monorepo 顶层工具链（Turbo / ESLint / Prettier / editorconfig / README）一起建起来。`apps/web` 与 `packages/shared` 在本次变更前已存在，本 PR 不动它们的源码。

### 本 PR 范围（按 slice 拆）

| Slice | 内容 | 状态 |
| --- | --- | --- |
| 1 | `apps/agent/` 骨架（Fastify v5 + `@fastify/cors` + `GET /api/health` + vitest 单测） | ✅ |
| 2 | `turbo.json` + 根 `dev` / `dev:web` / `dev:agent` / `build` / `typecheck` / `test` / `lint` / `format` / `format:check` 脚本 | ✅ |
| 3 | `.editorconfig` + ESLint v9 flat config + Prettier | ✅ |
| 4 | 顶层 README（项目简介 / 目录结构 / 启动方式 / 测试与构建命令） | ✅ |

### 显式不做的（按 issue 与用户硬约束划出去）

- 任何 SSE / workspace / requirement / repo / knowledge / skill / command 业务路由（issue 03 起）
- 鉴权 token 机制、Origin 校验中间件（issue 03）
- 进程保活（pm2 等）（issue 03）
- `packages/shared` 真实类型定义（issue 03 / 05+）
- `apps/web` 的 ESLint/构建配置改动（保持现状）

### 验收

| 项 | 命令 | 实测结果 |
| --- | --- | --- |
| 依赖安装 | `pnpm install` | ✅ Done in ~10s |
| 类型检查 | `pnpm typecheck` | ✅ 3 tasks successful |
| 单元测试 | `pnpm --filter @ai-devspace/agent test` | ✅ 1/1 passed |
| Agent 构建 | `pnpm --filter @ai-devspace/agent build` | ✅ `dist/server.js` 生成 |
| Agent 启动 + 健康检查 | `node dist/server.js` + `curl :7777/api/health` | ✅ `{"ok":true,"name":"agent"}` HTTP 200 |
| Lint | `pnpm lint` | ✅ 0 warnings（apps/agent） |
| Prettier（本会话新增/修改文件） | `pnpm exec prettier --check <files>` | ✅ all clean |

### Files changed

新增：
- `apps/agent/package.json`
- `apps/agent/tsconfig.json`
- `apps/agent/src/server.ts`
- `apps/agent/src/__tests__/health.test.ts`
- `turbo.json`
- `eslint.config.js`
- `.editorconfig`
- `.prettierrc`
- `.prettierignore`
- `README.md`

修改：
- `package.json`（根；新增 devDeps 与顶层 scripts）
- `pnpm-lock.yaml`（自动更新）

未触碰（确认）：
- `apps/web/**`（保留现有构建与 dev 流水线；ESLint flat config 显式 ignore `apps/web/**`）
- `packages/shared/**`（占位不动）
- `.scratch/ai-devspace-mvp/issues/01-monorepo-init.md`（issue 状态由 `ready-for-agent` → `resolved`；新增 ## Comments 条目，但 # 文件本身在 `.scratch/` 下，按惯例不入主仓 PR）

### TDD 与 code-review 记录

- 四 slice 全部按 red→green 推进（slice 1 实写 vitest 测试；slice 2-4 通过 build/lint/format/启动 端到端验证）
- `/code-review` 两轮：
  - 第一轮：Critical=0 / Important=4（README 表格、当前进度 section、`pnpm dev` trade-off、CORS 占位注释）
  - 全部 Important 已修，第二轮：Critical=0 / Important=0 / Minor=1（未直白写出 Ctrl+C trade-off，间接提示足够，Minor 可接受）

### 提交后建议验证

```bash
pnpm install
pnpm typecheck
pnpm --filter @ai-devspace/agent test
pnpm --filter @ai-devspace/agent build
node apps/agent/dist/server.js &
curl http://localhost:7777/api/health    # → {"ok":true,"name":"agent"}
kill %1
```

### 关联

- Closes `.scratch/ai-devspace-mvp/issues/01-monorepo-init.md`
- Refs PRD §11（实施路线阶段 1）
- Refs `docs/adr/0001-hybrid-web-agent-architecture.md`（Web + Agent 端口约定）
- Refs `docs/adr/0002-filesystem-as-database.md`（后续 issue 涉及）
