/**
 * agent-start.sh 行为级回归(issue:Agent 启动误报 ready 导致 Web → Agent 全断)
 *
 * 关键回归(避免重现):旧脚本只做 `/dev/tcp/$PORT` 端口探活,在端口被任意进程
 * 占用(典型:EADDRINUSE 残留)时会误报 ready 并以 0 退出,而 Agent 实际
 * 因端口冲突瞬间退出。本次直接用 bash 子进程跑真脚本,套独立沙箱:
 * 1. 用 AIDEVSPACE_HOME / AGENT_LOG_FILE / AIDEVSPACE_SNAPSHOT_DIR 重定向到临时目录
 * 2. 注入 PORT 指派一个空闲端口
 * 3. 在沙箱内放一个"假 Agent 进程",只 TCP 占用端口不响应 HTTP
 * 4. 调 agent-start.sh,断言非零退出 + PID 文件被清掉
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '..', 'agent-start.sh')

interface FakeAgentHandle {
  server: Server
  port: number
}

/**
 * 占用一个端口但**不**提供 HTTP / 任何响应 —— 模拟"端口被其他进程占着、
 * agent 启动因 EADDRINUSE 立即退出"的真实失败场景。
 */
async function occupyRandomPort(): Promise<FakeAgentHandle> {
  const server = createServer(() => {
    // intentionally never write a response
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('failed to obtain occupied port')
  }
  return { server, port: address.port }
}

describe('agent-start.sh', () => {
  let sandbox: string
  let pidFile: string
  let logFile: string
  let snapshotDir: string
  let occ: FakeAgentHandle | null = null
  let env: NodeJS.ProcessEnv

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'agent-start-test-'))
    pidFile = join(sandbox, '.agent.pid')
    logFile = join(sandbox, 'logs', 'agent.log')
    snapshotDir = join(sandbox, 'snapshots', 'analysis')
    // 完全隔离 AIDEVSPACE_HOME,避免影响真实 ~/.aidevspace
    env = {
      ...process.env,
      AIDEVSPACE_HOME: sandbox,
      AGENT_LOG_FILE: logFile,
      AIDEVSPACE_SNAPSHOT_DIR: snapshotDir,
      // 缩短探测窗口,让"端口被占 + 无 HTTP"路径在 2s 内失败,避免 vitest 跑 30s
      AGENT_START_PROBE_TIMEOUT: '4',
    }
  })

  afterEach(async () => {
    if (occ) {
      await new Promise<void>((r) => occ!.server.close(() => r()))
      occ = null
    }
    if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
  })

  it('端口被占 + 无 HTTP → 非零退出 + 清理 PID 文件(回归 EADDRINUSE 误报 ready)', async () => {
    occ = await occupyRandomPort()
    env = { ...env, PORT: String(occ.port) }

    const proc = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' })
    const stdout = proc.stdout + proc.stderr

    // 旧脚本会以 "ready on :$PORT" 误报并 exit 0;新脚本必须非零退出
    expect(proc.status, `agent-start.sh unexpected exit: stdout/stderr=\n${stdout}`).not.toBe(0)
    expect(stdout, 'stderr/stdout should explain /api/health probe failure').toMatch(
      /did not return 200|exited before becoming ready/,
    )
    // 失败后必须把 PID 文件清掉,避免下一轮启动被 "already running" 短路
    expect(existsSync(pidFile), 'pid file should be removed on startup failure').toBe(false)
  }, 45_000)

  it('保留已存活的 PID 文件:同一 agent 已运行时退出 0 且不重启', () => {
    // 直接写一个活着但非 Agent 的 PID 进去,模拟"之前的 agent 还在跑"
    const filler: ChildProcess = spawn('sleep', ['30'], { stdio: 'ignore', detached: true })
    filler.unref()
    const fillerPid = filler.pid
    if (!fillerPid) throw new Error('failed to spawn filler pid')
    try {
      const fs = require('node:fs') as typeof import('node:fs')
      fs.writeFileSync(pidFile, String(fillerPid))
      const result = spawnSync('bash', [SCRIPT], { env, encoding: 'utf8' })
      const stdout = result.stdout + result.stderr
      expect(result.status, `unexpected exit: ${stdout}`).toBe(0)
      expect(stdout).toMatch(/already running/)
      const onDisk = readFileSync(pidFile, 'utf8').trim()
      expect(onDisk).toBe(String(fillerPid))
    } finally {
      try {
        process.kill(fillerPid, 0)
        process.kill(fillerPid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  })
})
