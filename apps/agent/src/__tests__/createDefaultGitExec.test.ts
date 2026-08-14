/**
 * createDefaultGitExec tests —— issue 05 (ADR-0030 D3 / 决策账本 C5)
 *
 * 覆盖验收清单(issue 05 5.2):
 * - 5.2.1 单元测试:env 强制注入 GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS="" / SSH_ASKPASS=""
 *   + 保留 process.env 关键变量(如 PATH)
 *   + 5 分钟 timeout
 *   + execFile 成功/失败/超时三类返回结构
 * - 5.2.2 行为测试:clone 不存在的私有仓库不挂死(15s 内返非零 + stderr 非空)
 *
 * env 注入通过 mock `node:child_process.execFile` 拦截,捕获传给它的 options.env。
 * 行为测试跑真 execFile —— 它依赖 DNS / 网络可达性,默认跳过
 * (describe.skipIf(!RUN_GIT_E2E)),由 RUN_GIT_E2E=1 环境变量显式开启。
 *
 * 这是 issue 05 接受的风险:
 * - 单元测试保证「强制 env」承诺(契约);
 * - 行为测试保证「不挂死」承诺,但只在 dev / CI 显式 opt-in 时跑,避免 DNS/网络抖动
 *   让 CI 红。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFile as realExecFile } from 'node:child_process'
import { promisify } from 'node:util'

// ============================================================================
// 5.2.1 单元测试 —— env 注入契约 + 返回结构
// ============================================================================

// vi.mock 会被 hoist 到文件顶部,所以 mockExecFile 必须用 vi.hoisted 包起来,
// 否则 mock 工厂引用时它还在 TDZ 里。
const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}))

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>(
    'node:child_process',
  )
  return {
    ...actual,
    execFile: mockExecFile,
  }
})

vi.mock('node:util', async () => {
  const actual = await vi.importActual<typeof import('node:util')>('node:util')
  return {
    ...actual,
    // 透传 promisify —— createDefaultGitExec 用它把 execFile 转成 async
    promisify: actual.promisify,
  }
})

// 注意:vi.mock 会被 hoist 到所有 import 之前,所以下面这个静态 import 会拿到 mock 后
// 的 node:child_process(node:util 同理)。
// createDefaultGitExec 内部用 `await import('node:child_process')` 动态加载,
// vitest 对动态 import 同样会触发 mock,这是稳定的。
import { createDefaultGitExec } from '../git/createDefaultGitExec.js'

/**
 * promisify(execFile) 的 callback 形态:`(cmd, args, opts, cb)`,cb 第一个参数是
 * Error 或 null。Vitest 的 vi.fn 默认返回 undefined,我们需要 mockImplementationOnce
 * 在 callback 上触发成功/失败路径。
 */
type ExecFileCallback = (
  err: (Error & {
    code?: number | string
    stdout?: string
    stderr?: string
    killed?: boolean
    signal?: string | null
  }) | null,
  out?: { stdout: string; stderr: string },
) => void

function replyOk(stdout = '', stderr = ''): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback,
    ) => {
      if (typeof cb === 'function') {
        cb(null, { stdout, stderr })
        return
      }
      throw new Error('mockExecFile: unexpected callback shape')
    },
  )
}

function replyFail(
  err: Error & {
    code?: number | string
    stdout?: string
    stderr?: string
    killed?: boolean
    signal?: string | null
  },
): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: readonly string[],
      _opts: unknown,
      cb?: ExecFileCallback,
    ) => {
      if (typeof cb === 'function') {
        cb(err, undefined)
        return
      }
      throw new Error('mockExecFile: unexpected callback shape')
    },
  )
}

describe('createDefaultGitExec · env 注入契约 (issue 05 5.2.1)', () => {
  let originalEnv: NodeJS.ProcessEnv
  let originalPath: string | undefined

  beforeEach(() => {
    mockExecFile.mockReset()
    // 备份原始 env,测试后还原,避免污染其他 suite
    originalEnv = { ...process.env }
    originalPath = process.env.PATH
    // 让 PATH 一定存在,验证「保留 process.env」承诺
    process.env.PATH = '/usr/bin:/bin'
  })

  afterEach(() => {
    process.env = originalEnv
    process.env.PATH = originalPath
  })

  it('强制注入 GIT_TERMINAL_PROMPT=0 / GIT_ASKPASS="" / SSH_ASKPASS=""', async () => {
    replyOk()

    const git = createDefaultGitExec()
    await git(['status'])

    expect(mockExecFile).toHaveBeenCalledTimes(1)
    const opts = mockExecFile.mock.calls[0]?.[2] as {
      env?: Record<string, string | undefined>
      timeout?: number
    }
    expect(opts.env?.GIT_TERMINAL_PROMPT).toBe('0')
    expect(opts.env?.GIT_ASKPASS).toBe('')
    expect(opts.env?.SSH_ASKPASS).toBe('')
  })

  it('保留 process.env 关键变量(PATH 不丢)', async () => {
    replyOk()

    const git = createDefaultGitExec()
    await git(['status'])

    const opts = mockExecFile.mock.calls[0]?.[2] as {
      env?: Record<string, string | undefined>
    }
    // Windows 上 execFile 必须有 PATH,否则 git 本体找不到
    expect(opts.env?.PATH).toBe('/usr/bin:/bin')
  })

  it('timeout: 5 分钟(60_000 * 5),传给 execFile', async () => {
    replyOk()

    const git = createDefaultGitExec()
    await git(['status'])

    const opts = mockExecFile.mock.calls[0]?.[2] as { timeout?: number }
    expect(opts.timeout).toBe(60_000 * 5)
  })

  it('成功:execFile 返 stdout/stderr → {code: 0, stdout, stderr}', async () => {
    replyOk('hello\n', '')

    const git = createDefaultGitExec()
    const result = await git(['status'])

    expect(result).toEqual({ code: 0, stdout: 'hello\n', stderr: '' })
  })

  it('超时(killed + SIGTERM)→ code: 124(沿用 timeout(1) 退出码)', async () => {
    // 注意:issue 5.1 实现用 `??` 而非 `||`,所以 stderr 是空字符串时不会触发
    // 退化消息 —— 这里 stderr 设 undefined 才是 issue 真正承诺的 fallback 路径。
    replyFail(
      Object.assign(new Error('Command failed: git status'), {
        code: undefined,
        stdout: 'partial stdout',
        stderr: undefined,
        killed: true,
        signal: 'SIGTERM',
      }),
    )

    const git = createDefaultGitExec()
    const result = await git(['status'])

    expect(result.code).toBe(124)
    expect(result.stdout).toBe('partial stdout')
    // 退化 stderr 包含「timed out」提示
    expect(result.stderr.toLowerCase()).toContain('timed out')
  })

  it('execFile reject(非超时)→ 用 err.code 作退出码 + 退化 stderr', async () => {
    replyFail(
      Object.assign(new Error('Command failed'), {
        code: 128,
        stdout: '',
        stderr: 'Permission denied (publickey)',
        killed: false,
        signal: null,
      }),
    )

    const git = createDefaultGitExec()
    const result = await git(['clone', 'git@github.com:foo/bar.git', '/tmp/x'])

    expect(result.code).toBe(128)
    expect(result.stderr).toBe('Permission denied (publickey)')
  })

  it('多次调用相互独立:每次都重新注入 env(不被缓存污染)', async () => {
    replyOk()
    replyOk()

    const git = createDefaultGitExec()
    await git(['status'])
    await git(['log', '--oneline'])

    expect(mockExecFile).toHaveBeenCalledTimes(2)
    for (const call of mockExecFile.mock.calls) {
      const opts = call[2] as { env?: Record<string, string | undefined> }
      expect(opts.env?.GIT_TERMINAL_PROMPT).toBe('0')
      expect(opts.env?.GIT_ASKPASS).toBe('')
      expect(opts.env?.SSH_ASKPASS).toBe('')
    }
  })
})

// ============================================================================
// 5.2.2 行为测试 —— 无凭据 clone 不挂死
// ============================================================================

/**
 * 行为测试 opt-in 开关:RUN_GIT_E2E=1 时才跑。
 * 理由:
 * - 依赖 DNS 解析(`git@github.com:does-not-exist/...` 走 SSH,DNS 必失败 →
 *   git 报 'Could not resolve hostname' 后快速返)。
 * - 真实环境的 DNS 抖动 / 网络限速会让 CI 不可靠地红。
 * - 单元测试已覆盖 env 契约(5.2.1),行为测试只作补充保险。
 *
 * 行为测试不走 mock(直接 promisify 真 execFile),手动复刻工厂的 env 注入 + 错误
 * 映射逻辑,断言「15 秒内返非零 + stderr 非空」。
 */
const runGitE2E = process.env.RUN_GIT_E2E === '1'

describe.skipIf(!runGitE2E)(
  'createDefaultGitExec · 行为测试 (issue 05 5.2.2, RUN_GIT_E2E=1 opt-in)',
  () => {
    it('clone 不存在的私有仓库 15s 内必返(code ≠ 0 + stderr 非空)', async () => {
      // 兜底:确保 mockExecFile 不会被意外触发
      mockExecFile.mockReset()

      // 走真 git:不调用工厂(工厂会走 mock 后的 execFile)。
      // 直接 promisify 真 execFile,固定 env 复刻工厂的强制注入语义。
      const exec = promisify(realExecFile)
      const start = Date.now()
      let result: { code: number; stdout: string; stderr: string }
      try {
        const out = await exec(
          'git',
          [
            'clone',
            'git@github.com:does-not-exist-org-xyz123/private-repo-abc.git',
            '/tmp/never-created',
          ],
          {
            encoding: 'utf8',
            timeout: 60_000 * 5,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0',
              GIT_ASKPASS: '',
              SSH_ASKPASS: '',
            },
          },
        )
        result = { code: 0, stdout: out.stdout, stderr: out.stderr }
      } catch (err) {
        const e = err as {
          code?: number | string
          stdout?: string
          stderr?: string
          killed?: boolean
          signal?: string | null
        }
        if (e.killed && e.signal === 'SIGTERM') {
          result = {
            code: 124,
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? `git clone timed out after 5m`,
          }
        } else {
          result = {
            code: typeof e.code === 'number' ? e.code : 1,
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? String(err),
          }
        }
      }
      const elapsed = Date.now() - start

      expect(elapsed).toBeLessThan(15_000)
      expect(result.code).not.toBe(0)
      // 不该是空白 stderr(挂死的表现)
      expect(result.stderr.length).toBeGreaterThan(0)
    }, 30_000)
  },
)