#!/usr/bin/env node
/**
 * capture-default-system-prompt —— 一次性抓取 Claude Code CLI 的 default system prompt,
 * 缓存到 <workspaceRoot>/.analysis-cwd/.cache/default-system-prompt.json。
 *
 * 用法:
 *   node apps/agent/scripts/capture-default-system-prompt.mjs [--workspace-root <path>] [--force]
 *
 * 默认 workspaceRoot = process.cwd()。
 * --force 强制重抓(忽略已有 cache,通常在 Claude Code CLI 升级后用)。
 *
 * 失败常见原因:
 *   - `claude` 不在 PATH(应 `which claude` 验证)
 *   - 端口被占用(本脚本用 ephemeral port 0,通常不会)
 *   - 网络封了 127.0.0.1(几乎不可能)
 */

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
// 从 apps/agent/scripts 退到 repo 根 = apps/agent 的祖父
const agentRoot = resolve(__dirname, '..')

// 解析参数
const args = process.argv.slice(2)
let workspaceRoot = process.cwd()
let force = false
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--workspace-root' && args[i + 1]) {
    workspaceRoot = resolve(args[i + 1])
    i++
  } else if (args[i] === '--force') {
    force = true
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`Usage: capture-default-system-prompt.mjs [--workspace-root <path>] [--force]`)
    process.exit(0)
  }
}

const { captureOnce, readCache, getCachePath } = await import(
  pathToFileURL(resolve(agentRoot, 'src/providers/defaultSystemPromptCache.ts')).href
)

console.log(`[capture] workspaceRoot = ${workspaceRoot}`)
console.log(`[capture] cache path    = ${getCachePath(workspaceRoot)}`)

if (!force) {
  const existing = readCache(workspaceRoot)
  if (existing) {
    console.log(`[capture] cache exists (captured_at=${existing.captured_at}, claude=${existing.claude_version}). Use --force to re-capture.`)
    process.exit(0)
  }
}

console.log(`[capture] starting proxy + side-channel CLI call …`)
const t0 = Date.now()
try {
  const cached = await captureOnce({ workspaceRoot })
  const dt = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[capture] ✓ done in ${dt}s`)
  console.log(`[capture]   claude_version     = ${cached.claude_version}`)
  console.log(`[capture]   model              = ${cached.model}`)
  console.log(`[capture]   system_blocks      = ${cached.system_blocks.length}`)
  console.log(`[capture]   system_chars       = ${cached.system_combined_chars}`)
  for (const [i, b] of cached.system_blocks.entries()) {
    console.log(
      `[capture]     [${i}] type=${b.type} chars=${b.text.length} preview="${b.text.slice(0, 80).replace(/\n/g, ' ')}…"`,
    )
  }
  console.log(`[capture]   tools_count        = ${cached.tools_count}`)
  console.log(`[capture]   messages_count     = ${cached.messages_count}`)
  console.log(`[capture]   raw_request_keys   = [${cached.raw_request_keys.join(', ')}]`)
  console.log(`[capture] written to ${getCachePath(workspaceRoot)}`)
} catch (err) {
  console.error(`[capture] ✗ failed:`, err)
  process.exit(1)
}