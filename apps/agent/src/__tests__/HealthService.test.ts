import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HealthService } from '../services/HealthService.js'
import { TokenManager } from '../auth/TokenManager.js'

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'aidevsp-h-'))
}

describe('HealthService.collect', () => {
  it('returns ok:true when workspace + token + log file all healthy', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      writeFileSync(join(root, 'config.yaml'), 'name: dev\n')
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: ['http://localhost:3333'],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date('2026-07-12T08:00:00Z'),
      })
      const out = await svc.collect()
      expect(out.ok).toBe(true)
      expect(out.service).toBe('agent')
      expect(out.bootTime).toBe('2026-07-12T08:00:00.000Z')
      expect(out.workspace.exists).toBe(true)
      expect(out.workspace.configOk).toBe(true)
      expect(out.auth.tokenPresent).toBe(true)
      expect(out.sse.hubSubscribers).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns ok:false when token file missing', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      rmSync(join(root, '.agent-token'))
      const fresh = new TokenManager(root)
      const svc = new HealthService({
        root,
        tokenManager: fresh,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.ok).toBe(false)
      expect(out.auth.tokenPresent).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns ok:false when config.yaml missing', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.workspace.configOk).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // Windows 上 fs.chmod 是 no-op,fs.stat 拿不到 POSIX 权限位 —— 跳到 Linux/macOS CI 覆盖
  it.skipIf(process.platform === 'win32')('reports tokenFileMode from filesystem stat', async () => {
    const root = tmpRoot()
    try {
      const tm = new TokenManager(root)
      await tm.ensure()
      chmodSync(join(root, '.agent-token'), 0o644)
      const svc = new HealthService({
        root,
        tokenManager: tm,
        allowedOrigins: [],
        logFilePath: '/tmp/agent.log',
        sseHubStats: () => ({ subscribers: 0 }),
        bootTime: new Date(),
      })
      const out = await svc.collect()
      expect(out.auth.tokenFileMode).toBe('0644')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
