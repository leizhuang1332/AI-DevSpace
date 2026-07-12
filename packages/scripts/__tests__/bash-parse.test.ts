import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const dir = join(import.meta.dirname, '..')
const files = readdirSync(dir).filter((f) => f.endsWith('.sh'))

describe('agent shell scripts parse', () => {
  for (const f of files) {
    it(`${f} passes bash -n syntax check`, () => {
      execFileSync('bash', ['-n', join(dir, f)], { stdio: 'pipe' })
    })
  }
})
