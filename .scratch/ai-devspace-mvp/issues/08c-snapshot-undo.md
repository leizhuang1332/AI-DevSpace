---
Status: ready-for-agent
Type: task
Stage: 2
Supersedes: 08-builtin-skills.md (partial — 产物落盘)
Related-ADRs:
  - docs/adr/0009-ai-failure-defense.md
Related-Decisions: 46, 47
---

# 08c - AI 翻车防线 5 层（预 / 测 / 亮 / 回 / 学 — 学见 08d）

## 目标

落地 [ADR-0009](docs/adr/0009-ai-failure-defense.md) 的核心 4 层：**预 / 测 / 亮 / 回**。第 5 层"学（👎 反馈）"在 [08d-bad-feedback-loop.md](08d-bad-feedback-loop.md) 单独落地。

## 范围

### 第 1 层：预（事前阻止 — ActionGate）

- [ ] `ActionGate` 服务拦截所有 AI 写操作（Agent 中间件）
- [ ] **5 类高危操作默认 🚫 阻止**：
  1. 删 worktree 下任何非 `.gitkeep` 文件 → 必须 `Cmd+Shift+Del` 或 `/force-delete`
  2. git `push --force` → 二次确认 + 输入分支名
  3. git `push` 到 `main` / `master` → 二次确认
  4. commit 内容含 `.env` / `*secret*` / `*password*` / `BEGIN PRIVATE KEY` → 全部 redaction 后再询问
  5. 跑 `--no-verify` 跳过 hook → 警告
- [ ] **5 类警告操作**（不改也行的）：
  1. 改/删 `requirement.md` / `meta.yaml` → 警告
  2. 改/删 worktree 业务代码 → 改前+改后各 snapshot + diff 摘要
  3. 单次改 ≥ 10 个文件 → 警告
  4. 改 test-standards / code-standards 知识文件 → 警告
  5. Skill 改写 Always-on 配置 → 警告
- [ ] Settings → AI 协作 → **危险操作白名单**（带时间戳的"这次允许"，不存永久白名单）

### 第 2 层：测（事中发现 — ValidationHook）

- [ ] `ValidationHook` 服务在 AI 写完代码类文件后自动跑：
  1. 项目 linter（ESLint / Checkstyle / 自定义）
  2. 项目 type-check（tsc / javac）
  3. 单测（如果项目有）
  4. DDL → schema validator（sqlfluff / sql-lint）
  5. openapi.yaml → swagger validate
- [ ] 任何失败 → 走第 3 层"亮"
- [ ] 配置化：每个项目在 `requirements/<req-id>/meta.yaml` 声明 `validation:` 字段

### 第 3 层：亮（高优先级曝光）

- [ ] 4 级曝光机制：

| 等级 | UI |
|---|---|
| 🟡 轻 | Inline 提示栏变体（黄）+ hover 显示 diff 摘要 |
| 🟠 中 | 强制 Toast（不自动消失）+ StatusBar 转红 + 活动流标 ⚠️ |
| 🔴 重 | 上述全部 + 模态对话框（必须看 + 必须选"回滚"或"坚持"） |
| 🔴 极重 | 上述全部 + 暂停后续所有 AI 操作直到用户处理 |

- [ ] `ErrorExposer` 服务按等级路由
- [ ] StatusBar 第 5 个指示器：状态色码（红 = 出错）
- [ ] 关键原则：AI 出错时绝不"安静"——这是"克制在场"的反义时刻

### 第 4 层：回（一键回滚 — SnapshotService）

- [ ] `SnapshotService` 服务在 AI **每次写入前**自动 snapshot：

```
.aidevspace/snapshots/<req-id>/<YYYYMMDD-HHmmss-SSS>/
  ├── files/             (写入前文件副本)
  ├── meta.yaml          (操作描述：哪个 Skill / 哪个 turn / 写了哪些文件)
  └── ai-reason.md       (AI 当时为什么这么做的说明)
```

- [ ] 默认保留 **30 天**（Settings 可配）
- [ ] UI 入口：
  - [ ] StatusBar 旁 `[↶ 回滚上次 AI 操作]`（常驻按钮）
  - [ ] `[↶↶ 回滚本次会话全部 AI 操作]`
  - [ ] `[查看 snapshot 列表]`
- [ ] Snapshot 列表页（Cmd+K 内 tab 或独立路由）：
  - [ ] 时间倒序
  - [ ] 每个 snapshot 显示：操作描述 + 涉及文件数 + 影响 diff 行数
  - [ ] 可看 diff / 回滚 / 删除（永久删除）
  - [ ] 过滤：按 Skill / 按时间 / 按文件

### AI 翻车时的态度

- [ ] LLM 翻车回应模板：**事实陈述 + snapshot 路径 + 询问**（不"非常抱歉"）
- [ ] 示例：
  > "我刚才把 `refund_order` 表的 `amount` 字段类型写成了 `varchar(20)`，但我们项目里约定是 `decimal(10,2)`。已 snapshot 在 `.aidevspace/snapshots/req-001/20260710-153022/`。要回滚吗？"

## 验收

- [ ] AI 尝试删 `src/OrderService.java` → 🚫 阻止 + 提示用 `Cmd+Shift+Del`
- [ ] AI 尝试 `git push --force` → 🚫 阻止 + 要求输入分支名
- [ ] AI 尝试推 `main` → 🚫 阻止
- [ ] AI 写完 `.java` 后自动跑 linter（如果失败 → 走第 3 层）
- [ ] AI 写完 `artifacts/refund.sql` 后自动跑 schema validator
- [ ] AI 写完任何文件 → 自动 snapshot 落到 `.aidevspace/snapshots/`
- [ ] StatusBar 旁 `[↶ 回滚上次]` 按钮可用 + 一键回滚生效
- [ ] Snapshot 列表页可看 + diff + 永久删除
- [ ] 30 天后 snapshot 自动清理
- [ ] AI 翻车时回应是"事实+路径+询问"（不演戏）

## 不做

- 错误自评（Constitutional AI 风格）——v1.0 不做
- 全 confirm 一切——失去"克制在场"优势
- 出错就 LLM 重跑——可能再错

## 依赖

- [03-agent-skeleton.md](03-agent-skeleton.md)（中间件层）
- [06-repo-worktree.md](06-repo-worktree.md)（worktree 写操作拦截点）
- [08a-skill-loader-arming.md](08a-skill-loader-arming.md)（Skill 元数据 + 操作上下文）
- [08d-bad-feedback-loop.md](08d-bad-feedback-loop.md)（第 5 层"学"）
