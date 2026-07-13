'use server'

/**
 * ANALYZING 工位 · 识别产物交互编辑 server action(issue 19d · VS4)
 *
 * 数据流(对照 issue 19d §端到端行为):
 *   [Client] ProductList 编辑/删除/合并/新增 → onAction(change)
 *   [Client → Server Action] updateProduct(requirementId, sessionId, change)
 *   [Server] 读 products.yaml → applyProductChange(纯函数) → 写回 products.yaml
 *   [Server] revalidatePath 触发 RSC 重读 → admission / products 自动刷新
 *
 * 设计要点:
 * - 严格走 server-only 路径:products.server.ts 的 IO 函数 + 决策 2 "纯文件系统"
 * - 决策 47 自动 snapshot 留 hook(`snapshotBeforeWrite`)—— 平台级 snapshot 服务
 *   (`.aidevspace/snapshots/<req-id>/<ts>/`)P1+ 接入,本 slice 在环境变量缺失时降级为
 *   跳过(不影响主流程)
 * - 返回 discriminated union { ok: true } | { ok: false; error } 便于客户端按需提示
 *   (失败时不抛,避免触发 Next.js error overlay;UI 层根据 ok=false 决定是否 toast)
 *
 * 不破坏:仅追加 server action;products.server.ts / products.ts / product-list.tsx
 * 行为不变。
 */

import { revalidatePath } from 'next/cache'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadProducts, saveProducts } from './products.server'
import {
  applyProductChange,
  type ProductChange,
} from './products'

// ---------------------------------------------------------------------------
// Server Action 入口
// ---------------------------------------------------------------------------

/**
 * 应用单个 product 变更并写回 products.yaml。
 *
 * 失败时返回 `{ ok: false, error }` —— 不抛异常(避免污染 Error 边界);调用方
 * 根据 ok 决定是否提示。
 *
 * 自动 snapshot:写前若 `AIDEVSPACE_SNAPSHOT_DIR` 环境变量指向有效目录,则把
 * 当前 products.yaml 拷到 `<snapshotDir>/<req-id>/<ts>/products.yaml`(决策 47)。
 * 未配置时静默跳过(向后兼容)。
 *
 * @param requirementId 需求 id(用于 revalidatePath 与 snapshot 目录)
 * @param sessionId 会话 id(对应 `analysis/sessions/<session-id>/products.yaml`)
 * @param change 单一变更(edit/delete/add/merge)
 */
export async function updateProduct(
  requirementId: string,
  sessionId: string,
  change: ProductChange,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sessionsDir = resolveSessionsDir(requirementId)
    // 1. 写前 snapshot(决策 47 · 失败不阻塞主流程)
    snapshotBeforeWrite(sessionsDir, sessionId)

    // 2. 读 → 应用变更 → 写回
    const file = loadProducts(sessionsDir, sessionId)
    const next = applyProductChange(file, change)
    saveProducts(sessionsDir, sessionId, next)

    // 3. 触发 RSC 刷新(admission / products 自动重读)
    revalidatePath(`/requirements/${requirementId}/analyzing`)

    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 解析 analysis/sessions/ 父目录。
 *
 * 约定:`<AIDEVSPACE_ROOT>/requirements/<req-id>/analysis/sessions/`
 * (对照 CONTEXT.md 决策 2 + 决策 3 + ADR-0013 D8)。
 *
 * 环境变量:
 * - `AIDEVSPACE_ROOT`:workspace 根目录(默认 `~/.aidevspace`)
 * - `AIDEVSPACE_SNAPSHOT_DIR`:snapshot 目录(留 hook;默认未设置 → 跳过)
 *
 * SSR 期或运行环境不可用时,降级到 process.cwd() 子目录,
 * 保证 dev / test 不会因 homedir 缺失而崩(失败路径在 updateProduct 顶层 catch)。
 */
function resolveSessionsDir(requirementId: string): string {
  const root = process.env.AIDEVSPACE_ROOT ?? defaultRoot()
  return join(root, 'requirements', requirementId, 'analysis', 'sessions')
}

function defaultRoot(): string {
  // SSR 期 Node.js 有 os.homedir;浏览器侧永不会调到这里('use server' 边界)
  // 兜底 process.cwd() 仅用于极端环境
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { homedir } = require('node:os')
    return join(homedir(), '.aidevspace')
  } catch {
    return process.cwd()
  }
}

/**
 * 写前 snapshot hook(决策 47 · ADR-0009 第 4 层)。
 *
 * 未配置 AIDEVSPACE_SNAPSHOT_DIR 时静默返回;配置时把当前 products.yaml
 * 拷贝到 `<snapshotDir>/<req-id>/<iso-ts>/products.yaml`。失败不抛——
 * snapshot 是 best-effort,主流程不应被它阻塞。
 */
function snapshotBeforeWrite(sessionsDir: string, sessionId: string): void {
  const snapshotDir = process.env.AIDEVSPACE_SNAPSHOT_DIR
  if (!snapshotDir) return // 未配置 → 跳过(默认)

  try {
    const reqId = extractRequirementId(sessionsDir)
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const target = join(snapshotDir, reqId, ts, 'products.yaml')
    mkdirSync(join(snapshotDir, reqId, ts), { recursive: true })
    const source = join(sessionsDir, sessionId, 'products.yaml')
    // 不引 fs.copyFile 的额外 import;read+write 等价且零额外依赖
    const { readFileSync, existsSync } = require('node:fs') as typeof import('node:fs')
    if (existsSync(source)) {
      writeFileSync(target, readFileSync(source))
    }
  } catch {
    /* best-effort;吞掉错误 */
  }
}

/** 从 sessionsDir 反推 requirementId(末三级目录的父目录名) */
function extractRequirementId(sessionsDir: string): string {
  // sessionsDir = <root>/requirements/<req-id>/analysis/sessions
  // 拆分后 [-2] = 'analysis', [-3] = req-id
  const parts = sessionsDir.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 3] ?? 'unknown'
}