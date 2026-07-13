/**
 * sessionPaths tests —— ADR-0010 Q7.2 路径约定
 *
 * 覆盖:
 *  - sessionDirFor / metaPathFor / messagesPathFor 纯拼接
 *  - findSessionDir 扫描各 req 的 sessions/<localSid> 目录定位
 *  - 跨 req 定位、找不到返回 null、无 requirements 目录不炸
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sessionDirFor,
  metaPathFor,
  messagesPathFor,
  logPathFor,
  findSessionDir,
} from '../session/sessionPaths.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aidev-paths-'))
})

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('sessionPaths pure joins', () => {
  it('sessionDirFor 拼出 requirements/<req>/sessions/<sid>', () => {
    const dir = sessionDirFor(root, 'REQ-1', 'sid-abc')
    expect(dir).toBe(join(root, 'requirements', 'REQ-1', 'sessions', 'sid-abc'))
  })

  it('metaPathFor / messagesPathFor 落在 session 目录下', () => {
    expect(metaPathFor(root, 'REQ-1', 'sid-abc')).toBe(
      join(root, 'requirements', 'REQ-1', 'sessions', 'sid-abc', 'meta.yaml'),
    )
    expect(messagesPathFor(root, 'REQ-1', 'sid-abc')).toBe(
      join(root, 'requirements', 'REQ-1', 'sessions', 'sid-abc', 'messages.jsonl'),
    )
  })

  it('logPathFor 落在 session 目录下', () => {
    expect(logPathFor(root, 'REQ-1', 'sid-abc')).toBe(
      join(root, 'requirements', 'REQ-1', 'sessions', 'sid-abc', 'log.jsonl'),
    )
  })
})

describe('findSessionDir scan', () => {
  it('在正确的 req 下定位 session 目录', () => {
    mkdirSync(sessionDirFor(root, 'REQ-A', 'sid-1'), { recursive: true })
    mkdirSync(sessionDirFor(root, 'REQ-B', 'sid-2'), { recursive: true })

    const hit = findSessionDir(root, 'sid-2')
    expect(hit).toEqual({
      reqId: 'REQ-B',
      dir: sessionDirFor(root, 'REQ-B', 'sid-2'),
    })
  })

  it('找不到返回 null', () => {
    mkdirSync(sessionDirFor(root, 'REQ-A', 'sid-1'), { recursive: true })
    expect(findSessionDir(root, 'nope')).toBeNull()
  })

  it('requirements 目录不存在时返回 null 而非抛错', () => {
    expect(findSessionDir(root, 'sid-1')).toBeNull()
  })
})
