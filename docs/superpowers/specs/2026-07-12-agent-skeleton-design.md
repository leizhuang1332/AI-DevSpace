# 03 - Agent 守护进程骨架（HTTP + SSE + 鉴权 + 保活）设计 spec

**日期**：2026-07-12
**关联 issue**：[`.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md`](../../../.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md)
**关联 ADR**：
- [ADR-0001 混合形态 — Web 工作台 + 本地 Agent 守护进程](../../../docs/adr/0001-hybrid-web-agent-architecture.md)（2026-07-09 修订为 SSE）
- [ADR-0010 Claude Code SDK 集成设计](../../../docs/adr/0010-claude-code-sdk-integration.md)（Q10.2 SSE channel、Q9 provider 集成预留）
**关联决策**：CONTEXT.md 决策 31（SSE）、决策 34（动态 Token）、决策 35（`apps/agent/src/providers/` 目录）
**关联设计契约**：[`.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md`](../../../.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md) §Token（EventSource 受限 + Cookie 方案）
**阶段**：MVP 阶段 1 — 地基（与 issue 02 同阶）
**前置依赖**：[issue 02 — 工作空间目录初始化](./2026-07-10-workspace-init-design.md)

---

## 1. 目标

让 Agent 守护进程从 issue 02 结束时的「Fastify + /api/health + workspace」状态进化为「鉴权 + 路由骨架 + 一条 SSE 长连通道 + 进程保活 + 健康检查 + 文件日志」的完整骨架，使后续 issue 05/06/08 能在不重写基础设施的前提下平行落地。

落地决策 31（SSE）与决策 34（动态 Token）；落地 ADR-0001 的混合形态协议侧；为 ADR-0010 Q10.2 预留 `SseHub.publish(reqId, event)` 接入点。

**不**实现的（明确 out of scope）：Skill 真实执行、Requirement 真实 CRUD、SDK 调用、AIEvent → SSE 桥接 —— 这些交由 issue 05/06/08。

---

## 2. 范围

### In scope（本期实现）

1. **鉴权 Fastify plugin**：
   - 路径白名单：`/api/health`、`/api/agent/bootstrap`
   - Cookie `aidevspace_token` 优先，回退 header `X-AIDevSpace-Token`，均不合 → 401 `unauthorized`
   - `Origin` 头若存在必须 ∈ `{http://localhost:3333, http://127.0.0.1:3333}`，否则 403 `origin_not_allowed`
   - 用 `crypto.timingSafeEqual` 防计时攻击
2. **Token 管理**：
   - 路径 `~/.aidevspace/.agent-token`，32 字节随机 base64url（长度 43）
   - Agent boot 时 `TokenManager.ensure()`；首次 `fs.openSync(O_CREAT|O_EXCL, 0o600)` 原子生成
   - 权限异常（mode > 0600）→ 仅 warn log，不阻塞启动
   - 本期不轮换
3. **`/api/agent/bootstrap`**（白名单）：
   - GET 一份 `{token, cookieName, cookieAttributes, apiBase, agentVersion, sseNote}` 全文
   - 主用途：Web SSR 不能保证读到本机 token 文件时的兜底通道；CLI / 调试脚本可独立调
4. **5 条 requirement 路由 501 占位**：
   - `POST /api/requirement` → `error:'not_implemented', feature:'requirement.create', issue:'05'`
   - `GET /api/requirements`
   - `GET /api/requirement/:id`
   - `PATCH /api/requirement/:id`
   - `POST /api/requirement/:id/skill`
   - 响应形状由 `packages/shared/src/api.ts` 导出 Zod schema，Web 与 Agent 共用
5. **SSE 通道**：
   - `GET /api/requirement/:id/events`（鉴权后）
   - 响应头 `Content-Type: text/event-stream`、`Cache-Control: no-cache, no-transform`、`Connection: keep-alive`、`X-Accel-Buffering: no`
   - 首条 `hello` 事件 + 每 30 秒 `heartbeat` 事件；本期无业务事件
   - 客户端断连 → 清理 listener；server onClose → 清空所有订阅
6. **`SseHub`**（`apps/agent/src/sse/SseHub.ts`）：
   - `Map<reqId, Set<Listener>>` + `setInterval(heartbeat, 30_000)`（仅在有人订阅时启用）
   - public `subscribe(reqId, listener) => unsubscribe`、`publish(reqId, event)`、`close()`、`stats()`
   - 事件类型联合（在 `packages/shared/src/sse.ts`）`{ type:'hello' } | { type:'heartbeat' } | { type:'placeholder' }`，扩展位留给 issue 06
7. **健康检查**：
   - `/api/health` 不需鉴权
   - 字段：`ok, service, version, bootTime, workspace{root,exists,configOk}, auth{tokenPresent,tokenFileMode,originAllowlist}, sse{hubSubscribers}, log{level,file}`
   - `ok=false` 时仍 200，附 `failed[]` 字段
8. **日志 dual-sink**：
   - Pino 默认 stdout + `pino/file` 追加到 `~/.aidevspace/logs/agent.log`
   - 轮转本期不做；超 50 MB 仅启动 warn
9. **进程保活**（macOS + Linux，Windows 不支持）：
   - `packages/scripts/agent-start.sh`：nohup 启动 → 写 PID 到 `~/.aidevspace/.agent.pid`
   - `packages/scripts/agent-stop.sh`：`kill $(cat pid)`，超时 5s 后 `kill -9`
   - `packages/scripts/agent-watch.sh`：daemon 形态，每 5s `kill -0 $PID`；不在则调 start.sh
   - 不互相守护（避免裂脑）
10. **共享契约**：
    - `packages/shared/src/api.ts` —— Zod schema + TS 类型
    - `packages/shared/src/sse.ts` —— 事件类型联合
    - `packages/shared/src/error.ts` —— 统一错误形状 `{error, message?, details?}`
11. **测试**：TDD red→green，覆盖 §6 测试矩阵列出的所有文件
12. **顶层 root scripts**：`pnpm agent:start`、`pnpm agent:stop`、`pnpm agent:watch`、`pnpm agent:status`

### Out of scope（本期不做，明确）

- Skill 真实执行（issue 08 系列：08 / 08a / 08b / 08c / 08d）
- Requirement 真实 CRUD（issue 05）
- SDK 调用、AIEvent → SseEvent 桥接（issue 06）
- Per-session SSE channel（ADR-0010 Q10.2 的 N 通道远景，等 issue 06 落地时实现）
- Token 主动 rotate / 多设备 / 多 user
- Logrotate / 监控告警
- Windows 平台支持（Bash 4+ 脚本，README 注明）
- Logrotate；超 50MB 仅 warn
- Request body 大小限制 / rate limit（后续 security issue）

---

## 3. 进程拓扑与 boot 顺序

### 进程拓扑

```
┌──────────────────────────┐        ┌──────────────────────────┐
│       Web (issue 04)     │  HTTP  │       Agent (issue 03)   │
│  Next.js 14, :3333       │◀──────▶│  Fastify 5, :7777        │
│  fetch + EventSource     │  REST  │  + auth + SseHub         │
│  + cookie: a..._token    │  + SSE │                          │
└──────────────────────────┘        └────────┬─────────────────┘
                                              │ every 5s
                                              │ kill -0 $PID
                                              ▼
                                     ┌──────────────────────────┐
                                     │   Agent Watcher (sh)     │
                                     │   while true; do …       │
                                     │   nohup start.sh if dead │
                                     └──────────────────────────┘
```

- **Web（`:3333`）**：不在本期实现，但接口契约按 issue 04 的 SSR + cookie 假设设计
- **Agent（`:7777`）**：Fastify 单进程，本期所有逻辑在此
- **Agent Watcher**：第二进程，仅做存活探测 + 重拉；自身崩溃不互相守护
- **Token 文件 `~/.aidevspace/.agent-token`**：Agent 读 / 写；Web SSR 读；CLI 通过 bootstrap 读
- **PID 文件 `~/.aidevspace/.agent.pid`**：start.sh 写、watcher 读、stop.sh 读
- **日志文件 `~/.aidevspace/logs/agent.log`**：pino/file 追加写；外部 logrotate 后续

### Agent boot 顺序（`apps/agent/src/server.ts` → `buildServer()`）

1. **TokenManager.ensure()**：检查 `~/.aidevspace/.agent-token`，缺则原子生成；权限异常 warn
2. **注册 Fastify plugins**：cors（已存在）→ request-id → auth → log（dual sink）→ sse 装饰
3. **WorkspaceService**：调用 `boot init`（沿用 issue 02 行为）
4. **注册 routes**：health → workspace → bootstrap → requirement → events
5. **listen `{ port: 7777, host: '0.0.0.0' }`**
6. **写 PID 文件 `~/.aidevspace/.agent.pid`**（在 `isMain` 块；非 main 测试环境跳过）

### 进程间契约

- Agent ↔ Web：HTTP REST + SSE（决策 31）
- Agent ↔ Watcher：`~/.aidevspace/.agent.pid` 单向写入 + 文件 lock 由 Agent 自身提供（`fs.openSync(pid_path, 'w')` 返回 fd，stop 时释放）
- Agent ↔ SDK：本期不连；ADR-0010 Q3/Q4/Q10 推进时由 issue 06 引入

---

## 4. REST 路由表（含鉴权）

| 方法 + 路径 | 处理函数 | 鉴权 | 本期响应 | 后续 |
|---|---|---|---|---|
| `GET /api/health` | `HealthService.collect()` | ❌ | 见 §7 | 长期 |
| `GET /api/workspace` | `workspaceService.getWorkspaceInfo()` | ✅ | 真实（沿用 02） | 02 |
| `PATCH /api/workspace/config` | `workspaceService.updateConfig()` | ✅ | 真实（沿用 02） | 02 |
| `GET /api/agent/bootstrap` | `bootstrapRoute` | ❌ | `{ok,token,cookieName,cookieAttributes,apiBase,agentVersion,sseNote}` | 长期 |
| `POST /api/requirement` | `requirementRoutes.create` | ✅ | 501 `feature:'requirement.create'` | 05 |
| `GET /api/requirements` | `requirementRoutes.list` | ✅ | 501 `feature:'requirement.list'` | 05 |
| `GET /api/requirement/:id` | `requirementRoutes.detail` | ✅ | 501 `feature:'requirement.detail'` | 05 |
| `PATCH /api/requirement/:id` | `requirementRoutes.update` | ✅ | 501 `feature:'requirement.update'` | 05 |
| `POST /api/requirement/:id/skill` | `requirementRoutes.runSkill` | ✅ | 501 `feature:'requirement.run_skill'` | 05 + 08 |
| `GET /api/requirement/:id/events` | `sseRoute.subscribe` | ✅（cookie 优先） | 流式 SSE（见 §5） | 长期 |

### 501 占位响应统一形状

```json
{
  "error": "not_implemented",
  "feature": "requirement.create",
  "message": "本期骨架仅占位；真实实装见 issue 05 / 08",
  "issue": "05"
}
```

来自 `packages/shared/src/error.ts` 的 Zod schema `NotImplementedError`，Web 端可识别做"未实装"提示。

### 错误响应统一形状

- Fastify `setErrorHandler`：所有 throw 都被包成 `{error:'<snake_case>', message?, details?}`
- 401 `unauthorized` 来自 auth plugin；403 `origin_not_allowed` 来自 auth plugin；500 `internal` 来自 error handler
- 4xx 阶段不做 rate limit；后续 security issue

---

## 5. SSE 通道与 SseHub

### SseHub 形态（`apps/agent/src/sse/SseHub.ts`）

```ts
import type { SseEvent } from '@ai-devspace/shared'

export type Unsubscribe = () => void

export interface SseHub {
  subscribe(reqId: string, onEvent: (e: SseEvent) => void): Unsubscribe
  publish(reqId: string, event: SseEvent): void
  close(): Promise<void>
  stats(): { subscribers: number }
}

export function createSseHub(opts?: { heartbeatMs?: number }): SseHub {
  const channels = new Map<string, Set<(e: SseEvent) => void>>()
  let heartbeatTimer: NodeJS.Timeout | null = null
  // ...
}
```

- `Map<reqId, Set<Listener>>` 主存储
- `setInterval(heartbeat, 30_000)` 仅在 `totalSubscribers > 0` 时启用；归零后 `clearInterval`
- `close()` 清空所有订阅并停 heartbeat（Fastify `onClose` hook 调用）

### 事件类型（`packages/shared/src/sse.ts`）

```ts
export type SseEvent =
  | { type: 'hello'; sid: string; reqId: string; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }

export const SSE_HEARTBEAT_MS = 30_000
```

后续 issue 06 扩展：`{type:'ai.text',...}`、`{type:'ai.tool_use',...}`、`{type:'skill.start',...}` 等。

### `GET /api/requirement/:id/events` 路由（`apps/agent/src/sse/requirementEventsRoute.ts`）

```ts
export async function sseRoutes(app: FastifyInstance, deps: { hub: SseHub }) {
  app.get('/api/requirement/:id/events', async (req, reply) => {
    const reqId = (req.params as { id: string }).id
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.setHeader('X-Accel-Buffering', 'no')
    reply.hijack()

    const sid = randomUUID()
    const write = (e: SseEvent) => {
      reply.raw.write(`event: ${e.type}\n`)
      reply.raw.write(`data: ${JSON.stringify(e)}\n\n`)
    }
    write({ type: 'hello', sid, reqId, ts: Date.now() })

    const unsub = deps.hub.subscribe(reqId, write)
    const onClose = () => unsub()
    reply.raw.on('close', onClose)
  })
}
```

- 客户端断连 → `reply.raw.on('close')` 触发 unsubscribe
- server onClose → `hub.close()` 清所有
- `:id` 本期不做"该 reqId 是否存在"校验（501 阶段整个 requirement 都未实装），issue 05 落地后由 schema 校验 + 401 化

### 浏览器 `EventSource` 受限解决

浏览器 `EventSource(url)` **不支持**自定义 header。Web 端在 `useEffect` 写一次 cookie 后：

```ts
new EventSource('/api/requirement/REFUND-001/events', { withCredentials: true })
```

- 浏览器同源请求会自动带 `Cookie: aidevspace_token=...`
- Agent 走 cookie 鉴权路径
- CORS 已 `origin: ALLOWED_ORIGINS, credentials: true`，不需要另设 `Access-Control-Allow-Origin: *`

---

## 6. Token / Cookie / Origin 鉴权

### Token 文件

- 路径：`~/.aidevspace/.agent-token`
- 格式：32 字节随机 → base64url（无 padding）→ 长度 43
- 生成：`crypto.randomBytes(32).toString('base64url')`
- 写入：`fs.openSync(path, 'w', 0o600)`，先 `O_CREAT|O_EXCL` 防止覆盖
- 读：`fs.readFileSync(path, 'utf8')`，启动期一次缓存
- 匹配：`crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(cached))`，长度不等先 401

### 鉴权 plugin（`apps/agent/src/auth/authPlugin.ts`）

```ts
export interface AuthPluginDeps {
  tokenManager: TokenManager
  allowedOrigins: string[]
}

export async function authPlugin(fastify: FastifyInstance, deps: AuthPluginDeps) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.routeOptions.config?.public) return  // 白名单直通

    const cookieTok = readCookie(req.headers.cookie, 'aidevspace_token')
    const headerTok = typeof req.headers['x-aidevspace-token'] === 'string'
      ? req.headers['x-aidevspace-token'] : null
    const candidate = cookieTok ?? headerTok
    if (!candidate || !safeEq(candidate, deps.tokenManager.get())) {
      return reply.code(401).send({ error: 'unauthorized' })
    }

    const origin = req.headers.origin
    if (origin && !deps.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed', origin })
    }
  })
}
```

- `readCookie`：`req.headers.cookie` 解析 `name=value; name2=value2`，取 `aidevspace_token`
- `safeEq`：`crypto.timingSafeEqual`，长度不等先返回 false
- 白名单（`req.routeOptions.config.public = true`）由路由定义处显式声明，不靠路径前缀匹配

### `/api/agent/bootstrap`

`GET /api/agent/bootstrap`（白名单）响应：

```json
{
  "ok": true,
  "token": "<plaintext-43-chars>",
  "cookieName": "aidevspace_token",
  "cookieAttributes": { "SameSite": "Strict", "Path": "/", "MaxAge": 2592000 },
  "apiBase": "http://localhost:7777",
  "agentVersion": "0.0.0",
  "sseNote": "EventSource 不能带自定义 header；浏览器侧通过 SameSite=Strict cookie 鉴权"
}
```

- 实测生产用户基本不会主动访问；存在目的：
  1. CLI / 调试脚本能独立取 token（不依赖读本机文件）
  2. 测试能稳定验证 token 形状
  3. 跨设备调试（同一局域网内另一台机器访问）有兜底通道

### Token 不轮换

文件存在则不轮换；UI 不暴露"重置 token"按钮；切到下一 issue 想加"主动 rotate"再加（不在本期）。

---

## 7. 健康检查与日志

### `/api/health` 响应形状

```json
{
  "ok": true,
  "service": "agent",
  "version": "0.0.0",
  "bootTime": "2026-07-12T08:30:00.000Z",
  "workspace": {
    "root": "/Users/Ray/.aidevspace",
    "exists": true,
    "configOk": true
  },
  "auth": {
    "tokenPresent": true,
    "tokenFileMode": "0600",
    "originAllowlist": ["http://localhost:3333", "http://127.0.0.1:3333"]
  },
  "sse": { "hubSubscribers": 0 },
  "log": {
    "level": "info",
    "file": "/Users/Ray/.aidevspace/logs/agent.log"
  }
}
```

`ok=false` 时：`{ ok:false, failed: ['workspace.missing', 'token.missing'], ...同样的字段 }`，HTTP 仍 200。

聚合规则：
- workspace 初始化未成功 → `workspace.configOk=false`
- token 文件不存在 → `auth.tokenPresent=false`
- 日志文件无法 append（writability 探测）→ `log.file` 字段缺失 + `failed.push('log.unwritable')`

### 日志策略

- 库：`pino`（Fastify 5 默认 logger）
- 配置：dual sink —— stdout + `pino/file` 追加到 `~/.aidevspace/logs/agent.log`
- 级别：`process.env.LOG_LEVEL ?? 'info'`（保留现有 server.ts 行为）
- 字段：Fastify 自带 `reqId, level, time, msg, ...`
- 轮转：**本期不做**。超 50 MB 启动时 `fastify.log.warn`，提示用户后续加 logrotate / 换 pino-roll
- 文件创建：首次写入时 `fs.mkdirSync(dir, {recursive: true})`，由 `pino/file` transport 内部完成

---

## 8. 进程保活脚本

### 文件清单（`packages/scripts/`）

| 文件 | 行为 | 平台 |
|---|---|---|
| `agent-start.sh` | nohup 启动 + 写 PID + 等端口 listen（≤ 10s 超时） | macOS, Linux |
| `agent-stop.sh` | `kill $(cat $PID)`，≤ 5s 优雅 / `kill -9` | macOS, Linux |
| `agent-watch.sh` | `while sleep 5; do kill -0 $PID \|\| agent-start.sh; done` | macOS, Linux |
| `agent-status.sh` | `cat $PID` + `kill -0 $PID` 输出 alive/dead | macOS, Linux |

### 跨平台边界

- 所有脚本头部 `#!/usr/bin/env bash` + `set -euo pipefail`
- macOS / Linux 通用；Windows **不支持**，README 注明「Windows 用户请用 WSL 或后续 issue 引入 PowerShell 脚本」
- Bash 4+ 要求（在 macOS 默认 bash 3.2 上需 `brew install bash`；本期不强制升级）

### 与 dev 模式共存

- `pnpm dev:agent`（已存在，tsx watch）与 watcher **不并行跑**
  - dev 模式 watcher 没意义，tsx 自己有 hot-reload
  - 检测：start.sh 检查 `DEV_AGENT=1` 环境变量，存在则自跳过 watcher 启动
- `pnpm agent:start` 是面向终端用户的入口，调用 start.sh，再启 watcher

### 错误处理

- Agent 进程崩：watcher 5s 内重拉（start.sh 幂等：先 stop 后 start）
- 之前 crash 的 log 保留在 `agent.log`，下次启动可对照
- Watcher 自己崩：用户手动 `pnpm agent:watch` 起一次；不做"保 watcher 的 watcher"
- CORS / Auth plugin throw：Fastify 默认 500；`setErrorHandler` 包成 `{error:'internal', message}`，不泄露 stack

---

## 9. 测试策略

### 测试基线

- TDD 红 → 绿（沿用 issue 01 / 02 风格）
- vitest 2.x（已配置）
- fastify.inject + supertest-fetch（已有 chain）

### 测试矩阵

| 测试文件 | 覆盖 |
|---|---|
| `services/TokenManager.test.ts` | ensure 生成 / 已存在不覆盖 / mode 0666 warn / 内容长度 = 43 |
| `auth/authPlugin.test.ts` | 401 缺 token / 401 token 错 / 401 cookie path 不匹配 / 401 SSE 用 cookie OK / 403 Origin 不在白名单 / OK X-AIDevSpace-Token |
| `sse/SseHub.test.ts` | subscribe→publish→listener 收 / unsubscribe 收不到 / 多订阅者 fan-out / heartbeat 仅在有人订阅时启停（fake timers）|
| `routes/requirement.test.ts` | 5 条路由全部 501 占位形状对（含 error / feature / message 字段）|
| `routes/events.test.ts` | `text/event-stream` 头 + `hello` 事件 + 30s `heartbeat`；客户端 abort 后 listener 清理 |
| `routes/health.test.ts` | ok 字段聚合 / workspace 缺失 ok=false / token 缺失 ok=false |
| `routes/bootstrap.test.ts` | GET 一次拿到 token / 第二次拿到相同（不轮换） |
| `e2e/agent-skeleton.e2e.test.ts` | 起真 instance，`GET /api/requirement/REFUND-001/events` 流式监听 3s 内拿到 hello + 至少一次 heartbeat（fake timers） |

### 测试隔离

- `~/.aidevspace` 测试用 `os.tmpdir()/.aidevspace-test-<rand>` mock
- `TokenManager` 提供 setter `setRootForTest()`
- `SseHub` 提供工厂注入 fake timers，不真等 30s
- 日志文件不写：测试时 pino level = silent 或切到 memory sink

---

## 10. 共享契约（`packages/shared/`）

### 新增文件

```
packages/shared/src/
├── api.ts          # RequirementBootstrap / NotImplemented / Routes 等 Zod schemas
├── sse.ts          # SseEvent 联合类型 + SSE_HEARTBEAT_MS 常量
├── error.ts        # ApiError 形状 + NotImplementedError schema
└── index.ts        # 汇总 re-export
```

### 类型清单（精简）

```ts
// api.ts
export const NotImplementedError = z.object({
  error: z.literal('not_implemented'),
  feature: z.string(),
  message: z.string(),
  issue: z.string(),   // '05' / '08' 等
})
export type NotImplementedError = z.infer<typeof NotImplementedError>

// sse.ts
export type SseEvent =
  | { type: 'hello'; sid: string; reqId: string; ts: number }
  | { type: 'heartbeat'; ts: number }
  | { type: 'placeholder'; message: string }

export const SSE_HEARTBEAT_MS = 30_000

// error.ts
export const ApiError = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})
```

---

## 11. 验收清单

按 issue 03 验收条目逐项对应：

1. **Agent boot 成功**：`pnpm agent:start` 拉起，stdout 显示 `agent listening on http://0.0.0.0:7777`
2. **`GET /api/health` 200 + `ok:true`**：`curl http://localhost:7777/api/health` 返 §7 形状
3. **SSE 长连可用**：`curl -N -H 'X-AIDevSpace-Token: $TOK' http://localhost:7777/api/requirement/REFUND-001/events` 在 ≤ 5s 内看到 `event: hello` + `data: {...}`；30s 内看到 `event: heartbeat`
4. **401 缺 token**：同上 curl 但不带 header → 401 `unauthorized`
5. **403 错 Origin**：`curl -H 'X-AIDevSpace-Token: $TOK' -H 'Origin: http://evil.com' http://localhost:7777/api/health` → 403 `origin_not_allowed`
6. **5 条 requirement 路由 501 占位**：每条 `POST/GET-list/GET-id/PATCH/POST-skill` 都返 `{error:'not_implemented', feature, message, issue:'05'|'05'|'05'|'05'|'08'}`
7. **Token 不轮换**：连续两次 `GET /api/agent/bootstrap` 拿到相同 token；删除文件后重启 → 生成新的
8. **Cookie 鉴权可走 SSE**：脚本测试 `curl -H 'Cookie: aidevspace_token=$TOK'` 订阅 SSE 同样成功
9. **进程保活**：手动 `kill -9 $(cat $PID)`；watcher 5s 内重拉成功；新 PID 与 `~/.aidevspace/.agent.pid` 内容一致
10. **日志文件存在**：`~/.aidevspace/logs/agent.log` 存在，含 boot 行 + 每次 health 调用一行
11. **测试全绿**：`pnpm test` 在 agent 包下 ≥ 8 个新测试文件全过
12. **typecheck + lint**：`pnpm typecheck`、`pnpm lint --max-warnings 0` 干净

---

## 12. 实施步骤（与 §11 验收对应）

本期只有一个 PR（issue 03），按以下顺序推进（一阶段一 commit，便于 review 与回退）：

1. **Step 1**：新增 `packages/shared/src/{api,sse,error}.ts` + 单元测试
2. **Step 2**：`apps/agent/src/auth/TokenManager.ts` + 单测
3. **Step 3**：`apps/agent/src/auth/authPlugin.ts` + 单测
4. **Step 4**：`apps/agent/src/sse/SseHub.ts` + 单测
5. **Step 5**：`apps/agent/src/sse/requirementEventsRoute.ts` + 单测
6. **Step 6**：`apps/agent/src/routes/requirement.ts`（5 条 501）+ 单测
7. **Step 7**：`apps/agent/src/routes/bootstrap.ts` + 单测
8. **Step 8**：`apps/agent/src/services/HealthService.ts` + 单测（覆盖 health 路由）
9. **Step 9**：`apps/agent/src/server.ts` 集成：dual sink log + token plugin + cors 边界收紧 + 注册全部 routes
10. **Step 10**：`packages/scripts/agent-{start,stop,watch,status}.sh` + 顶层根 scripts
11. **Step 11**：`apps/agent/src/__tests__/e2e/agent-skeleton.e2e.test.ts` 跨路由集成
12. **Step 12**：更新顶层 `README.md` 加 `pnpm agent:*` 用法 + Windows 限制说明

每 step 必走 TDD：先失败测试 → 最小实现 → 重构 → commit。

---

## 13. Out of scope 与未来衔接

### 未来 issue 衔接点

- **issue 05 (requirement-crud)**：替换 5 条 501 为真实 CRUD；`packages/shared/src/api.ts` 的 Zod schema 直接复用
- **issue 06 (SDK integration)**：
  - `SseHub.publish(reqId, event)` 接 SDK events
  - 在 `packages/shared/src/sse.ts` 加 `SseEvent` 新成员
  - Q4 写队列挂在 `reqId` 维度，与本期 `Map<reqId, ...>` 形态相近
- **issue 08 (skill 加载)**：`POST /api/requirement/:id/skill` 由 501 改为真路径
- **后续 security issue**：rate limit / request body 大小 / Origin allowlist 动态化

### 本期不实现的 hard-limit

- SDK 不连（Agent 端 `apps/agent/src/providers/` 目录本期不创建，等 06 落地）
- token 不轮换
- Windows 不支持

---

## 14. 参考与索引

- [ADR-0001 混合形态 — Web 工作台 + 本地 Agent 守护进程](../../../docs/adr/0001-hybrid-web-agent-architecture.md)
- [ADR-0010 Claude Code SDK 集成设计](../../../docs/adr/0010-claude-code-sdk-integration.md)
- [CONTEXT.md 决策 31 / 34](../../../CONTEXT.md)
- [UI-POLISH-SPEC.md §Token 段](../../../.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md)
- [issue 02 design spec](2026-07-10-workspace-init-design.md)
- [issue 03 markdown](../../.scratch/ai-devspace-mvp/issues/03-agent-skeleton.md)
- [@fastify/sse 文档](https://github.com/fastify/fastify-sse)
- [@fastify/cors 文档](https://github.com/fastify/fastify-cors)
- [pino dual sink 模式](https://getpino.io/#/docs/transports?id=transport)

---

**状态**：待用户审阅
**作者**：brainstorming 会话（Claude Fable 5）
**下一步**：用户审阅通过 → 调用 `superpowers:writing-plans` 进入实现计划阶段
