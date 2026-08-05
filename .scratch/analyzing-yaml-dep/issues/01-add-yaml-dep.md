---
Status: ready-for-agent
Type: task
Related-PRD: ~
Blocked-by: []
---

# 01 · `analyzing.server.ts:31` 加 `yaml` 依赖

## Goal

让 `apps/web/src/lib/analyzing.server.ts:31` 的 `import yaml from 'yaml'` 在 `pnpm typecheck` / `pnpm build` 时不再报 `Cannot find module 'yaml'`,build 流程从"✓ Compiled successfully"走到产出 `.next/BUILD_ID`。

## 为什么是这个 fix

`yaml` 包(`eemeli/yaml`,v2.9.0)在 monorepo 里是事实标准:
- `apps/agent/` 8 个文件 import 它(`ZoneRegistry.ts`、`WorkspaceService.ts`、`RequirementService.ts`、`AnalysisSkillService.ts`、`SkillLoader.ts`、`AnalysisRunService.ts`、测试若干)
- `apps/web/src/lib/analyzing.server.ts:31` 是 web 侧**唯一**一处引用

`yaml` 已经被 `apps/agent` 拉进 node_modules(pnpm hoisted),所以 web 包不需要重装,只需要在 `apps/web/package.json` 的 `dependencies` 声明,pnpm 会建立链接让 web 包也能用。

**不走 js-yaml**:虽然 js-yaml 也是常用库,但会破坏 monorepo 的一致性 —— 所有其它地方都用 `yaml`(eemeli),切 js-yaml 等于引入第二套 yaml 解析语义,后续维护成本高。

## Acceptance

1. `apps/web/package.json` 的 `dependencies` 加一行 `"yaml": "^2.9.0"`(与 `apps/agent/package.json` 对齐)
2. `pnpm-lock.yaml` 同步更新(声明完 yaml 后跑一次 `pnpm install` 让 lockfile 落定)
3. `pnpm --filter @ai-devspace/web typecheck` 退出码 0,`analyzing.server.ts:31` 的 `Cannot find module 'yaml'` 消失
4. `pnpm --filter @ai-devspace/web build` 退出码 0,`.next/BUILD_ID` 存在
5. `pnpm --filter @ai-devspace/web test` 全绿(0 测试 fail —— 之前是 `analyzing-designing-fs-loader.test.ts` collection 失败,加完 dep 后该 file 应能加载)

## 验证命令

```bash
# 1. 装依赖(sync lockfile)
pnpm install

# 2. typecheck
pnpm --filter @ai-devspace/web typecheck

# 3. build acceptance smoke
cd apps/web
rm -rf .next
pnpm build
echo "exit=$?"
ls .next/BUILD_ID

# 4. test 全绿
pnpm --filter @ai-devspace/web test
```

## Out of Scope

- 改用 `js-yaml` —— 与 monorepo 现有 `yaml` 引用冲突,见 Goal
- 重构 `analyzing.server.ts` 的 yaml 调用方式 —— 当前 `import yaml from 'yaml'` 已经是对齐项目的写法,不动
- 修 `analyzing-designing-fs-loader.test.ts` 里的测试 case —— 该 file 因为 yaml 错 collection 失败,加 dep 后会自动恢复;不需要改测试代码

## Notes

- `yaml@2.9.0` 已经在 monorepo node_modules 里(`apps/agent` 引入),pnpm 会用 symlink 让 web 包共享,实际不下载新包
- 选 `^2.9.0` 是因为 `apps/agent/package.json` 已经锁这个 caret range,锁定同一 minor 保证行为一致
- 这个 fix 跟 ticket `next-build-homedir-fix` 是独立的两个问题。homedir fix 让 build 走到 `✓ Compiled successfully`(webpack 编译通过),yaml dep 是 webpack 之后、typecheck 阶段的下一道关。两者顺序执行,缺一 build 都不能完成

## 关联

- 上游:本 ticket 是 `next-build-homedir-fix` 的下游依赖 —— 没 homedir fix build 走不到 yaml dep 这一步
- 关联 ADR:无(纯依赖治理,不影响产品决策)
