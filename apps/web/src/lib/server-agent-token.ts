/**
 * server-side 读 agent 鉴权 token 的统一入口
 *
 * 解决"鸡生蛋"问题:首次 RSC 渲染时浏览器还没 bootstrap,cookie 一定拿不到。
 * agent server 启动时已经把 token 持久化到 `~/.aidevspace/.agent-token`(见
 * apps/agent/src/auth/TokenManager.ts),web server 是同进程 Node.js,直接读
 * 文件复用同一份 token —— 无需经浏览器 cookie 通路。
 *
 * 优先级:
 * 1. cookies().get('aidevspace_token')?.value
 *    (优先支持外部 HTTP caller / e2e Playwright 显式 set cookie)
 * 2. $AIDEVSPACE_HOME/.agent-token(或 ~/.aidevspace/.agent-token fallback)
 *    (server-to-server 共享,首次 RSC 渲染也走这条)
 *
 * 注:
 * - 必须 server-side 使用(import 'next/headers' + 'node:fs',客户端 import 会
 *   触发 webpack UnhandledSchemeError)
 * - 任何异常(ENOENT / EACCES / 解析失败)→ 返 null,调用方决定抛错 / 降级
 * - 不做 trim 之外的校验(token 是 32 字节 base64url,空白即视为无效)
 */

import { cookies } from 'next/headers'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const COOKIE_NAME = 'aidevspace_token'
const TOKEN_FILENAME = '.agent-token'

/** 调试 / 测试辅助:上次 getServerAgentToken 走的来源(null 表示都没拿到) */
export type ServerAgentTokenSource = 'cookie' | 'file'

let lastSource: ServerAgentTokenSource | null = null

export function getServerAgentToken(): string | null {
  // 1. cookie 优先(外部 caller / e2e)
  try {
    const cookieTok = cookies().get(COOKIE_NAME)?.value
    if (cookieTok && cookieTok.length > 0) {
      lastSource = 'cookie'
      return cookieTok
    }
  } catch {
    // cookies() 在 Next.js 之外的运行时可能抛 — 继续走文件路径
  }

  // 2. fallback:agent 端 TokenManager 写入的 ~/.aidevspace/.agent-token
  const tokenPath = resolveTokenPath()
  if (!tokenPath) return null
  try {
    const raw = readFileSync(tokenPath, 'utf8')
    const trimmed = raw.trim()
    if (trimmed.length > 0) {
      lastSource = 'file'
      return trimmed
    }
  } catch {
    // ENOENT / EACCES / 任何 IO 失败 → 静默返 null(调用方决定怎么报)
  }

  lastSource = null
  return null
}

/** 测试辅助:返回上次 getServerAgentToken 走的来源 */
export function _getServerAgentTokenSource(): ServerAgentTokenSource | null {
  return lastSource
}

function resolveTokenPath(): string | null {
  // 优先级 1:AIDEVSPACE_HOME(显式配置,CI / e2e / k8s 部署都用这个)
  const explicitHome = process.env.AIDEVSPACE_HOME
  if (explicitHome && explicitHome.length > 0) {
    return join(explicitHome, TOKEN_FILENAME)
  }
  // 优先级 2:dev 本机 fallback —— 直接读 env,不依赖 os 模块
  // (os.homedir() 在 Node 14+ 内部实现就是读 HOME/USERPROFILE,这里等价但
  //  可测试 —— os.homedir 不可 spyOn)
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (!home) return null
  return join(home, '.aidevspace', TOKEN_FILENAME)
}
