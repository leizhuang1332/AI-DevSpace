/**
 * createDefaultGitExec —— 默认 GitExec 实现
 *
 * issue 05 (ADR-0030 D3 / 决策账本 C5):
 * 用 child_process.execFile 调系统 git,**强制**注入 4 个环境变量到 `env` 选项,
 * 防止 git 在缺凭据时**交互挂死后台进程**。
 *
 * 强制 env 注入清单:
 * - `GIT_TERMINAL_PROMPT=0` → 关闭交互式 credential prompt
 * - `GIT_ASKPASS=""`        → 关闭自动 askpass 唤起(让 git 在没 askpass 时不弹)
 * - `SSH_ASKPASS=""`        → 同上(SSH 路径)
 * - `...process.env` 保留   → 关键:Windows 上 `PATH` 等系统变量必须保留,否则
 *                              execFile 找不到 git 本体
 *
 * 风险(issue 风险章节):
 * - 用户**故意**设置了 `GIT_ASKPASS=/path/to/my-askpass.sh`(让 git 在密码错时弹 GUI)
 *   —— 本实现会覆盖。本期明确不做「尊重用户 askpass 配置」;
 *   ADR-0030 落定后这是**已知破坏性**,未来若有用户报怨再起 ADR 加白名单。
 *
 * 超时(issue 5.1 验收清单 + Issue 16):
 * - `timeout: 60_000 * 15`(15 分钟),clone 大仓库需要 + `codebaseMgr.clone`
 *   第 1 步 retry 2 次,总耗时可达 ~15min(1s+2s backoff + 3 次 clone)。
 *   `execFile` 在超时后会 reject 并带 `killed: true, signal: 'SIGTERM'` —
 *   我们把它映射成 code=124(沿用 `timeout(1)` 命令的退出码),方便上层判断。
 *
 * 类型 `GitExec` 在 `../codebase/CodebaseManager.ts` 里(issue 03 把
 * WorktreeManager 整体删掉,GitExec 类型已迁移到 codebase 命名空间);
 * 本文件只 import 类型,避免运行时循环依赖。
 */
import type { GitExec, GitExecResult } from '../codebase/CodebaseManager.js'

/**
 * 默认的 GitExec —— 用 child_process.execFile 调系统 git。
 *
 * 强制 env 注入(**关键** —— 否则缺凭据时 git 会交互挂死后台进程):
 * - GIT_TERMINAL_PROMPT=0  → 关闭交互式 credential prompt
 * - GIT_ASKPASS=""         → 关闭自动 askpass 唤起
 * - SSH_ASKPASS=""         → 同上(SSH 路径)
 *
 * Issue 16:5min → 15min 放宽,避免大仓库 clone 被 kill。
 * Issue 16.2:被 wrapGitExec 包装,所有 git 调用都自动带 ISSUE16_GIT_CONFIG_PREFIX。
 * Issue 15:强制 LANG=C 让 git 错误输出英文 —— 后端 `mapCloneError` 的
 * 启发式正则只匹配英文关键字(macOS 默认英文,但某些 shell / IDE 启动
 * agent 时会注入 LANG=zh_CN,git 跟着用中文输出 → 全部 miss → 落到 E_INTERNAL)。
 *
 * 让 `git ls-remote` / `git clone` 在网络/认证错时快速失败为 E_AUTH / E_NETWORK,
 * 而不是僵在 stdin 等待输入。
 */
export function createDefaultGitExec(): GitExec {
  return wrapGitExec(baseGitExec, ISSUE16_GIT_CONFIG_PREFIX)
}

/**
 * Issue 16.2:git config 加固 wrapper —— 把 `-c protocol.version=2` 等
 * 永久参数前插到每次 git 调用的 args。CodebaseManager.clone 不需要自己 prepend,
 * 也不需要让调用方关心。
 *
 * 设计:wrapGitExec 接受一个「底层 GitExec」(只跑 git)和 prefix 参数,
 * 返新的 GitExec —— 每次调用都自动 prepend prefix 到 args。
 */
function wrapGitExec(base: GitExec, prefix: readonly string[]): GitExec {
  return async (args) => base([...prefix, ...args])
}

/**
 * 底层 git 执行器 —— 仅用 child_process.execFile 调系统 git,带强制 env。
 * Issue 16.2:被 wrapGitExec 包装后,所有 git 调用都自动带 prefix。
 */
async function baseGitExec(args: string[]): Promise<GitExecResult> {
  const { execFile } = await import('node:child_process')
  const exec = (await import('node:util')).promisify(execFile)
  try {
    const { stdout, stderr } = await exec('git', args, {
      encoding: 'utf8',
      // Issue 16:5min → 15min。`codebaseMgr.clone` 第 1 步 retry 2 次
      // 总耗时可达 ~15min(1s+2s backoff + 3 次 clone),这里放宽是
      // 单次 clone 的上限;retry 逻辑见 CodebaseManager。
      timeout: 60_000 * 15,
      env: {
        ...process.env,
        // Issue 15:强制 LANG=C 让 git 错误输出英文 —— 后端
        // `mapCloneError` 的启发式正则只匹配英文关键字(macOS 默认
        // 英文,但某些 shell / IDE 启动 agent 时会注入 LANG=zh_CN,
        // git 跟着用中文输出 → 全部 miss → 落到 E_INTERNAL)。
        LANG: 'C',
        LC_ALL: 'C',
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '',
        SSH_ASKPASS: '',
      },
    })
    return { code: 0, stdout, stderr }
  } catch (err) {
    const e = err as {
      code?: number | string
      stdout?: string
      stderr?: string
      killed?: boolean
      signal?: string
    }
    // 超时（killed + signal SIGTERM）
    if (e.killed && e.signal === 'SIGTERM') {
      return {
        code: 124, // 沿用 `timeout` 命令的退出码
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? `git ${args[0]} timed out after 15m`,
      }
    }
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(err),
    }
  }
}

/**
 * Issue 16:把 `git config` 加固项(协议版本 / NFD 处理 / 大 pack buffer)
 * 前插到 git 命令 args 数组,保证每次 git 调用都生效,且不污染用户
 * 的全局 gitconfig。
 *
 * - `protocol.version=2` 减少 sideband packet 错位概率(issue 16 实测
 *   并发 clone 大量出现 fetch-pack sideband 错)
 * - `core.precomposeUnicode=true` macOS HFS+/APFS 必备(虽然默认开,
 *   显式注入更稳)
 * - `http.postBuffer=524288000` (500MB)避免大 pack 写满默认 1MB
 *   buffer 时报 fetch-pack 错位
 *
 * 由 `createDefaultGitExec` 通过 `wrapGitExec` 自动注入,所有调用方零感知。
 *
 * 导出供测试验证 prefix 内容(单元测试断言 git 调用 args 前 6 个元素是
 * 3 个 `-c key=value` 对)。
 */
export const ISSUE16_GIT_CONFIG_PREFIX: ReadonlyArray<string> = [
  '-c',
  'protocol.version=2',
  '-c',
  'core.precomposeUnicode=true',
  '-c',
  'http.postBuffer=524288000',
]
