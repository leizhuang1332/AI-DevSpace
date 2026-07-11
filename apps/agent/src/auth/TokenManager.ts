import { randomBytes } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface TokenManagerLogger {
  warn(msg: string, ctx?: Record<string, unknown>): void
}

export class TokenManager {
  private cached: string | null = null
  private warnedMode = false

  constructor(
    private readonly root: string,
    private readonly logger?: TokenManagerLogger,
  ) {}

  /** Lazily generate-or-read the token; idempotent. */
  async ensure(): Promise<string> {
    if (this.cached) return this.cached
    const tokenPath = this.tokenPath()
    let existing: string | null = null
    try {
      existing = readFileSync(tokenPath, 'utf8')
    } catch {
      existing = null
    }
    if (!existing) {
      mkdirSync(dirname(tokenPath), { recursive: true })
      const generated = randomBytes(32).toString('base64url')
      const fd = openSync(tokenPath, 'wx', 0o600)
      try {
        writeFileSync(fd, generated)
      } finally {
        closeSync(fd)
      }
      existing = generated
    } else {
      // Sanity-check mode; warn if too permissive
      try {
        const mode = statSync(tokenPath).mode & 0o777
        if (mode & 0o077) {
          if (!this.warnedMode) {
            this.logger?.warn('agent-token file mode is too permissive', { mode: mode.toString(8) })
            this.warnedMode = true
          }
        }
      } catch {
        /* ignore stat failure */
      }
    }
    this.cached = existing
    return existing
  }

  /** Return cached token; throws if ensure() has not been called. */
  get(): string {
    if (!this.cached) throw new Error('TokenManager: token not initialised; call ensure() first')
    return this.cached
  }

  tokenPath(): string {
    return join(this.root, '.agent-token')
  }
}