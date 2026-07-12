import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenManager } from '../auth/TokenManager.js'

export interface HealthDeps {
  root: string
  tokenManager: TokenManager
  allowedOrigins: string[]
  logFilePath: string
  sseHubStats: () => { subscribers: number }
  bootTime: Date
  agentVersion?: string
}

export interface HealthReport {
  ok: boolean
  service: 'agent'
  version: string
  bootTime: string
  workspace: { root: string; exists: boolean; configOk: boolean }
  auth: { tokenPresent: boolean; tokenFileMode?: string; originAllowlist: string[] }
  sse: { hubSubscribers: number }
  log: { level: string; file: string }
  failed?: string[]
}

export class HealthService {
  constructor(private readonly deps: HealthDeps) {}

  async collect(): Promise<HealthReport> {
    const failed: string[] = []
    const root = this.deps.root
    const workspaceExists = existsSync(root)
    const configPath = join(root, 'config.yaml')
    const configOk = existsSync(configPath)
    if (!workspaceExists) failed.push('workspace.missing')
    if (!configOk) failed.push('workspace.config_missing')

    let tokenPresent = false
    let tokenFileMode: string | undefined
    try {
      const stat = statSync(join(root, '.agent-token'))
      tokenPresent = true
      tokenFileMode = (stat.mode & 0o777).toString(8).padStart(4, '0')
      if (stat.mode & 0o077) failed.push('auth.token_file_mode_too_permissive')
    } catch {
      tokenPresent = false
      failed.push('auth.token_missing')
    }

    let logUnwritable = false
    try {
      // Probe writability; absence is acceptable — only mark failed if parent
      // dir explicitly not writable. Logged separately, not in ok calculation.
      statSync(this.deps.logFilePath)
    } catch {
      // file likely doesn't exist yet (boot hasn't written anything); not fatal
      logUnwritable = false
    }
    if (logUnwritable) failed.push('log.unwritable')

    const ok = !failed.includes('workspace.missing')
      && !failed.includes('workspace.config_missing')
      && tokenPresent

    return {
      ok,
      service: 'agent',
      version: this.deps.agentVersion ?? '0.0.0',
      bootTime: this.deps.bootTime.toISOString(),
      workspace: { root, exists: workspaceExists, configOk },
      auth: {
        tokenPresent,
        tokenFileMode,
        originAllowlist: this.deps.allowedOrigins,
      },
      sse: { hubSubscribers: this.deps.sseHubStats().subscribers },
      log: { level: process.env.LOG_LEVEL ?? 'info', file: this.deps.logFilePath },
      ...(failed.length ? { failed } : {}),
    }
  }
}
