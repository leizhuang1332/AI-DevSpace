---
Status: ready-for-agent
Type: task
Created: 2026-08-14
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 02, 03
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
---

# Issue 05: `createDefaultGitExec()` 强制 env 注入

## 目标

把 `apps/agent/src/worktree/WorktreeManager.ts` 里的 `createDefaultGitExec()` 移到 `apps/agent/src/git/createDefaultGitExec.ts`，**强制**注入 4 个环境变量到 `execFile` 的 `env` 选项，防止 git 在缺凭据时**交互挂死后台进程**。

## 子项

### 5.1 创建 `apps/agent/src/git/createDefaultGitExec.ts`

```typescript
import type { GitExec } from '../codebase/CodebaseManager.js'

/**
 * 默认的 GitExec —— 用 child_process.execFile 调系统 git。
 * 
 * 强制 env 注入（**关键** —— 否则缺凭据时 git 会交互挂死后台进程）：
 * - GIT_TERMINAL_PROMPT=0  → 关闭交互式 credential prompt
 * - GIT_ASKPASS=""         → 关闭自动 askpass 唤起
 * - SSH_ASKPASS=""         → 同上（SSH 路径）
 * - GIT_TERMINAL_PROMPT    → 让 `git ls-remote` / `git clone` 在网络/认证错时快速失败为 E_AUTH / E_NETWORK，
 *                            而不是僵在 stdin 等待输入
 */
export function createDefaultGitExec(): GitExec {
  return async (args) => {
    const { execFile } = await import('node:child_process')
    const exec = (await import('node:util')).promisify(execFile)
    try {
      const { stdout, stderr } = await exec('git', args, {
        encoding: 'utf8',
        timeout: 60_000 * 5,  // 5 分钟上限（clone 大仓库超时）
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
        },
      })
      return { code: 0, stdout, stderr }
    } catch (err) {
      const e = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; signal?: string }
      // 超时（killed + signal SIGTERM）
      if (e.killed && e.signal === 'SIGTERM') {
        return {
          code: 124,  // 沿用 `timeout` 命令的退出码
          stdout: e.stdout ?? '',
          stderr: e.stderr ?? `git ${args[0]} timed out after 5m`,
        }
      }
      return {
        code: typeof e.code === 'number' ? e.code : 1,
        stdout: e.stdout ?? '',
        stderr: e.stderr ?? String(err),
      }
    }
  }
}
```

### 5.2 测试

#### 5.2.1 单元测试（env 注入）

```typescript
test('createDefaultGitExec injects non-interactive env', async () => {
  const git = createDefaultGitExec()
  const capturedEnv = await captureExecFileEnv(git)
  expect(capturedEnv.GIT_TERMINAL_PROMPT).toBe('0')
  expect(capturedEnv.GIT_ASKPASS).toBe('')
  expect(capturedEnv.SSH_ASKPASS).toBe('')
})
```

#### 5.2.2 行为测试（无凭据时不挂死）

```typescript
test('clone to fake private repo returns E_AUTH quickly, not hangs', async () => {
  const git = createDefaultGitExec()
  const start = Date.now()
  const result = await git(['clone', 'git@github.com:does-not-exist/private.git', '/tmp/test'])
  const elapsed = Date.now() - start
  expect(elapsed).toBeLessThan(15_000)  // 15 秒内必返
  expect(result.code).not.toBe(0)
  // stderr 必含 'Could not resolve host' 或 'Permission denied'，不该是空白（挂死的表现）
  expect(result.stderr.length).toBeGreaterThan(0)
}, 30_000)
```

#### 5.2.3 旧引用清理

- `apps/agent/src/worktree/WorktreeManager.ts:createDefaultGitExec` 删除（被 issue 03 整体删除覆盖）
- 全仓 grep `createDefaultGitExec` → 新引用全部指 `apps/agent/src/git/createDefaultGitExec.ts`

## 验收清单

- [ ] `apps/agent/src/git/createDefaultGitExec.ts` 文件创建
- [ ] 4 个环境变量全部注入（`GIT_TERMINAL_PROMPT=0` / `GIT_ASKPASS=""` / `SSH_ASKPASS=""` / 保留其他 `process.env`）
- [ ] 5 分钟超时（`timeout: 60_000 * 5`），超时返 `code: 124`
- [ ] 行为测试：clone 不存在的私有不挂死（15 秒内返）
- [ ] 旧 `WorktreeManager.createDefaultGitExec` 已删
- [ ] 所有引用 `import` 路径更新

## 风险

- 用户**故意**设置了 `GIT_ASKPASS=/path/to/my-askpass.sh`（让 git 在密码错时弹 GUI）——本改动会覆盖它。
  - **缓解**：本期明确不做「尊重用户 askpass 配置」；issue 落 ADR-0030 后这是**已知破坏性**。若以后有用户报怨，再起 ADR 加白名单
- Windows 上 `execFile` 的 `env` 注入若 `process.env` 含 `PATH` 等关键变量，必须保留——上面用 `{...process.env, ...强制}` 已覆盖

## 引用

- [PRD FR-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3 凭据段](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- [decisions.md Q9 / C5](../decisions.md)
