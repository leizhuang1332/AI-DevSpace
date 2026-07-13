/**
 * toolClassifier tests —— ADR-0010 Q4 (P1 工具分类)
 *
 * 覆盖:
 *  - 写类工具名:Edit / Write / NotebookEdit
 *  - 读类工具名:Read / Grep / Glob
 *  - Bash 命令内容正则判断(保守策略:含 rm / > / git commit / git push / mv / cp / chmod 算写)
 *  - 未知工具名 → 保守按读处理(避免误阻塞)
 */

import { describe, it, expect } from 'vitest'
import { classifyTool } from '../worktree/toolClassifier.js'

describe('classifyTool', () => {
  describe('by name', () => {
    it('Edit is write', () => {
      expect(classifyTool('Edit', { file_path: '/tmp/x.java' })).toBe('write')
    })

    it('Write is write', () => {
      expect(classifyTool('Write', { file_path: '/tmp/x.java', content: 'hi' })).toBe('write')
    })

    it('NotebookEdit is write', () => {
      expect(classifyTool('NotebookEdit', { notebook_path: '/tmp/x.ipynb' })).toBe('write')
    })

    it('Read is read', () => {
      expect(classifyTool('Read', { file_path: '/tmp/x.java' })).toBe('read')
    })

    it('Grep is read', () => {
      expect(classifyTool('Grep', { pattern: 'foo', path: '/tmp' })).toBe('read')
    })

    it('Glob is read', () => {
      expect(classifyTool('Glob', { pattern: '**/*.ts' })).toBe('read')
    })

    it('unknown tool name defaults to read (conservative)', () => {
      expect(classifyTool('SomeNewTool', { anything: 1 })).toBe('read')
    })
  })

  describe('Bash command content', () => {
    it('ls is read', () => {
      expect(classifyTool('Bash', { command: 'ls -la /tmp' })).toBe('read')
    })

    it('cat is read', () => {
      expect(classifyTool('Bash', { command: 'cat /tmp/x.java' })).toBe('read')
    })

    it('git status is read', () => {
      expect(classifyTool('Bash', { command: 'git status' })).toBe('read')
    })

    it('git log is read', () => {
      expect(classifyTool('Bash', { command: 'git log --oneline -5' })).toBe('read')
    })

    it('rm is write', () => {
      expect(classifyTool('Bash', { command: 'rm /tmp/x.java' })).toBe('write')
    })

    it('mv is write', () => {
      expect(classifyTool('Bash', { command: 'mv a.txt b.txt' })).toBe('write')
    })

    it('cp is write (creates a destination file)', () => {
      expect(classifyTool('Bash', { command: 'cp a.txt b.txt' })).toBe('write')
    })

    it('chmod is write', () => {
      expect(classifyTool('Bash', { command: 'chmod 755 script.sh' })).toBe('write')
    })

    it('output redirection > is write', () => {
      expect(classifyTool('Bash', { command: 'echo hi > /tmp/x.txt' })).toBe('write')
    })

    it('git commit is write', () => {
      expect(classifyTool('Bash', { command: 'git commit -m "msg"' })).toBe('write')
    })

    it('git push is write', () => {
      expect(classifyTool('Bash', { command: 'git push origin feature' })).toBe('write')
    })

    it('write command with chained read is still write', () => {
      expect(classifyTool('Bash', { command: 'cat src.txt > out.txt' })).toBe('write')
    })

    it('empty command defaults to read (no write signal)', () => {
      expect(classifyTool('Bash', { command: '' })).toBe('read')
    })

    it('Bash without command field defaults to read', () => {
      expect(classifyTool('Bash', {})).toBe('read')
    })

    it('rm is detected even when surrounded by other tokens', () => {
      expect(classifyTool('Bash', { command: 'echo done && rm -rf /tmp/build' })).toBe('write')
    })
  })
})