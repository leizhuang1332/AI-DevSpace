---
Status: ready-for-agent
Type: task
Related-PRD: ../PRD.md
Blocked-by: []
---

# 01 · `DEFAULT_CONFIG_PATH` 改成 lazy `getDefaultConfigPath()`

## Goal

把 `apps/web/src/lib/requirements-root.server.ts` 第 58 行的 module-top 常量 `DEFAULT_CONFIG_PATH = join(homedir(), '.aidevspace', 'config.yaml')` 改为 lazy 函数 `getDefaultConfigPath()`,新增 `AIDEVSPACE_CONFIG_PATH` env 短路,确保 `next build` 期间 `@vercel/nft` 看不到 module-top 的 `os.homedir()` 调用。

## Acceptance

1. `apps/web/src/lib/requirements-root.server.ts`:
   - 旧 `export const DEFAULT_CONFIG_PATH = ...` 行被删除
   - 新增 `export function getDefaultConfigPath(): string` 函数,逻辑按 PRD D-1.1 实现
   - `resolveRequirementsRoot()` 内 `options.configPath ?? DEFAULT_CONFIG_PATH` 改为 `options.configPath ?? getDefaultConfigPath()`
   - module-top **不再**有 `homedir()` 调用(`expandHome` 函数体内的 `homedir()` 调用不算)
2. `apps/web/src/__tests__/requirements-root.server.test.ts`:
   - `beforeEach` 增加 `delete process.env.AIDEVSPACE_CONFIG_PATH`
   - header 注释里的"默认 configPath = ~/.aidevspace/config.yaml"描述更新为"默认来自 `getDefaultConfigPath()`"
3. 新增 `apps/web/src/__tests__/requirements-root-config-path.test.ts`,覆盖 PRD T-2.1 到 T-2.6 全部 6 个 case
4. 跑 `pnpm --filter @ai-devspace/web typecheck` 退出码 0
5. 跑 `pnpm --filter @ai-devspace/web test` 全绿,既有 `requirements-root.server.test.ts` 不掉用例

## Out of Scope

- build script 改动 —— 在 issue 02 处理
- `expandHome` 函数本体改动
- `resolveRequirementsRoot` fallback 链顺序改动

## Notes

- 函数返回值类型显式 `: string`,避免 TS 推断成 `string | undefined`
- env 短路条件:存在且 `.length > 0`(空串、全空白都走 fallback)
- T-2.2 用 `vi.spyOn(os, 'homedir').mockImplementation(() => { throw new Error('homedir should not be called when env is set') })` 验证 env 短路真生效

## 验证命令

```bash
pnpm --filter @ai-devspace/web typecheck
pnpm --filter @ai-devspace/web test src/__tests__/requirements-root-config-path.test.ts
pnpm --filter @ai-devspace/web test src/__tests__/requirements-root.server.test.ts
```
