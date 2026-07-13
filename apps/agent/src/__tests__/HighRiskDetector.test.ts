/**
 * HighRiskDetector tests —— ADR-0010 Q6 + ADR-0009 第 1 层「预」
 *
 * 5 类覆盖:
 *  - delete-business-file: Bash rm / Edit|Write 目标在 protected
 *  - force-push: git push --force / -f
 *  - push-to-main: git push origin main / master / HEAD:main
 *  - secret-leak: Write/Edit content 含 api_key= / Bearer / AKID
 *  - skip-verify: --no-verify / --no-gpg-sign
 *
 * 不命中场景(不报高危):
 *  - ls / cat / Read 等只读操作
 *  - 写 artifacts/ notes/ 等允许路径
 *  - rm 命中白名单
 */

import { describe, it, expect } from 'vitest'
import { createHighRiskDetector } from '../tools/HighRiskDetector.js'

describe('HighRiskDetector', () => {
  describe('delete-business-file (Bash rm)', () => {
    it('flags rm outside allowlist', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'rm -rf src/foo.java' })
      expect(hits.map((h) => h.category)).toContain('delete-business-file')
    })

    it('allows rm hitting allowlist', () => {
      const d = createHighRiskDetector({
        rmAllowlist: ['node_modules'],
      })
      const hits = d.detect('Bash', { command: 'rm -rf node_modules/foo' })
      expect(hits.find((h) => h.category === 'delete-business-file')).toBeUndefined()
    })

    it('allows rm with allowlist regex', () => {
      const d = createHighRiskDetector({
        rmAllowlist: [/\.aidevspace\/snapshots/],
      })
      const hits = d.detect('Bash', {
        command: 'rm -rf .aidevspace/snapshots/req-001/old/',
      })
      expect(hits.find((h) => h.category === 'delete-business-file')).toBeUndefined()
    })

    it('flags Edit/Write targeting protected path', () => {
      const d = createHighRiskDetector({
        protectedPaths: ['.git/'],
      })
      const hits = d.detect('Edit', { file_path: '.git/HEAD', new_string: 'ref: refs/heads/main' })
      expect(hits.map((h) => h.category)).toContain('delete-business-file')
    })

    it('allows Edit/Write to non-protected path', () => {
      const d = createHighRiskDetector({
        protectedPaths: ['.git/'],
      })
      const hits = d.detect('Edit', {
        file_path: 'src/Foo.java',
        new_string: 'public class Foo {}',
      })
      expect(hits).toHaveLength(0)
    })
  })

  describe('force-push', () => {
    it('flags git push --force', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push --force origin feature/x' })
      expect(hits.map((h) => h.category)).toContain('force-push')
    })

    it('flags git push -f (short form)', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push -f origin main' })
      expect(hits.map((h) => h.category)).toContain('force-push')
    })

    it('does not flag plain git push', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push origin feature/x' })
      expect(hits.find((h) => h.category === 'force-push')).toBeUndefined()
    })
  })

  describe('push-to-main', () => {
    it('flags git push origin main', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push origin main' })
      expect(hits.map((h) => h.category)).toContain('push-to-main')
    })

    it('flags git push origin master', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push origin master' })
      expect(hits.map((h) => h.category)).toContain('push-to-main')
    })

    it('flags git push -u origin main', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push -u origin main' })
      expect(hits.map((h) => h.category)).toContain('push-to-main')
    })

    it('flags git push origin HEAD:main', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push origin HEAD:main' })
      expect(hits.map((h) => h.category)).toContain('push-to-main')
    })

    it('does not flag git push origin feature/x', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push origin feature/x' })
      expect(hits.find((h) => h.category === 'push-to-main')).toBeUndefined()
    })
  })

  describe('secret-leak (Write/Edit content)', () => {
    it('flags content with api_key=...', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Write', {
        file_path: 'config/app.yaml',
        content: 'api_key=abcdefghijklmnop1234567890',
      })
      expect(hits.map((h) => h.category)).toContain('secret-leak')
    })

    it('flags content with Bearer token', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Edit', {
        file_path: 'src/Auth.ts',
        new_string: 'const t = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxxx.yyyyy";',
      })
      expect(hits.map((h) => h.category)).toContain('secret-leak')
    })

    it('flags content with AKID prefix', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Write', {
        file_path: 'alicloud/credentials.txt',
        content: 'AKID1234567890ABCDEFGHIJKL',
      })
      expect(hits.map((h) => h.category)).toContain('secret-leak')
    })

    it('does not flag clean content', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Write', {
        file_path: 'src/Foo.ts',
        content: 'export const greeting = "hello world";',
      })
      expect(hits).toHaveLength(0)
    })
  })

  describe('skip-verify', () => {
    it('flags git commit --no-verify', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git commit --no-verify -m "wip"' })
      expect(hits.map((h) => h.category)).toContain('skip-verify')
    })

    it('flags --no-gpg-sign', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git commit --no-gpg-sign -m "wip"' })
      expect(hits.map((h) => h.category)).toContain('skip-verify')
    })

    it('does not flag a normal git commit', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git commit -m "feat: add foo"' })
      expect(hits.find((h) => h.category === 'skip-verify')).toBeUndefined()
    })

    it('does not flag curl --no-verify-server-cert (false positive guard)', () => {
      // 防止 --no-verify 误匹配 --no-verify-server-cert (curl 实际存在的 flag)
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', {
        command: 'curl --no-verify-server-cert https://example.com',
      })
      expect(hits.find((h) => h.category === 'skip-verify')).toBeUndefined()
    })
  })

  describe('multi-class aggregation', () => {
    it('flags both force-push and push-to-main for git push -f origin main', () => {
      const d = createHighRiskDetector()
      const hits = d.detect('Bash', { command: 'git push -f origin main' })
      const cats = hits.map((h) => h.category)
      expect(cats).toContain('force-push')
      expect(cats).toContain('push-to-main')
    })
  })

  describe('non-Bash/Edit/Write tools are ignored', () => {
    it('Read is always allowed', () => {
      const d = createHighRiskDetector()
      expect(d.detect('Read', { path: '.git/HEAD' })).toHaveLength(0)
    })
    it('Glob is always allowed', () => {
      const d = createHighRiskDetector()
      expect(d.detect('Glob', { pattern: '.git/**' })).toHaveLength(0)
    })
  })
})