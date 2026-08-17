/**
 * requirements 根路径解析(server-only)
 * (issue: zone-data-fidelity-fixes · 05 · D-6.1)
 *
 * 设计动机:
 * - 后端 `RequirementService.root` 在 dev/production 都是
 *   `process.env.AIDEVSPACE_HOME ?? ~/.aidevspace`(见
 *   `apps/agent/src/server.ts:43-45`),真实需求目录是
 *   `~/.aidevspace/requirements/{id}/`。
 * - ticket 01-04 落地的前端 loader 假定 `cwd + ../../requirements`,在用户
 *   环境里**根本不存在**,导致 bug 1/2/3 在用户视角下仍未修复。
 * - 本文件提供三层 fallback 链路,跟后端"先 config → 再 env → 再默认"
 *   的解析策略**完全对齐**,确保前端 loader 读到跟后端落盘一致的根目录。
 *
 * Fallback 链(顺序):
 * 1. `~/.aidevspace/config.yaml` 存在 + 含 `workspaceRoot:` 标量 →
 *    返回 `expandHome(workspaceRoot)`
 * 2. `process.env.AIDEVSPACE_HOME` 存在 → 返回其值
 * 3. fallback `resolve(process.cwd(), '../..')`(保留 dev 默认行为,以防
 *    config 文件不存在)
 *
 * 容错:任何一层失败(文件不存在 / 解析失败 / 字段缺失)→ 静默降级到下一层,
 * 不抛错。调用方拿到**总是一个非空字符串**,可在 fs loader 里直接拼
 * `requirements/<reqId>/...` 路径。
 *
 * server-only 约束:
 * - `.server.ts` 后缀,Next.js/webpack 拒绝 client component 直接 import
 * - 项目当前未安装 `server-only` npm 包;若以后装了,把 `import 'server-only'`
 *   放到文件顶部一行即可获得编译期越界保护
 *
 * 被引用方(ADR-0027:`designing.server.ts` 已退役删除):
 * - `drafting.server.ts` `defaultRequirementsRoot()`
 * - `analyzing.server.ts` `defaultRequirementsRoot()`
 *
 * 与后端的对齐:
 * - 后端 `RequirementService.root = process.env.AIDEVSPACE_HOME ?? join(homedir(), '.aidevspace')`
 *   只读 env + 默认 homedir,不走 config.yaml(后端的 workspaceRoot 是通过
 *   `BuildServerOptions.workspaceRoot` 注入,默认走 env fallback)。
 * - 前端额外多一层 config.yaml 是因为:
 *   1. config.yaml 是用户配置的真实源(`workspaceRoot: /Users/Ray/.aidevspace`)
 *   2. 它能反映"用户当前想要的工作区根"而不依赖启动时 env
 *   3. fallback 顺序跟后端一致(env 在 config 之后,默认在 env 之后)
 */

import { isAbsolute, join, resolve } from 'node:path'
import { normalizeWorkspaceRoot } from '@ai-devspace/shared'
import { parseFlatMap, readYamlFileOrNull } from './yaml.server'

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

/**
 * 默认 config 路径解析(`~/.aidevspace/config.yaml`,可被 env / option 覆盖)。
 *
 * 根治背景(ticket:next-build-homedir-fix):
 * - Next.js `@vercel/nft` 在 `next build` 期间会**主动 glob 配置路径所在目录**
 *   找相关文件。如果路径里包含 `~` 前缀或 `os.homedir()` 的结果,NFT 会用
 *   `validatePath` 把它 expand 成 `${homedir}` 下的绝对路径,然后 emit 一个递归
 *   glob(`${homedir}` 加递归通配)在 Windows 下这个 glob 撞到 XP 遗留路径
 *   (`My Documents`)或 JetBrains IDE socket 文件时 EPERM/EACCES,build abort
 *   (glob strict:true)。
 * - 本文件**完全不 import `node:os`**(包括 `homedir()`)。`process.env.HOME`
 *   / `USERPROFILE` 在 NFT 静态分析期值不可知 → NFT 不会主动 glob 它们。
 *   运行时 dev shell 自动有 `HOME`,Windows cmd 自动有 `USERPROFILE`,无需用户
 *   显式设。
 *
 * 短路链:
 * 1. `process.env.AIDEVSPACE_CONFIG_PATH` 存在且 `.length > 0` 且 trim 非空
 *    → 直接返回(env 由 build script 注入,production 部署可显式覆盖)
 * 2. 否则 → `join($HOME, '.aidevspace', 'config.yaml')`(dev fallback,env 不可
 *    推断 → NFT 安全)
 *
 * 空字符串 / 全空白视为未设,走 fallback。
 *
 * 可被 `options.configPath` 覆盖(主要为测试方便注入 fixture)。
 */
export function getDefaultConfigPath(): string {
  const fromEnv = process.env.AIDEVSPACE_CONFIG_PATH
  if (fromEnv !== undefined && fromEnv.length > 0 && fromEnv.trim().length > 0) {
    return fromEnv
  }
  // 走 env 而非 `os.homedir()`,避开 NFT 的 homedir scan —— 见函数注释
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return join(home, '.aidevspace', 'config.yaml')
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

/** `resolveRequirementsRoot` options —— 主要为测试方便注入 config 路径 */
export interface ResolveRequirementsRootOptions {
  /**
   * 覆盖默认 config 路径(`~/.aidevspace/config.yaml`)。
   * 显式传入 → resolve 时第一优先读该路径,不存在 / 解析失败 → 静默降级到
   * 下一层 fallback。
   */
  configPath?: string
}

/**
 * 解析"前端 loader 用的 requirements 根"。
 *
 * 调用方一律拿到非空字符串,可直接拼 `<root>/requirements/<reqId>/...`
 * 路径去 fs 读产物。
 *
 * @example
 * resolveRequirementsRoot() // → '/Users/Ray/.aidevspace'(用户的真实工作区根)
 * resolveRequirementsRoot({ configPath: '/tmp/fake-config.yaml' }) // 测试注入
 */
export function resolveRequirementsRoot(
  options: ResolveRequirementsRootOptions = {},
): string {
  const configPath = options.configPath ?? getDefaultConfigPath()

  // 第 1 层:config.yaml + workspaceRoot(expandHome 后再 normalize)
  // normalize 必须在 expandHome 之后 —— `~/foo` 经 expandHome 在 win32 上
  // 会得到 `C:\Users\...\foo`,原样即可;若 config 直接写 mingw 风格
  // `/c/Users/...`(用户手填),归一化为 `C:\Users\...`。
  const fromConfig = readWorkspaceRootFromConfig(configPath)
  if (fromConfig !== null) return normalizeWorkspaceRoot(fromConfig)

  // 第 2 层:AIDEVSPACE_HOME env
  const fromEnv = process.env.AIDEVSPACE_HOME
  if (fromEnv && fromEnv.length > 0) return normalizeWorkspaceRoot(fromEnv)

  // 第 3 层:cwd + '../..'(保留 dev 默认行为)
  // resolve() 已经 OS-native 化,无需 normalize
  return resolve(process.cwd(), '../..')
}

/**
 * 把 `~` 开头路径展开为绝对路径(对齐后端 `defaultLogPath` 的 homedir 拼接模式)。
 *
 * 不调 `os.homedir()` —— 走 `process.env.HOME` / `USERPROFILE`,避开 NFT 在
 * `next build` 期间对家目录的递归 glob(见 `getDefaultConfigPath` 注释里的
 * 根治背景)。
 *
 * - `~` 单独 → `$HOME`(env 不可推断 → NFT 安全)
 * - `~/foo` → `$HOME/foo`
 * - 其他(`~~xxx` / 绝对路径 / 相对路径)→ 原样返回
 *
 * @example
 * expandHome('~/.aidevspace') // → '/Users/Ray/.aidevspace'
 * expandHome('/tmp/fake-root') // → '/tmp/fake-root'
 */
export function expandHome(s: string): string {
  if (s === '~') {
    return process.env.HOME ?? process.env.USERPROFILE ?? ''
  }
  if (s.startsWith('~/')) {
    // 走 join() 而非字符串拼接,保证分隔符按平台归一化
    // (Windows 下 HOME 是 C:\\Users\\Lorcan → join 后变 \\.aidevspace,不是 /.aidevspace)
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ''
    return join(home, s.slice(2))
  }
  return s
}

// ---------------------------------------------------------------------------
// 内部 helpers
// ---------------------------------------------------------------------------

/**
 * 从 config.yaml 读 workspaceRoot 字段;失败 / 不存在 / 无字段 → null。
 *
 * 静默降级:文件 IO 失败 / yaml 解析失败 / workspaceRoot 字段缺失都返回 null,
 * 让上层走 fallback 链。
 */
function readWorkspaceRootFromConfig(configPath: string): string | null {
  // 复用 `yaml.server.ts` 的文件读取原语(失败/不存在/空内容统一返 null)
  const raw = readYamlFileOrNull(configPath)
  if (raw === null) return null
  const map = parseFlatMap(raw, 'workspaceRoot')
  if (!map) return null
  const wsRoot = map.workspaceRoot
  if (!wsRoot || wsRoot.length === 0) return null
  const expanded = expandHome(wsRoot)
  // config 里写的是相对路径?这里不展开(防止误把 `~/.aidevspace/relative` 这种
  // 形式解释成相对当前 cwd)。用户配置时应当用绝对路径或 `~/...`。
  if (!isAbsolute(expanded)) return null
  return expanded
}