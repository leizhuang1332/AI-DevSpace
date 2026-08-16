---
Status: ready-for-agent
Type: task
Created: 2026-08-16
Feature: repo-registry-clone
Parent: .scratch/repo-registry-clone/PRD.md
Blocked by: 无
Blocks: 无
ADR: docs/adr/0032-http2-stream-reset-ssh-hint.md
Supersedes: 无
---

# Issue 17: HTTP/2 stream 失败 → SSH 提示

## 背景

用户实测关联仓库,git clone 报如下错:

```
RPC failed; curl 92 HTTP/2 stream 5 was not closed cleanly: CANCEL (err 8)
error: 1363 bytes of body are still expected
fetch-pack: unexpected disconnect while reading sideband packet
fatal: early EOF
fatal: fetch-pack: invalid index-pack output
```

常见于 HTTPS 走反向代理 / 防火墙场景。SSH 走 git daemon 协议,绕开 HTTP/2 传输层,**实测可解**(用户原始诉求)。

## 现状

- 当前 [apps/agent/src/codebase/CodebaseManager.ts:670](apps/agent/src/codebase/CodebaseManager.ts#L670) `mapCloneError` 把这段归到 `E_NETWORK`(命中 `ECONNRESET` / `Connection (refused|reset)`)
- `E_NETWORK` 触发 [CodebaseManager.ts:326-354](apps/agent/src/codebase/CodebaseManager.ts#L326) retry 循环(1s+2s backoff 共 3 次)
- HTTP/2 GOAWAY / stream CANCEL 是**协议层硬错**,同 transport 重试大概率再错 → 浪费 3s+ 等待
- 前端 `CloneStatusBadge` 只显示「✗ 失败」,未提示有 workaround

## 目标

1. 新增错误码 `E_HTTP2_STREAM_RESET`,与 `E_NETWORK` 解耦(独立 retry 策略 + 独立文案)
2. 检测正则 = 仅 HTTP/2 流关键字,作用全 stderr
3. 重试 = 0 次(fail-fast)
4. 错误 message 附加根因 + SSH workaround(用户去 `/repos` 改 git URL)

## 改动清单

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/shared/src/worktree.ts:91` | `RepoAttachErrorCode` 加 `E_HTTP2_STREAM_RESET`;`PER_REPO_ERROR_CODES` 加新 member |
| 2 | `apps/agent/src/codebase/CodebaseManager.ts:664` | `mapCloneError` 新分支:`/HTTP\/2 stream/` `/curl \d+ HTTP\/2/` 命中全 stderr → 返 `E_HTTP2_STREAM_RESET`(在 E_NETWORK 分支前) |
| 3 | `apps/agent/src/codebase/CodebaseManager.ts:368-387` | 失败路径检测 `lastError.code === E_HTTP2_STREAM_RESET`,`message` 字段附加 SSH 提示文案 |
| 4 | `apps/agent/src/__tests__/codebase/CodebaseManager.test.ts` | 加 `mapCloneError` 测试:用户报错原文 5 行合并输入 → `E_HTTP2_STREAM_RESET`;E_NETWORK 命中关键字不复用此码 |
| 5 | 前端 | 无改动(SSE `repo-clone-progress` 事件 `error` 字段已流过) |

## 验收

- [ ] `mapCloneError` 接受用户报错原文(完整 5 行)→ 返 `E_HTTP2_STREAM_RESET`
- [ ] `mapCloneError` 接受纯 `Connection refused`(无 HTTP/2 关键字)→ 仍返 `E_NETWORK`(不误判)
- [ ] `RepoAttachErrorCode.E_HTTP2_STREAM_RESET` 在 PER_REPO_ERROR_CODES 联合里(供 `AttachRepoResultSchema` Zod 校验通过)
- [ ] clone 失败 message 含 "改用 SSH" 字样 + 路径提示
- [ ] `agent` 端 `pnpm test` 通过
- [ ] `pnpm tsc --noEmit` 通过

## 不做

- 自动派生 SSH URL + 复制按钮(企业内网 git 主机 URL 形态各异,派生易错)
- 一键自动改 SSH URL 并重试(跨模块副作用,投入产出比低)
- 检测扩展到 `early EOF` / `invalid index-pack`(误判风险,SSH 也可能同网络断)