/**
 * SDK Spike — 验证 @anthropic-ai/claude-code query() 行为
 *
 * 目的：跑通 3 个关键假设，避免 P0-P5 写完才发现假设不成立
 *
 * 验证项：
 *   1. query() 返回 AsyncIterable<SDKMessage>，流式产出
 *   2. model 参数同时接受 role 名 (e.g. 'sonnet') 和 model id 字符串 (e.g. 'MiniMax-M3[1M]')
 *   3. resume: <sdkSessionId> 能续上下文（第二次 query 用第一次返回的 sessionId）
 *
 * 运行：
 *   1. cd apps/agent
 *   2. pnpm add @anthropic-ai/claude-code better-sqlite3
 *   3. pnpm add -D @types/better-sqlite3 tsx
 *   4. pnpm tsx spike/sdk-spike.ts
 *
 * 预期输出（成功路径）：
 *   - 控制台打出 cc-switch 当前 provider / role / model.id
 *   - 第一轮 query：流式看到 system 消息（含 session_id）→ 文本 chunk → done
 *   - 第二轮 query（resume）：流式看到文本 chunk（续上文）→ done
 *   - 验证 log：记录每次 SDKMessage 的 type / 关键字段
 */

import { query, type SDKMessage, type Options } from "@anthropic-ai/claude-code"
import Database from "better-sqlite3"
import { homedir } from "os"
import { join } from "path"

// ============================================================
// 1. 读 cc-switch.db
// ============================================================
type RoleName = "main" | "haiku" | "sonnet" | "opus" | "fable" | "reasoning"

type ProviderIndex = {
  id: string
  name: string
  is_current: boolean
  baseUrl: string
  apiKey: string
  models: Record<RoleName, string | null>
}

function loadCcSwitchIndex(): ProviderIndex[] {
  const dbPath = process.env.CC_SWITCH_DB ?? join(homedir(), ".cc-switch", "cc-switch.db")
  console.log(`[cc-switch] reading ${dbPath}`)

  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .prepare(
        `SELECT id, name, is_current, settings_config
         FROM providers
         WHERE app_type = 'claude'
         ORDER BY is_current DESC, sort_index, created_at`
      )
      .all() as Array<{
      id: string
      name: string
      is_current: number
      settings_config: string
    }>

    return rows.map((row) => {
      const env = (JSON.parse(row.settings_config) as { env?: Record<string, string> }).env ?? {}
      return {
        id: row.id,
        name: row.name,
        is_current: row.is_current === 1,
        baseUrl: env.ANTHROPIC_BASE_URL ?? "",
        apiKey: env.ANTHROPIC_AUTH_TOKEN ?? "",
        models: {
          main: env.ANTHROPIC_MODEL ?? null,
          haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? null,
          sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? null,
          opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
          fable: env.ANTHROPIC_DEFAULT_FABLE_MODEL ?? null,
          reasoning: env.ANTHROPIC_REASONING_MODEL ?? null,
        },
      }
    })
  } finally {
    db.close()
  }
}

// ============================================================
// 2. 打印当前 provider 状态
// ============================================================
function printCurrent(index: ProviderIndex[]): ProviderIndex {
  const current = index.find((p) => p.is_current) ?? index[0]
  console.log(`[cc-switch] current provider: ${current.name}`)
  console.log(`[cc-switch] baseUrl: ${current.baseUrl}`)
  console.log(`[cc-switch] models:`)
  for (const [role, id] of Object.entries(current.models)) {
    if (id) console.log(`  ${role.padEnd(10)} → ${id}`)
  }
  return current
}

// ============================================================
// 3. Spike A — 验证 model 参数接受 role 名 vs model id
// ============================================================
async function spikeA_acceptsModelIdAndRoleName(current: ProviderIndex) {
  console.log("\n========== Spike A: model 参数接受 role 名 vs model id ==========")

  // A1: 传 role 名
  const roleName: RoleName = "sonnet"
  console.log(`\n[A1] query({ model: '${roleName}' })`)
  try {
    for await (const msg of query({
      prompt: "用一句话回答：你是什么 model？",
      options: { model: roleName } as Options,
    })) {
      console.log(`  [A1 event] type=${msg.type}` + (extractText(msg) ? ` text="${truncate(extractText(msg)!, 60)}"` : ""))
    }
    console.log("  [A1] ✅ 传 role 名可工作")
  } catch (e) {
    console.log(`  [A1] ❌ 传 role 名失败：${(e as Error).message}`)
  }

  // A2: 传 model id 字符串
  const modelId = current.models.sonnet ?? current.models.main
  if (!modelId) {
    console.log("  [A2] ⚠️  当前 provider 没有 sonnet model id，跳过")
    return
  }
  console.log(`\n[A2] query({ model: '${modelId}' })`)
  try {
    for await (const msg of query({
      prompt: "用一句话回答：你是什么 model？",
      options: { model: modelId } as Options,
    })) {
      console.log(`  [A2 event] type=${msg.type}` + (extractText(msg) ? ` text="${truncate(extractText(msg)!, 60)}"` : ""))
    }
    console.log(`  [A2] ✅ 传 model id 字符串可工作（id=${modelId}）`)
  } catch (e) {
    console.log(`  [A2] ❌ 传 model id 失败：${(e as Error).message}`)
  }
}

// ============================================================
// 4. Spike B — 验证 sessionId resume
// ============================================================
async function spikeB_resumeWorks() {
  console.log("\n========== Spike B: sessionId resume 续上下文 ==========")

  // B1: 第一轮 query
  console.log("\n[B1] 第一次 query（不传 resume）")
  let firstSessionId: string | undefined
  try {
    for await (const msg of query({
      prompt: "我的名字叫 Lorcan。请记住这个名字。",
    })) {
      const sid = extractSessionId(msg)
      if (sid) firstSessionId = sid
      console.log(`  [B1 event] type=${msg.type}` + (sid ? ` session_id=${sid.slice(0, 8)}…` : ""))
    }
  } catch (e) {
    console.log(`  [B1] ❌ 第一次 query 失败：${(e as Error).message}`)
    return
  }

  if (!firstSessionId) {
    console.log("  [B1] ⚠️  没拿到 session_id（SDK 可能改了协议），跳过 B2")
    return
  }
  console.log(`  [B1] ✅ 拿到 session_id: ${firstSessionId}`)

  // B2: 第二轮 query 用 resume
  console.log(`\n[B2] 第二次 query（resume: ${firstSessionId.slice(0, 8)}…）`)
  let rememberedName = false
  try {
    for await (const msg of query({
      prompt: "我刚才告诉你我叫什么名字？",
      options: { resume: firstSessionId } as Options,
    })) {
      const text = extractText(msg) ?? ""
      if (text.toLowerCase().includes("lorcan")) rememberedName = true
      console.log(`  [B2 event] type=${msg.type}` + (text ? ` text="${truncate(text, 80)}"` : ""))
    }
  } catch (e) {
    console.log(`  [B2] ❌ resume 失败：${(e as Error).message}`)
    return
  }

  if (rememberedName) {
    console.log("  [B2] ✅ resume 续上下文成功（AI 记住了名字）")
  } else {
    console.log("  [B2] ⚠️  AI 没在响应里提到 'Lorcan'，resume 可能不工作或 AI 表达方式不同")
  }
}

// ============================================================
// 5. 工具函数
// ============================================================
function extractText(msg: SDKMessage): string | null {
  const m = msg as unknown as { message?: { content?: Array<{ type: string; text?: string }> } }
  const content = m.message?.content
  if (!Array.isArray(content)) return null
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("")
}

function extractSessionId(msg: SDKMessage): string | null {
  const m = msg as unknown as { session_id?: string; message?: { session_id?: string } }
  return m.session_id ?? m.message?.session_id ?? null
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s
}

// ============================================================
// 6. 主流程
// ============================================================
async function main() {
  console.log("=== Claude Code SDK Spike ===\n")

  let index: ProviderIndex[]
  try {
    index = loadCcSwitchIndex()
  } catch (e) {
    console.error(`[fatal] 读 cc-switch.db 失败：${(e as Error).message}`)
    console.error("  提示：确保 cc-switch 已安装并至少配过一个 provider")
    process.exit(1)
  }

  if (index.length === 0) {
    console.error("[fatal] cc-switch 里没有 app_type='claude' 的 provider")
    process.exit(1)
  }

  const current = printCurrent(index)

  await spikeA_acceptsModelIdAndRoleName(current)
  await spikeB_resumeWorks()

  console.log("\n=== Spike 完成 ===")
  console.log("把控制台输出贴到 .scratch/feature/sdk-integration/spike-notes.md")
}

main().catch((e) => {
  console.error("[fatal]", e)
  process.exit(1)
})
