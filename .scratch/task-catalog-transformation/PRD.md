下面给出完整的开发计划。

---

## 📋 开发计划：任务目录化改造（cwd + 任务 JSON 迁移）

### 一、目标目录结构对比

**改造前（当前）：**
```
~/.aidevspace/requirements/<reqId>/board/tasks/
├── 01HULID1.json                  ← 卡片主数据(平铺)
├── 01HULID2.json
├── 01HULID1/                      ← 协作目录(transcript)
│   ├── transcript.yaml
│   └── chat/
│       ├── session.json           ← chat 元数据
│       └── audit/
└── 01HULID2/
    └── chat/
```

**改造后（目标）：**
```
~/.aidevspace/requirements/<reqId>/board/tasks/
├── 01HULID1/                      ← 任务目录(cwd 指向这里)
│   ├── 01HULID1.json              ← 卡片主数据(移入目录内)
│   ├── transcript.yaml
│   └── chat/
│       ├── session.json
│       └── audit/
└── 01HULID2/
    ├── 01HULID2.json
    └── chat/
```

两个核心变化：
1. **任务 JSON 从平铺 `<tasks>/<id>.json` 移入 `<tasks>/<id>/<id>.json`**
2. **SDK `cwd` 从 `<tasks>/<id>/chat` 改为 `<tasks>/<id>`**

---

### 二、改动文件清单与具体步骤

#### Step 1 · [TaskCardStore.ts](file:///d:/TraeProject/AI-DevSpace/apps/agent/src/services/board/TaskCardStore.ts)（核心改动）

**1.1 `cardPath`（L180-182）**：把 JSON 路径从「tasks 目录直接拼」改为「任务子目录内拼」

```ts
// 当前
cardPath(reqId, cardId) = join(this.tasksDir(reqId), `${cardId}.json`)
// 目标
cardPath(reqId, cardId) = join(this.cardDirFor(reqId, cardId), `${cardId}.json`)
```

**1.2 `create`（L354-378）**：先建任务目录，再在目录内写 JSON

```ts
// 当前
const dir = this.tasksDir(reqId)
mkdirSync(dir, { recursive: true, mode: 0o700 })
writeFileSync(this.cardPath(reqId, id), ...)
// 目标
const cardDir = this.cardDirFor(reqId, id)
mkdirSync(cardDir, { recursive: true, mode: 0o700 })  // 先建任务目录
writeFileSync(this.cardPath(reqId, id), ...)            // 再写 <id>/<id>.json
```

**1.3 `list`（L201-247）**：扫描逻辑改写

- 当前：`readdirSync(tasksDir)` 直接过滤 `*.json` 平铺文件
- 目标：`readdirSync(tasksDir)` 只枚举子目录，再从每个子目录读 `<cardId>.json`
- 注意：**校验目录名与文件名一致**（`<dir>/<dir>.json`），避免读到 `chat/session.json` 等无关文件
- 解析失败 / schema 不符仍走 `console.warn + skip`（沿用容错策略）

```ts
const entries = readdirSync(dir, { withFileTypes: true })
for (const entry of entries) {
  if (!entry.isDirectory()) continue
  const cardId = entry.name
  if (!TASK_CARD_ID_RE.test(cardId)) continue
  const abs = join(dir, cardId, `${cardId}.json`)   // 只认 <id>/<id>.json
  if (!existsSync(abs)) continue
  // ... 后续 readFileSync + safeParse 不变
}
```

**1.4 `delete`（L580-605）**：删除逻辑简化

- 当前：`rm -rf cardDir` + `unlink cardPath`（两步：目录 + 平铺 JSON）
- 目标：`cardPath` 已在 `cardDir` 内部，**只需 `rm -rf cardDir`** 一步即删干净
- 保留幂等保护（dir 不存在 → `E_CARD_NOT_FOUND`）
- 注释更新：「task dir 内含 `<id>.json` + transcript + chat/，一次性删」

---

#### Step 2 · [board-chat.ts](file:///d:/TraeProject/AI-DevSpace/apps/agent/src/routes/board-chat.ts)（cwd 派生调整）

**2.1 重命名 + 重定义 `cardChatDir`（L331-334）**

函数名 `cardChatDir` 误导（实际返回 chat 子目录），改造后需指向「任务目录」。两个方案：

- **方案 A（推荐）**：重命名为 `cardTaskDir`，返回 `TaskCardStore.cardDirFor` 的等价路径

```ts
function cardTaskDir(reqId: string, cardId: string): string {
  // 与 TaskCardStore.cardDirFor 同源:<tasks>/<cardId>
  return join(deps.workspaceRoot, 'requirements', reqId, 'board', 'tasks', cardId)
}
```

- 调用点同步更新：
  - L426（`/start` 路径）：`const cwd = cardTaskDir(reqId, cardId)`
  - L496（`/query` 路径）：`const effectiveCwd = meta?.cwd ?? cardTaskDir(reqId, cardId)`

**注意**：`meta?.cwd` 来自已落盘的 `session.json`。**老 session.json 的 cwd 仍是 `.../tasks/<id>/chat`**——首次 query 命中老 meta 时 cwd 不会更新，需走迁移兼容（见 Step 4）。

---

#### Step 3 · [ChatSessionService.ts](file:///d:/TraeProject/AI-DevSpace/apps/agent/src/services/board/ChatSessionService.ts)（无改动，仅核对）

`chatDirFor` / `sessionJsonPathFor` 仍返回 `<tasks>/<cardId>/chat/session.json`，**保持不变**。这保证：

- session.json 物理位置稳定（不随 cwd 变化）
- `sweepExpiredSessions`（L890-940）扫描 `tasksDir/<cardId>/chat/` 的逻辑仍生效
- `loadSnapshot` → `sdkSessionLogPathFor(meta.cwd, ...)` 派生 SDK jsonl 路径时，由于 cwd 从 `.../tasks/<id>/chat` 变为 `.../tasks/<id>`，**SDK jsonl 物理路径会变**（`~/.claude/projects/<sanitized-new-cwd>/<sid>.jsonl`）。老 jsonl 会变成孤儿文件，触发 `sdkJsonlMissing → needsRebuild`，自动走新 sessionId 重建路径。这是预期行为，无需特殊处理。

---

#### Step 4 · 迁移兼容（可选但建议）

老 workspace 升级后会出现两类遗留：

1. **平铺 JSON 文件**：`tasks/<id>.json` 残留，`list` 不再扫到 → 卡片「消失」
2. **老 session.json 的 cwd 指向 `/chat`**：首次 query 仍用旧 cwd，SDK jsonl 路径与历史不一致

**建议加一个迁移函数**（在 `TaskCardStore` 加 `migrateLegacyLayout(reqId)` 或在 server 启动时跑一次）：

```ts
// 伪代码
for (const file of readdirSync(tasksDir).filter(f => f.endsWith('.json'))) {
  const cardId = file.replace('.json', '')
  const cardDir = join(tasksDir, cardId)
  mkdirSync(cardDir, { recursive: true })
  renameSync(join(tasksDir, file), join(cardDir, file))
}
```

如果只面向新 workspace（无历史数据），可跳过此步，直接在 Step 1 实现层就完成迁移。

---

#### Step 5 · [ClaudeCodeProvider.ts](file:///d:/TraeProject/AI-DevSpace/apps/agent/src/providers/ClaudeCodeProvider.ts#L1065-1072)（无直接改动）

用户引用的 L1065-1072 `sdkOptions.cwd = effectiveCwd` —— **此处不需要改**。`effectiveCwd` 是 `input.frozenCwd ?? input.cwd` 透传，源头在 `board-chat.ts` 的 `cardTaskDir`。只要 Step 2 改完，此处自动指向任务目录。

---

### 三、测试影响面

| 测试文件 | 影响 |
|---|---|
| `__tests__/board/board-chat-route.test.ts` L265/L488 | `taskCardStore.create(...)` 仍可工作（API 不变，只是落盘位置变） |
| `__tests__/board/TaskCardStore.*.test.ts`（若有） | `list` 行为变化，断言「扫描子目录」需更新 |
| `ChatSessionService.*.test.ts` | 路径不变，无需改 |

需新增测试用例：
- ✅ 创建卡片后 `<tasks>/<id>/<id>.json` 存在
- ✅ `list` 能从子目录读到卡片
- ✅ `delete` 一次性清空任务目录
- ✅ `cwd` 派生到 `<tasks>/<id>`（不再有 `/chat` 后缀）

---

### 四、执行顺序建议

1. **先改 `TaskCardStore`**（cardPath / create / list / delete）—— 落盘结构是基础
2. **再改 `board-chat.ts`**（cardTaskDir 重命名 + 两处调用点）—— cwd 派生跟在落盘结构后面
3. **跑测试** —— `board-chat-route.test.ts` + `TaskCardStore` 单测
4. **手动 e2e 验证** —— 启动 agent，创建一张卡片，确认目录结构 + chat cwd 落盘 + SDK jsonl 路径变化
5. **（可选）迁移脚本** —— 处理老 workspace 残留

---

### 五、风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 老 workspace 平铺 JSON 失效 | 历史卡片「消失」 | Step 4 迁移脚本，或限定「只面向新 workspace」 |
| cwd 变化导致 SDK jsonl 孤儿 | snapshot 显示「SDK 日志丢失」banner | 期望行为，下次 query 自动重建 sessionId |
| `additionalDirectories` 仍指向 `joinReqDir(reqId)` | 不变，仍可访问父需求目录 | 无需改 |

---
