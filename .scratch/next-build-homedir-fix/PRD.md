---
Status: ready-for-agent
Type: spec
Related-ADRs: [ADR-0002]
---

# `pnpm build` 在 Windows 上因 NFT glob 家目录失败 — 把 `homedir()` 依赖延后到运行时 + env 注入 build script

**What to build:** 把 `apps/web/src/lib/requirements-root.server.ts` 里 module-top 的 `DEFAULT_CONFIG_PATH = join(homedir(), '.aidevspace', 'config.yaml')` 常量改成 lazy 函数 `getDefaultConfigPath()`,新增 `AIDEVSPACE_CONFIG_PATH` env 作为第一优先覆盖项;同时把 `apps/web/package.json` 的 build script 改成默认通过 `cross-env` 注入该 env,让 `next build` 走稳定路径,避开 `@vercel/nft` 在 module-top 触发 `os.homedir()` 而 glob 整个 `C:\Users\Lorcan` 的失败链路。

## Problem Statement

开发者在本机跑 `pnpm build` 构建 `apps/web` 时,Next.js 14.2.35 + `@vercel/nft` 静态分析 server-side route handler 的 import 链,碰到 `apps/web/src/lib/requirements-root.server.ts:58` 的 module-top 调用:

```ts
export const DEFAULT_CONFIG_PATH = join(homedir(), '.aidevspace', 'config.yaml')
```

NFT 把 `os.homedir()` 解析为 `C:\Users\Lorcan`,然后对整个家目录发起 glob pre-scan:

```
Glob('C:\Users\Lorcan/**/*', { mark:true, dot:true, ignore:'C:\Users\Lorcan/**/node_modules/**/*', strict:true })
```

`strict: true` 下,glob 一旦撞到不可访问条目就 abort。Windows 上家目录里有两个必撞的坑:

| 路径 | 结果 |
|---|---|
| `C:\Users\Lorcan\My Documents` | Win10/11 不存在(XP 遗留路径),EPERM |
| `C:\Users\Lorcan\AppData\Local\Temp\jb.station.ij.*.sock` | JetBrains IDE 的 Unix socket(不是目录),EACCES |

两个都会让 glob abort,build 报:

```
glob error [Error: EACCES: permission denied, scandir '...\jb.station.ij.14536.sock']
Failed to compile.
Build failed because of webpack errors
```

**根因**:server-only 模块在 module 顶层就 evaluate `os.homedir()`,把"运行时才知道的路径"硬编码到了 NFT 的静态分析窗口。

**影响面**:

- Windows + dev/prod 构建一律失败,`pnpm dev` 不受影响(dev 不跑 NFT)
- 临时缓解(杀 node.exe + 删 `.next/` + 重 build)在第一次撞 `My Documents`,第二次撞 JetBrains socket,**无法稳定复现绿色 build**
- 影响所有在 `apps/web/src/lib/analyzing.server.ts`、`drafting.server.ts`、`designing.server.ts` 等 server-only loader 引用 `resolveRequirementsRoot()` 的 route handler(目前覆盖 `apps/web/src/app/api/requirement/[id]/events` 等)

## Solution

把 `homedir()` 的调用从 module 顶层挪到函数体内,让它只在实际请求进来时才执行;同时新增 `AIDEVSPACE_CONFIG_PATH` env 覆盖项,build script 默认注入该 env 让 NFT 看到的路径是稳定的项目内路径。

具体三步:

1. **`DEFAULT_CONFIG_PATH` 常量 → lazy 函数 `getDefaultConfigPath()`** —— `os.homedir()` 从 module-top evaluate 改为按需 evaluate,build 期 NFT 看不到 `homedir()` 调用。
2. **新增 `AIDEVSPACE_CONFIG_PATH` env 覆盖项** —— env 存在且非空时短路返回,NFT trace 时也不调 `homedir()`。
3. **build script 用 `cross-env` 注入 env** —— `$INIT_CWD` 是 pnpm 在 monorepo 跑 script 时暴露的工作区根路径,拼出 `<workspace-root>/.aidevspace/config.yaml`,完全脱离家目录;dev 用户不感知。

效果:

- `next build` 在 Windows + Linux + macOS 一律 GREEN
- `next dev` 行为不变(无 NFT,`homedir()` 按需调用,fallback 链不变)
- 用户在生产环境 / CI 仍可通过 `AIDEVSPACE_CONFIG_PATH` 指向真实配置位置
- 现有 fallback 链(config.yaml → `AIDEVSPACE_HOME` → `cwd + ../..`)**不变**,只是 default config path 的来源多了一层 env 短路

## User Stories

1. As a Windows 平台开发者, I want 在 `apps/web` 目录跑 `pnpm build` 能稳定绿灯(没有 EPERM/EACCES glob 报错), so that 我可以本地验证生产构建而不需要靠反复杀进程碰运气。
2. As a Linux/macOS 平台开发者, I want `pnpm build` 在任何平台上行为一致(都用 project-local 默认 config 路径), so that CI / 本地 / 同事机器之间 build 结果可复现。
3. As a CI 维护者, I want build 脚本不依赖开发者本机的 `os.homedir()`(`/root`、`/Users/xxx`、`C:\Users\xxx` 都不一样), so that CI runner 镜像里 build 不会被任意家目录状态污染。
4. As a dev 用户(开发期 `pnpm dev`), I want homedir fallback 链路完全保留 —— 不设 env 也能跑,跟修复前行为一致, so that 我的本地 dev workflow 不被这次改动打破。
5. As a 部署运维, I want 在 production 启动前可以注入 `AIDEVSPACE_CONFIG_PATH=/etc/aidevspace/config.yaml`, so that 我不需要在容器里挂载 `~/.aidevspace/` 这种依赖 OS 用户配置的位置。
6. As a 平台维护者, I want NFT 静态分析路径里**不再出现 `os.homedir()`** 的 module-top evaluate, so that 任何新加的 server-only loader 只要走 `getDefaultConfigPath()` 都能自动避开 NFT 家目录扫描这个反模式。
7. As a 测试编写者, I want `getDefaultConfigPath()` 作为最高可测 seam 的纯函数被直接单元测试(env-injection + fallback 切换), so that 我不需要起 dev server / 跑 `pnpm build` 就能验证修复正确性。
8. As a 测试编写者, I want `resolveRequirementsRoot()` 的现有测试在改动后继续 GREEN(行为契约不变:env 不设 → fallback 链结果跟改前一致), so that 我不破坏既有验收。
9. As a 代码 reviewer, I want diff 里只有 1 个 module-top 改动(常量 → 函数)+ 1 个 build script 改动, so that 评审面小、回滚风险低。
10. As a 安全审计, I want server-only 模块的 module-top 表达式**不包含任何 `node:os` 同步 API 调用**, so that 后续如果接 bundling 优化、或者未来切到 turbopack / Rspack 不会出现"module-top fs/homedir 调用被静态分析时 evaluate"的同类问题。

## Implementation Decisions

### D-1:`DEFAULT_CONFIG_PATH` 改成 lazy 函数 `getDefaultConfigPath()`

- **D-1.1** 在 `apps/web/src/lib/requirements-root.server.ts`:
  - 删除 `export const DEFAULT_CONFIG_PATH = join(homedir(), '.aidevspace', 'config.yaml')`
  - 新增 `export function getDefaultConfigPath(): string`:
    1. 读 `process.env.AIDEVSPACE_CONFIG_PATH`
    2. 若存在且 `length > 0` → 直接返回(短路,**不调 `homedir()`**)
    3. 否则 → 返回 `join(homedir(), '.aidevspace', 'config.yaml')`(行为完全等同原常量)
  - `resolveRequirementsRoot()` 内调用从 `options.configPath ?? DEFAULT_CONFIG_PATH` 改为 `options.configPath ?? getDefaultConfigPath()`
- **D-1.2** module-top **不再**有任何 `homedir()` 调用,`homedir` import 保留(`expandHome` 仍需)
- **D-1.3** 公共导出列表不变(`resolveRequirementsRoot` / `expandHome` / `ResolveRequirementsRootOptions`),只是把 `DEFAULT_CONFIG_PATH` 换成 `getDefaultConfigPath`
- **D-1.4** 函数返回值类型显式声明 `string`(避免 TypeScript 推断成 `string | undefined`)
- **D-1.5** 不引入新依赖;`cross-env` 的决定见 D-2

### D-2:`AIDEVSPACE_CONFIG_PATH` build-time 注入

- **D-2.1** `apps/web/package.json` 修改 `scripts.build`:
  - 改前:`"build": "next build"`
  - 改后:`"build": "cross-env AIDEVSPACE_CONFIG_PATH=$INIT_CWD/.aidevspace/config.yaml next build"`
- **D-2.2** `$INIT_CWD` 是 pnpm 在 monorepo 工作区跑 script 时注入的环境变量,等于 `pnpm-workspace.yaml` 所在目录的绝对路径。这里 = `D:\TraeProject\AI-DevSpace`(仓库根)。用 `$INIT_CWD` 而不是 `process.cwd()`,因为 `pnpm build --filter @ai-devspace/web` 跑 script 时 `process.cwd()` 是 `apps/web/`(子包目录),不是仓库根。
- **D-2.3** `$INIT_CWD/.aidevspace/config.yaml` 在首次 build 时大概率不存在,`resolveRequirementsRoot()` 第 1 层 fallback 静默降级(已有测试覆盖:`config.yaml 不存在时静默降级,不抛错`)→ 走 `AIDEVSPACE_HOME` / `cwd + ../..` fallback,与修复前等价
- **D-2.4** 新增 dev dep `cross-env`(若项目没有):`pnpm add -D -F @ai-devspace/web cross-env`
  - 替代方案(无需新 dep):Windows + Unix 各自写一段 script,用 `prebuild` hook 区分平台 —— **不推荐**,代码冗余且 npm scripts 不便跨平台共享
- **D-2.5** build script 不改 `dev` / `start` / `typecheck` / `test`(这些路径不跑 NFT,行为不变)
- **D-2.6** 文档更新:在 `apps/web/README.md`(若存在)或本 PRD 的 Further Notes 记一行 "production 部署可显式覆盖 `AIDEVSPACE_CONFIG_PATH=/etc/aidevspace/config.yaml`"

### D-3:行为契约保持向后兼容

- **D-3.1** `expandHome()` 函数本体不动(它本身就是 lazy,无 NFT 风险)
- **D-3.2** `resolveRequirementsRoot()` 的 fallback 链(config → env → cwd)顺序不变
- **D-3.3** `ResolveRequirementsRootOptions` 接口不动
- **D-3.4** 既有 module-load 行为(`resolveRequirementsRoot()` 不传 options)结果不变(因为没设 `AIDEVSPACE_CONFIG_PATH` 时,fallback 到原 `homedir()` 路径)
- **D-3.5** 既有 module-load 不抛错(已有测试 `resolveRequirementsRoot · 行为契约 / 不传 options 时仍能工作` 保证)
- **D-3.6** `defaultRequirementsRoot()` 在 `drafting.server.ts` / `analyzing.server.ts` / `designing.server.ts` 的调用形式不变

## Testing Decisions

### T-1:最高 seam = `pnpm build` 退出码 0(acceptance smoke)

- 唯一能完整证明 NFT 不再 glob 家目录的测试是真实跑一次 `pnpm build`。issue 02 在落地后必须 `pnpm --filter @ai-devspace/web build` 退出码 0,且产物 `.next/` 目录里有 `BUILD_ID` 文件。

### T-2:单元测试覆盖 lazy 函数

新增 `apps/web/src/__tests__/requirements-root-config-path.test.ts`,覆盖 `getDefaultConfigPath()` 在所有 env 状态下的行为:

- **T-2.1** `AIDEVSPACE_CONFIG_PATH` 未设 + `delete process.env.AIDEVSPACE_CONFIG_PATH` 干净 env → 返回 `join(homedir(), '.aidevspace', 'config.yaml')`(跟原常量等价)
- **T-2.2** `AIDEVSPACE_CONFIG_PATH='/etc/aidevspace/config.yaml'`(Unix 风格绝对路径)→ 返回 `'/etc/aidevspace/config.yaml'`,**不调 `homedir()`**(用 `vi.spyOn(os, 'homedir')` 抛错,若被调用则测试失败)
- **T-2.3** `AIDEVSPACE_CONFIG_PATH='C:\\Users\\Alice\\.aidevspace\\config.yaml'`(Windows 风格绝对路径)→ 原样返回
- **T-2.4** `AIDEVSPACE_CONFIG_PATH=''`(空字符串)→ **不**短路,fallback 到 `homedir()`(避免空字符串误判)
- **T-2.5** `AIDEVSPACE_CONFIG_PATH='   '`(全空白)→ **不**短路,fallback 到 `homedir()`(与空字符串等价处理)
- **T-2.6** 跨平台断言:返回值必须是 `isAbsolute()` 真的绝对路径(防止 `process.cwd()` 相对路径泄漏进来)

### T-3:既有测试更新

- **T-3.1** `apps/web/src/__tests__/requirements-root.server.test.ts`:
  - 测试文件 header 注释里提到的"`~/.aidevspace/config.yaml` 默认值"需要相应更新注释(默认行为没变,但实现从常量改成函数)
  - `expandHome · 不传 options 时仍能工作(默认 configPath = ~/.aidevspace/config.yaml)` 这条 case 的注释更新:默认路径现在来自 `getDefaultConfigPath()`,不是常量
  - 不动断言 —— 行为契约不变
- **T-3.2** `beforeEach` 隔离增加一行:`delete process.env.AIDEVSPACE_CONFIG_PATH`,避免宿主 shell 设了这个 env 串扰测试

### T-4:不引入 e2e 测试

seam 选最高层(T-1 acceptance smoke)就够了。组件层不需要重测(build 错误是 module-load 期的 IO 行为,不是 UI 行为)。Next.js 自带的 `pnpm typecheck` + `pnpm test` 是回归底线。

## Out of Scope

- **O-1**:把 `expandHome()` 也改成 env-only、不调 `homedir()`(它本身就是函数内调,且 `resolveRequirementsRoot` 第 1 层只解析 config 文件路径,不依赖 expandHome 的结果做 fs trace,所以 NFT 不会展开它 —— 不需要改)
- **O-2**:为其他 server-only 模块(如 `apps/agent/src/server.ts` 也有 `process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')` 的 module-top 计算)做同样修复 —— 本 spec 只修 web 端 `next build`;Agent 端走自己的 bundle 流程,不归 Next.js NFT 管
- **O-3**:把 NFT 的 glob 行为本身改成 `strict: false`(vendor patch)—— 这是 work-around 不是根治,且会被 `pnpm install` 覆盖
- **O-4**:改 `apps/agent` 的 `AIDEVSPACE_HOME` 行为或语义;Agent 端契约由其他 ticket 管
- **O-5**:把 `getDefaultConfigPath()` 改成可注入的工厂函数 / DI 模式(为后续测试更友好) —— 当前 vitest 的 `vi.spyOn(os, 'homedir')` 已经够覆盖
- **O-6**:把 build script 拆成 `build:win` / `build:unix` 两段(避免引入 `cross-env` 依赖) —— cross-env 已经极小(单包零依赖),引入成本可忽略
- **O-7**:在 `next.config.mjs` 加 `outputFileTracingExcludes` 排除家目录(另一种 work-around) —— 与本 spec 的根治路径互斥,二选一;选根治,不选 work-around
- **O-8**:把 `next.config.mjs` 的 `webpack.config.extensionAlias` 也改成 env-only —— 该配置跟 homedir 无关,NFT 不会有问题

## Further Notes

### N-1:诊断过程(给未来 reviewer 的可追溯记录)

本次修复源自一次具体 build 失败:

```
glob error [Error: EPERM: operation not permitted, scandir 'C:\Users\Lorcan\My Documents']
```

临时方案(`taskkill //F //IM node.exe && rm -rf apps/web/.next && pnpm build`)在第一次撞 `My Documents`,重试撞 JetBrains socket 文件,无法稳定复现绿色 build。

通过给 `node_modules/.pnpm/next@14.2.35.../node_modules/next/dist/compiled/glob/glob.js` 打 3 个 hook(`glob.sync` 入口、 `Glob` 构造器、`_readdir` 入口打印 pattern + 调用栈 + 当前 readdir 路径),定位到根因:

```
Glob('C:\Users\Lorcan/**/*', {mark, dot, ignore, strict:true})
  ← glob()
  ← @vercel/nft/index.js:1:18981
  ← @vercel/nft/index.js:1:18948
```

确认 NFT 在 server route 静态分析阶段对 module-top 的 `join(homedir(), ...)` evaluate 后 glob 整个家目录。

3 个 hook 已全部还原,`apps/web/node_modules/.pnpm/next@...` 回到原始 vendor 状态。

### N-2:与 ADR-0023 的关系

ADR-0023 规定 "改 `ClaudeCodeProvider` 的 MCP 路径必须有 e2e 守门",本 spec **不**改 vendor(`next/dist/compiled/glob/glob.js`)—— 只是改了项目自己的代码(`apps/web/src/lib/requirements-root.server.ts`)+ build script。所以不触发 ADR-0023 的"必须先有 e2e"门。但本 spec 仍要求新增单元测试(T-2)+ acceptance smoke(T-1),守门标准不低于 ADR-0023。

### N-3:`$INIT_CWD` 的可用性

`$INIT_CWD` 是 pnpm 在 monorepo 工作区执行 script 时注入的环境变量(`pnpm run build` 时 `$INIT_CWD = <workspace root>`,`pnpm --filter X build` 时同理)。文档见 [pnpm scripts env](https://pnpm.io/cli/run#initial-cwd)。若未来切回 npm/yarn,需要同步替换为 `npm_package_json` 或写一个 wrapper script —— 当前 pnpm-only 环境不需担心。

### N-4:Production 部署建议(给运维)

- **Docker**:在 Dockerfile 里 `ENV AIDEVSPACE_CONFIG_PATH=/etc/aidevspace/config.yaml`,把真实 config 挂到这个路径
- **systemd / k8s**:在 unit / pod spec 里设 `env: [{name: AIDEVSPACE_CONFIG_PATH, value: /etc/aidevspace/config.yaml}]`
- **裸机**:在启动脚本里 `export AIDEVSPACE_CONFIG_PATH=/path/to/config.yaml` 后再跑 `node` / `next start`

### N-5:验证清单(issue 02 合入前必跑)

```bash
# 1. 还原 .next,确认基线 build 失败(可选,只为证明修复真有效)
pnpm install
cd apps/web && pnpm build    # 应当失败

# 2. 应用本 spec 的两个改动后
pnpm install --filter @ai-devspace/web...   # 拉 cross-env
pnpm --filter @ai-devspace/web test         # 既有 + 新增测试全绿
pnpm --filter @ai-devspace/web typecheck    # 0 报错
pnpm --filter @ai-devspace/web build        # 退出码 0,.next/BUILD_ID 存在
```

### N-6:提交策略

两个原子 commit:

- commit 1:`fix(analyzing): DEFAULT_CONFIG_PATH 改成 lazy getDefaultConfigPath()` —— 包含 D-1 + T-2/T-3 全部代码与测试
- commit 2:`chore(web): build script 注入 AIDEVSPACE_CONFIG_PATH via cross-env` —— 包含 D-2 的 package.json + 新增 dev dep

每个 commit 跑 `pnpm --filter @ai-devspace/web typecheck && pnpm --filter @ai-devspace/web test`。
