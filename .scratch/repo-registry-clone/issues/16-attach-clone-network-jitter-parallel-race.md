---
Status: ready-for-agent
Type: task
Created: 2026-08-16
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 无
ADR: docs/adr/0030-repo-registry-and-per-requirement-clone.md
Supersedes: 无
---

# Issue 16: attach 多 repo 并发 race + 网络抖动自愈(治本)

## 背景

用户实测关联多个仓库时两条 stderr:

```
错 1(multica, code 128):
  Cloning into '.../codebase/multica'...
  fatal: could not open '.../.git/objects/pack/tmp_pack_TqJOlV' for reading: No such file or directory
  fatal: fetch-pack: invalid index-pack output

错 2(open-design, code 124):
  Cloning into '.../codebase/open-design'...
```
错 2 的 stderr 只有「Cloning into」一行(5min 后被 SIGTERM 杀掉),错 1 的 stderr 在 tmp_pack 写入后找不到。

## 全局根因分析(实测复现)

```
attachRepos 用 Promise.allSettled 并行启动 N 个 git clone 进程
  ↓
每个 attachRepo 在 Node child_process 层开 2 个 OS 级 git 进程
  ↓
两个 HTTPS 大文件下载并发:
  - 在用户网络下实测 → 两个 clone 都卡住,3min 还没「Cloning into」完成
  - 用户日志 → sideband packet disconnect / invalid index-pack output
  ↓
createDefaultGitExec 5min timeout:
  - multica 失败得早(写入 tmp_pack 时网络抖动)→ code 128
  - open-design 排队等更久 → code 124(被 SIGTERM 杀掉)
```

**LANG/C 与中文路径不是根因**(实测 LANG=C clone multica 中文路径成功)。**真根因在「并发 clone」+「网络抖动」+「timeout 太短」三层叠加**。

issue 09-15 都在错误呈现层修了表象,没碰到这个真根因。

## 目标

**治本 4 个动作** 必须联动,任一单独都不治本:

| 层级 | 动作 | 治的是什么 |
|---|---|---|
| 业务编排 | `attachRepos` 改串行(`for...of` 显式 await) | 并发 race(根因 1) |
| 网络层 | `CodebaseManager.clone()` 包 retry-with-exponential-backoff | 网络抖动(根因 2) |
| 基础设施 | `createDefaultGitExec` timeout 5min → 15min + git config 加固 | timeout 太短(根因 3) |
| 进度反馈 | SSE 推送「retry 中...」文案 | 用户感知不到 retry 在跑(可观测性) |

## 子项

### 16.1 `createDefaultGitExec` 放宽 timeout + 协议加固

[`apps/agent/src/git/createDefaultGitExec.ts`](apps/agent/src/git/createDefaultGitExec.ts):

```typescript
const { stdout, stderr } = await exec('git', args, {
  encoding: 'utf8',
  timeout: 60_000 * 15, // Issue 16:5min → 15min(大仓库 10min+ 仍可完成)
  env: {
    ...process.env,
    LANG: 'C',
    LC_ALL: 'C',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
  },
})
```

不动 env 注入(issue 15 LANG=C 已经验过对中文路径无害)。

### 16.2 `createDefaultGitExec` git config 加固

每个 `git clone` 自动加 `-c protocol.version=2 -c core.precomposeUnicode=true -c http.postBuffer=524288000`:

```typescript
const args2 = [
  '-c', 'protocol.version=2',           // 减少 sideband packet 错位
  '-c', 'core.precomposeUnicode=true',   // macOS 必备(虽然默认开,但显式更稳)
  '-c', 'http.postBuffer=524288000',     // 500MB,避免大文件 push/clone 错位
  ...args,
]
```

- `protocol.version=2` 让 git 客户端用 v2 protocol,减少 fetch-pack sideband 错位概率
- `core.precomposeUnicode=true` 在 macOS 上强制 NFC → NFD 转换
- `http.postBuffer` 防止大 pack 写满默认 1MB buffer 时报 sideband 错位

### 16.3 `CodebaseManager.clone()` 包 retry-with-exponential-backoff

[`apps/agent/src/codebase/CodebaseManager.ts`](apps/agent/src/codebase/CodebaseManager.ts) `clone()` 第 1 步 git clone 调用前包 retry 循环:

```typescript
const MAX_RETRIES = 2
const BACKOFF_MS = [1000, 2000, 4000]

let cloneRes: GitExecResult | null = null
let lastCode: CloneErrorCodeT = RepoAttachErrorCode.E_INTERNAL

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  if (attempt > 0) {
    await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 4000))
    logger?.warn(
      { reqId, repoName, attempt, path: codebasePath },
      `clone: retry attempt ${attempt + 1}/${MAX_RETRIES + 1} after backoff`,
    )
  }
  try {
    cloneRes = await git(cloneArgs)
  } catch (err) {
    lastCode = RepoAttachErrorCode.E_INTERNAL
    continue
  }
  if (cloneRes.code === 0) break
  lastCode = mapCloneError(cloneRes.stderr)
  // 仅网络错重试;鉴权错/仓库不存在/磁盘满/分支冲突等都不重试
  if (lastCode !== RepoAttachErrorCode.E_NETWORK) break
}
// ... 用 cloneRes / lastCode 进入后续清理路径
```

**关键不变量**: 只重试 `E_NETWORK`(瞬态网络抖动)。鉴权错、仓库不存在、磁盘满、配置错误都不重试 —— 重试也错。

### 16.4 `RequirementService.attachRepos` 改串行

[`apps/agent/src/services/RequirementService.ts`](apps/agent/src/services/RequirementService.ts):

```typescript
async attachRepos(reqId, repoNames, branchName) {
  // 0. 注册表校验(不变)
  // 1.5 前置校验(不变)
  
  const results: AttachRepoResult[] = []
  // Issue 16:串行 —— 避免并发 git clone 网络 race
  // 取舍:N 个 repo 用户等 N×T,体感稳定可预测(每个都成功/失败清晰)
  for (const name of repoNames) {
    const r = await this.attachRepo(reqId, name, branchName)
    results.push(r)
  }
  
  // 3+ 持久化 / banner 状态机(不变)
  return results
}
```

### 16.5 SSE retry 文案

[`apps/agent/src/services/RequirementService.ts`](apps/agent/src/services/RequirementService.ts) `broadcastProgress` 新增 status:

`repo-clone-progress` 事件 status 字段当前 `'pending' | 'cloning' | 'ready' | 'failed'`。新增 `'retrying'`:

```typescript
// 在 attachRepo 内,clone 第 1 步失败 + 准备 retry 时
this.broadcastProgress(reqId, repoName, 'retrying',
  `网络抖动,第 ${attempt + 1} 次重试中...`,
)
```

SSE 端:
- `pending` → `cloning` → `retrying`(临时) → `cloning` → `ready` / `failed`
- 客户端 badge 显示「重试中...」(蓝色 spinner + 「第 N 次重试」文案)

issue 14 已经在前端用 `repoCloneStatuses` 渲染 badge,只需在 `CloneStatusBadge` 子组件加 `'retrying'` 状态分支。

## 验收清单

### 16.1 timeout 放宽
- [ ] `createDefaultGitExec` timeout 改为 `60_000 * 15`
- [ ] 单元测试:mock git 模拟 10min 耗时 → 不抛 SIGTERM timeout

### 16.2 协议加固
- [ ] 每次 git 调用 args 自动前插 `-c protocol.version=2 -c core.precomposeUnicode=true -c http.postBuffer=524288000`
- [ ] 单元测试:截获 git 调用 args,验证前 6 个元素是 3 个 `-c key=value` 对

### 16.3 retry-with-backoff
- [ ] `clone()` 第 1 步失败 + `E_NETWORK` → 自动重试 2 次,间隔 1s/2s
- [ ] `clone()` 第 1 步失败 + `E_AUTH` / `E_REPO_NOT_FOUND` / `E_DISK_FULL` → **不重试**
- [ ] `clone()` 抛错(`execFile reject`)→ 不重试(默认 E_INTERNAL)
- [ ] 单元测试:
  - mock git 第一次返 E_NETWORK、第二次返 ok → 最终 ok,共 2 次调用
  - mock git 3 次都返 E_NETWORK → 最终 E_NETWORK,共 3 次调用
  - mock git 第一次返 E_AUTH → 不重试,1 次调用

### 16.4 串行
- [ ] `attachRepos` 改 `for...of` 串行
- [ ] 单元测试:mock 3 个 repo,验证 `attachRepo` 调用是串行(2 完成 → 3 开始,非同时)

### 16.5 SSE retry 文案
- [ ] `broadcastProgress` 支持 `'retrying'` status
- [ ] `repo-clone-progress` SSE event 的 status 类型扩展(shared package)
- [ ] 前端 `CloneStatusBadge` 加 `'retrying'` 分支(橙色 spinner + 「第 N 次重试」)
- [ ] 单元测试:SSE 事件 status 序列含 `retrying`

### 16.6 整体
- [ ] `repos-attach-clone.e2e.test.ts` 现有测试全 GREEN(回归)
- [ ] 手动验证:用两个 ≥10MB 的 public repo 在低带宽网络下关联 → 两个都成功,无并发 race
- [ ] typecheck 干净
- [ ] 全测试套件 1238 passed 基础上 +新测试,无回归

## 风险

- **串行化 N 个 repo 总时间翻 N 倍**:可接受(关联是低频操作,< 10 次/用户/天)
- **retry 隐藏真实网络问题**:用户看不到「网络抖动」的告警,需要 log warn(已有)
- **15min timeout 对超大仓库仍不够**:未来可参数化(用户配置 per-repo timeout)
- **SSE retry 状态** 与现有的 `'pending' | 'cloning' | 'ready' | 'failed'` 序列兼容(临时态)

## 依赖

- 强依赖 shared package 的 `RepoCloneProgressStatus` 类型扩展
- 与 issue 14(in-flight + SSE badge)协同:`retrying` 状态直接接入现有 badge 渲染

## 不在范围

- 不改 HTTP 代理 / GitHub Token 配置(那是用户网络层)
- 不处理 partial-clone / sparse-checkout(后续 ADR 跟进)
- 不支持 per-repo 自定义 timeout(默认 15min 适用于 95% 仓库)
- 不改 git 协议层(SSH / GPG / submodule 等)

## 引用

- [PRD FR-3.1-3.9](../PRD.md#fr-3-需求关联--独立-clone)
- [ADR-0030 D3 / D5](../docs/adr/0030-repo-registry-and-per-requirement-clone.md)
- ADR-0031 (`E_BRANCH_EXISTS` 前置校验)
- Issue 09-15(已完成入口侧 / 启动期 / 出口 / 业务 / 错误呈现层修复 —— 本 issue 治本)
- Issue 14(`inFlight` + SSE badge —— `retrying` 状态直接复用 badge 渲染)