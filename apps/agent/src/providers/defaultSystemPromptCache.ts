/**
 * defaultSystemPromptCache —— 把 Claude Code CLI 的 default system prompt
 * 抓下来缓存,让 ClaudeCodeProvider 的 dump 能完整打印
 * 「SDK 原始 default + 我们 appendSystemPrompt」。
 *
 * 为什么需要这个模块:
 * - @anthropic-ai/claude-agent-sdk 只是个传输壳,spawn `claude` CLI 子进程
 * - CLI 的 default system prompt 写在二进制里,**不暴露 flag**,`--debug api` 也不打 body
 * - 想拿到 default,只能起个 localhost HTTP 代理,把 CLI 的 baseUrl 指向它,
 *   拦截首个 POST /v1/messages 的 JSON body,从 `system` 字段提取
 *
 * 流程(captureOnce):
 *   1. `claude --version` 拿版本
 *   2. 起 localhost:0 HTTP proxy
 *   3. 写临时 `--settings` JSON,把 env.ANTHROPIC_BASE_URL 指到 proxy
 *   4. spawn `claude --settings <tmp> -p "ping"` 一次性 side-channel call
 *   5. proxy 拦截首个 POST body,返回极简 SSE 响应让 CLI 不重试
 *   6. 解析 body → CachedDefault → 落 `<workspace>/.analysis-cwd/.cache/default-system-prompt.json`
 *
 * 读取(readCache)是同步的 —— dump 在热路径,每次 SDK 调用都打,
 * 不能因为读 cache 卡 IO。capture 写入用 temp+rename 原子替换,无并发风险。
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

export type SystemBlock = {
  type: string
  text: string
  cache_control?: unknown
}

export type CachedDefault = {
  captured_at: string
  claude_cli_path: string
  claude_version: string
  model: string
  system_blocks: SystemBlock[]
  system_combined_chars: number
  tools_count: number
  messages_count: number
  /** raw 请求体里还有什么顶层 key —— 给 dump 提供完整画像 */
  raw_request_keys: string[]
}

const CACHE_DIR = path.join('.analysis-cwd', '.cache')
const CACHE_FILE = 'default-system-prompt.json'

export function getCachePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CACHE_DIR, CACHE_FILE)
}

export function readCache(workspaceRoot: string): CachedDefault | null {
  try {
    const raw = fs.readFileSync(getCachePath(workspaceRoot), 'utf8')
    const parsed = JSON.parse(raw) as CachedDefault
    if (!Array.isArray(parsed.system_blocks)) return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(workspaceRoot: string, cached: CachedDefault): Promise<void> {
  const cachePath = getCachePath(workspaceRoot)
  fs.mkdirSync(path.dirname(cachePath), { recursive: true })
  const tmpPath = `${cachePath}.${process.pid}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(cached, null, 2), 'utf8')
  fs.renameSync(tmpPath, cachePath)
}

// ─── capture 编排 ──────────────────────────────────────────────────────

const CAPTURE_TIMEOUT_MS = 30_000

type ProxyHandle = {
  port: number
  close: () => Promise<void>
  waitForBody: () => Promise<string>
}

async function startLocalProxy(): Promise<ProxyHandle> {
  return new Promise((resolve, reject) => {
    let resolveBody: ((body: string) => void) | null = null
    const bodyPromise = new Promise<string>((r) => {
      resolveBody = r
    })

    const server = createServer((req, res) => {
      // CLI 启动后会先 HEAD 探一下;直接 200 放行
      if (req.method === 'HEAD') {
        res.writeHead(200)
        res.end()
        return
      }
      let body = ''
      req.on('data', (c) => {
        body += c.toString('utf8')
      })
      req.on('end', () => {
        if (resolveBody) {
          resolveBody(body)
          resolveBody = null
        }
        // 返回极简 SSE 响应,让 CLI 认为调用成功、不要重试
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write(
          `event: message_start\ndata: ${JSON.stringify({
            type: 'message_start',
            message: {
              id: 'msg_probe',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'probe',
              stop_reason: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          })}\n\n`,
        )
        res.write(
          `event: content_block_start\ndata: ${JSON.stringify({
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          })}\n\n`,
        )
        res.write(
          `event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'probe-ok' },
          })}\n\n`,
        )
        res.write(
          `event: content_block_stop\ndata: ${JSON.stringify({
            type: 'content_block_stop',
            index: 0,
          })}\n\n`,
        )
        res.write(
          `event: message_delta\ndata: ${JSON.stringify({
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: { output_tokens: 1 },
          })}\n\n`,
        )
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`)
        res.end()
      })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('failed to get ephemeral port'))
        return
      }
      resolve({
        port: addr.port,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r())
          }),
        waitForBody: () => bodyPromise,
      })
    })
  })
}

async function readClaudeVersion(claudeCliPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // shell:true 让 Windows 上 npm 包装的 .cmd/.sh 也能解析到真 .exe
    const proc = spawn(claudeCliPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
    let stdout = ''
    proc.stdout.on('data', (c) => {
      stdout += c.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`claude --version exited ${code}`))
        return
      }
      // 输出形如 "2.1.204 (Claude Code)"
      const m = stdout.match(/(\d+\.\d+\.\d+)/)
      resolve(m ? m[1] : stdout.trim())
    })
  })
}

export type CaptureOnceOptions = {
  workspaceRoot: string
  claudeCliPath?: string
}

export async function captureOnce(opts: CaptureOnceOptions): Promise<CachedDefault> {
  const claudeCliPath = opts.claudeCliPath ?? 'claude'

  const [version, proxy] = await Promise.all([readClaudeVersion(claudeCliPath), startLocalProxy()])

  // 临时 settings 文件 —— 把 env.ANTHROPIC_BASE_URL 指到 proxy
  const settingsPath = path.join(opts.workspaceRoot, CACHE_DIR, `probe-settings-${process.pid}.json`)
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${proxy.port}`,
        ANTHROPIC_AUTH_TOKEN: 'dummy',
      },
    }),
    'utf8',
  )

  const sessionId = randomUUID()
  // 不传 --bare —— SDK 在生产环境也不传,我们要的是「真实默认」,
  // 而不是 --bare 模式下的最小化版本(只 767 字符,丢掉 6816 字符的 agent 描述)
  const cliArgs = ['--settings', settingsPath, '-p', '--session-id', sessionId, 'ping']

  const cli = spawn(claudeCliPath, cliArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: true,
  })

  let stderrTail = ''
  cli.stderr.on('data', (c) => {
    stderrTail += c.toString('utf8').slice(-2000)
  })

  const bodyPromise = proxy.waitForBody()
  const exitPromise = new Promise<number>((resolve) => {
    cli.on('exit', (code) => resolve(code ?? -1))
  })

  let body = ''
  try {
    body = await Promise.race([
      bodyPromise,
      new Promise<never>((_, rej) =>
        setTimeout(
          () => rej(new Error(`capture timeout (cli stderr tail: ${stderrTail.slice(-500)})`)),
          CAPTURE_TIMEOUT_MS,
        ),
      ),
    ])
    // 等 CLI 自然退出(避免 settings 文件还被它持有)
    await Promise.race([
      exitPromise,
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('cli exit timeout')), 5_000),
      ),
    ]).catch(() => {
      cli.kill()
    })
  } finally {
    await proxy.close().catch(() => {})
    try {
      fs.unlinkSync(settingsPath)
    } catch {
      // ignore
    }
  }

  const parsed = JSON.parse(body) as Record<string, unknown>
  const systemRaw = parsed['system']
  const systemBlocks: SystemBlock[] = Array.isArray(systemRaw)
    ? systemRaw.map((b: Record<string, unknown>) => ({
        type: typeof b['type'] === 'string' ? (b['type'] as string) : 'text',
        text: typeof b['text'] === 'string' ? (b['text'] as string) : '',
        cache_control: b['cache_control'],
      }))
    : typeof systemRaw === 'string'
      ? [{ type: 'text', text: systemRaw, cache_control: undefined }]
      : []

  const cached: CachedDefault = {
    captured_at: new Date().toISOString(),
    claude_cli_path: claudeCliPath,
    claude_version: version,
    model: typeof parsed['model'] === 'string' ? (parsed['model'] as string) : 'unknown',
    system_blocks: systemBlocks,
    system_combined_chars: systemBlocks.reduce((n, b) => n + b.text.length, 0),
    tools_count: Array.isArray(parsed['tools']) ? (parsed['tools'] as unknown[]).length : 0,
    messages_count: Array.isArray(parsed['messages'])
      ? (parsed['messages'] as unknown[]).length
      : 0,
    raw_request_keys: Object.keys(parsed),
  }

  await writeCache(opts.workspaceRoot, cached)
  return cached
}

export type EnsureCachedOptions = CaptureOnceOptions & {
  /** 强制重抓(忽略已有 cache) */
  force?: boolean
}

/**
 * 读 cache;若不存在(且非 force)返回 null;否则触发 captureOnce。
 * capture 失败抛错 —— 调用方决定是否吞掉(启动期吞掉,运行时透传给上层)。
 */
export async function ensureCached(opts: EnsureCachedOptions): Promise<CachedDefault | null> {
  if (!opts.force) {
    const existing = readCache(opts.workspaceRoot)
    if (existing) return existing
  }
  return captureOnce(opts)
}