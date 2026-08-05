---
Status: ready-for-agent
Type: task
Related-PRD: ../PRD.md
Blocked-by: [01]
---

# 02 · build script 注入 `AIDEVSPACE_CONFIG_PATH` via `cross-env`

## Goal

把 `apps/web/package.json` 的 `scripts.build` 改成通过 `cross-env` 注入 `AIDEVSPACE_CONFIG_PATH`,让 `pnpm build` 在任何平台上都用稳定路径作为 NFT 静态分析可见的 default config path,完全脱离 `os.homedir()`。

## Acceptance

1. `apps/web/package.json`:
   - `scripts.build` 从 `"next build"` 改为 `"cross-env AIDEVSPACE_CONFIG_PATH=$INIT_CWD/.aidevspace/config.yaml next build"`
   - 不改 `dev` / `start` / `typecheck` / `test`
2. 新增 `cross-env` 到 `apps/web/devDependencies`(若项目还没有)
3. `pnpm-lock.yaml` 已同步更新
4. acceptance smoke:跑 `pnpm --filter @ai-devspace/web build`:
   - 退出码 0
   - `.next/BUILD_ID` 文件存在
   - 错误流无 `glob error` / `EPERM` / `EACCES`
5. 反向 sanity(可选):临时 `unset AIDEVSPACE_CONFIG_PATH` 后跑 `pnpm build` 应当仍能成功(因为 issue 01 的 env 短路失效后 fallback 到 `homedir()`,NFT 重新 glob 家目录;这步只为证明修复前后行为差异,合入时**不**需要)

## Out of Scope

- 改 `expandHome` 函数
- 改 `resolveRequirementsRoot` 函数
- 改 next.config.mjs
- 引入 platform-specific build scripts(`build:win` / `build:unix`)替代 cross-env

## Notes

- `$INIT_CWD` 是 pnpm 在 monorepo 跑 script 时注入的环境变量,等于 workspace 根(本项目 = `D:\TraeProject\AI-DevSpace`)。用 `$INIT_CWD` 而非 `process.cwd()` 的原因:`process.cwd()` 在 `pnpm --filter X build` 跑时是子包目录(`apps/web/`),不是仓库根
- 注入的路径 `<workspace-root>/.aidevspace/config.yaml` 在首次 build 时通常不存在 → `resolveRequirementsRoot` 第 1 层静默降级 → fallback 到 `AIDEVSPACE_HOME` / `cwd + ../..`,行为与修复前等价
- `cross-env` 已极小,零运行时依赖;若团队偏好零新增依赖,可用 `build:win` + `build:unix` 双 script 替代(但本 spec **不**采用此方案,见 PRD O-6)
- Acceptance 步骤 4 跑完不要在仓库里 commit `.next/` 目录(`.gitignore` 已排除,但确认一下)

## 验证命令

```bash
# 装新依赖
pnpm install

# 1. typecheck + test 必须仍绿
pnpm --filter @ai-devspace/web typecheck
pnpm --filter @ai-devspace/web test

# 2. 真实跑 build,验证 acceptance #4
cd apps/web
rm -rf .next
pnpm build
echo "exit=$?"
ls .next/BUILD_ID 2>&1 | head -1

# 3. 检查错误流无 glob / EPERM / EACCES
pnpm build 2>&1 | grep -E "glob error|EPERM|EACCES" | head -5
# 期望:无输出
```
