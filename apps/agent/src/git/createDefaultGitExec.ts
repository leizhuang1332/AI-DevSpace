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
 * 超时(issue 5.1 验收清单):
 * - `timeout: 60_000 * 5`(5 分钟),clone 大仓库需要。`execFile` 在超时后会
 *   reject 并带 `killed: true, signal: 'SIGTERM'` —— 我们把它映射成 code=124
 *   (沿用 `timeout(1)` 命令的退出码),方便上层判断。
 *
 * 类型 `GitExec` 在 `../codebase/CodebaseManager.ts` 里(issue 03 把
 * WorktreeManager 整体删掉,GitExec 类型已迁移到 codebase 命名空间);
 * 本文件只 import 类型,避免运行时循环依赖。
 */
import type { GitExec } from '../codebase/CodebaseManager.js'

/**
 * 默认的 GitExec —— 用 child_process.execFile 调系统 git。
 *
 * 强制 env 注入(**关键** —— 否则缺凭据时 git 会交互挂死后台进程):
 * - GIT_TERMINAL_PROMPT=0  → 关闭交互式 credential prompt
 * - GIT_ASKPASS=""         → 关闭自动 askpass 唤起
 * - SSH_ASKPASS=""         → 同上(SSH 路径)
 *
 * 让 `git ls-remote` / `git clone` 在网络/认证错时快速失败为 E_AUTH / E_NETWORK,
 * 而不是僵在 stdin 等待输入。
 */
export function createDefaultGitExec(): GitExec {
  return async (args) => {
    const { execFile } = await import('node:child_process')
    const exec = (await import('node:util')).promisify(execFile)
    try {
      const { stdout, stderr } = await exec('git', args, {
        encoding: 'utf8',
        timeout: 60_000 * 5, // 5 分钟上限（clone 大仓库超时）
        env: {
          ...process.env,
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
          stderr: e.stderr ?? `git ${args[0]} timed out after 5m`,
        }
      }
      return {
        code: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      }
    }
  }
}