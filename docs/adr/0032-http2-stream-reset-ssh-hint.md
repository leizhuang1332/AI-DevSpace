# ADR-0032: HTTP/2 stream 失败时给用户"改用 SSH 地址"提示

**Status:** Accepted
**Date:** 2026-08-16
**Deciders:** 项目负责人
**Implements:** `.scratch/repo-registry-clone/issues/17-http2-stream-ssh-hint.md`
**关联 ADR:** [ADR-0030](0030-repo-registry-and-per-requirement-clone.md) D3 / 决策 107-110

---

## Context

用户在关联仓库时,真实环境(HTTPS 走代理 / 防火墙 / 反向代理)下 clone 偶发失败,stderr 形态:

```
RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly: CANCEL (err 8)
error: 1363 bytes of body are still expected
fetch-pack: unexpected disconnect while reading sideband packet
fatal: early EOF
fatal: fetch-pack: invalid index-pack output
```

### 现状问题

- 当前 [CodebaseManager.ts:670](apps/agent/src/codebase/CodebaseManager.ts#L670) `mapCloneError` 把这段归到 `E_NETWORK`(命中 `ECONNRESET` / `Connection (refused|reset)`)
- `E_NETWORK` 触发 [CodebaseManager.ts:326-354](apps/agent/src/codebase/CodebaseManager.ts#L326) retry 循环(1s+2s backoff 共 3 次)
- HTTP/2 GOAWAY / stream CANCEL 是**协议层硬错**,同 transport 重试大概率再错 → 浪费 3s+ 等待
- 前端 `CloneStatusBadge` 只显示「✗ 失败」,未提示有 workaround(SSH 走 git daemon 协议,绕开 HTTP/2 传输层)
- 用户卡在"clone 失败"的红色徽章,不知道换 SSH URL 可解

### 用户原始诉求

> 如果报 [上述 stderr] 错,明确向用户说明错误原因并提示改用 SSH 地址克隆(避开 HTTP 传输问题)

## Decision

### 1. 新增错误码 `E_HTTP2_STREAM_RESET`

- 加进 `RepoAttachErrorCode` 联合 + `PER_REPO_ERROR_CODES`([packages/shared/src/worktree.ts:91](packages/shared/src/worktree.ts#L91))
- 独立于 `E_NETWORK` —— 触发不同重试策略(见决策 2)+ 不同文案提示

### 2. 重试策略 = 0 次(fail-fast)

`E_HTTP2_STREAM_RESET` ≠ `E_NETWORK`,不命中 [CodebaseManager.ts:353](apps/agent/src/codebase/CodebaseManager.ts#L353) 重试条件,自动 fail-fast。理由:

- HTTP/2 stream 中断是协议层硬错,1s/2s 后大概率同样错
- 决策 47 自动 snapshot 机制允许用户主动重试,不应在错误路径无谓等 3s

### 3. 检测正则 = 仅 HTTP/2 流关键字,作用全 stderr

```ts
// CodebaseManager.ts mapCloneError 新分支(在 E_NETWORK 分支前)
if (
  /HTTP\/2 stream/.test(stderr) ||
  /curl \d+ HTTP\/2/.test(stderr)
) {
  return RepoAttachErrorCode.E_HTTP2_STREAM_RESET
}
```

**作用域 = 全 stderr**(不复用 `extractFatalLine` 的 fatal 末行),因为:

- `RPC failed; curl 92 HTTP/2 stream ...` 这一行**不**含 `fatal` 字样
- fatal 行是 `fatal: early EOF` / `fatal: fetch-pack: invalid index-pack output`,它们在下面
- 只看 fatal 末行会漏掉关键协议层证据,导致检测失效

**只匹配 HTTP/2 流关键字**(`HTTP/2 stream` / `curl \d+ HTTP\/2`),**不**扩展到 `early EOF` / `invalid index-pack` / `RPC failed`:

- 这些字眼常被通用 TCP 错(DNS 失败 / 路由器丢包)复用,扩展会误判
- 误判代价 > 漏判代价:漏判只是少一次 SSH 提示,误判让用户白折腾改 SSH URL

### 4. 错误消息 = 根因 + SSH workaround

[CodebaseManager.ts:368-387](apps/agent/src/codebase/CodebaseManager.ts#L368) 失败路径检测 `lastError.code === E_HTTP2_STREAM_RESET`,`message` 字段附加:

```
HTTP/2 stream 传输中断(常见于反向代理 / 防火墙场景):远程 Git 服务端
主动关闭了 HTTP/2 流。建议改用 SSH 地址克隆(如 git@github.com:owner/repo.git),
绕开 HTTP 传输层问题。去 /repos 页面修改 git URL 后重新关联。
```

完整 stderr 仍落 server log(决策 110 安全策略);前端只暴露 fatal 末行 + 这段 SSH 提示。

### 5. 前端 = 不新增 UI

`CloneStatusBadge` 显示「✗ 失败」不变;详细文案通过 SSE `repo-clone-progress` 事件 `error` 字段流传(已实现,无需新通道)。

理由:

- 「提示」诉求靠文字即可,不需要 button / modal / state 切换
- 用户手动去 `/repos` 改 URL 是低频操作(< 1 次/天),不值得为它加专门 UI
- 决策 17 Linear 紧凑型反对无意义 UI 加塞

## Consequences

### 正面

- 用户看到清晰根因 + 已知有效 workaround,而不是停在「✗ 失败」不知所云
- fail-fast 省 3s+ 失败等待
- HTTP/2 stream 与真网络错(`E_NETWORK`)在 retry / 文案上彻底分流

### 代价

- `RepoAttachErrorCode` 联合扩展 — 前端必须新增 case 处理(否则 fallback 到 E_INTERNAL 渲染);`mapCloneError` 多一条正则 — 测试需扩
- 全 stderr 匹配潜在误判风险(由"只匹配 HTTP/2 流关键字"控制)
- 用户需手动去 `/repos` 改 URL + 重新 attach(两步);自动改 URL + 重试(本 ADR 显式拒绝,见 Alternatives)

### 兼容性

- happy path 完全不变
- 旧测试无需改(新增错误码 + 新分支,既有命中不受影响)
- 未注入 `git` 的 RequirementService 测试场景零改动(本函数纯字符串匹配,与 git 无关)

## Alternatives Considered

### A. 复用 E_NETWORK,只在文案里嵌 SSH 提示

**否决:** HTTP/2 stream 错触发同 transport 重试 = 大概率再错,白白浪费 3s+;用户视角"3 秒后失败"比"立即失败 + SSH 提示"差太多。

### B. 自动派生 SSH URL(`git@github.com:owner/repo.git`)+ 复制按钮

**否决:**

- 派生仅对 github.com / gitlab.com / bitbucket.org 三家 well-known 形态简单,自建 git 主机(企业内网)URL 形态各异,派生可能错
- 派生错反而比"用户自己看"更糟
- 「粘贴 URL 到 /repos」本身是一次性动作,加复制按钮投入产出比低

### C. 一键自动改 SSH URL 并重试

**否决:**

- 跨多模块副作用:PUT /api/repos/:name 改 URL → 重触发 attach → meta.yaml 更新
- 触碰 `/repos` 编辑这种管理面副作用,跨工位影响大,不在本期范围
- 未来如要加,本期"明确文字提示"是必要前置(用户得知道为什么要自动改)

### D. 检测用 fatal 末行(沿用 `extractFatalLine`)

**否决:** `RPC failed; curl 92 HTTP/2 stream ...` 不含 `fatal` 字样,fatal 末行是 `fatal: fetch-pack: invalid index-pack output` —— 漏掉关键协议层证据,检测失效。

## 引用

- [ADR-0030 D3 / 决策 107-110](0030-repo-registry-and-per-requirement-clone.md)
- [Issue 17](../.scratch/repo-registry-clone/issues/17-http2-stream-ssh-hint.md)
- [CodebaseManager.ts:664 mapCloneError](../apps/agent/src/codebase/CodebaseManager.ts#L664)
- [CodebaseManager.ts:326-354 retry loop](../apps/agent/src/codebase/CodebaseManager.ts#L326)
- [CodebaseManager.ts:709 extractFatalLine](../apps/agent/src/codebase/CodebaseManager.ts#L709)
- [packages/shared/src/worktree.ts:91 RepoAttachErrorCode](../packages/shared/src/worktree.ts#L91)