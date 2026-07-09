---
Status: ready-for-human
Type: spec
Created: 2026-07-09
Feature: ai-devspace-mvp
Related: PRD.md
---

# AI DevSpace — UI 打磨设计稿 v1.0

> 本文档是 **PRD.md §5 的打磨升级版**。所有设计决策基于 12 题 grilling 的结果。
>
> 目标：以前端组件 API + 前后端接口契约，驱动 monorepo 落地。
>
> 参考对象：Linear（极简、紧凑、Cmd+K 哲学）

---

## 1. 设计系统总览

### 1.1 主题策略
- **三档主题**：System（默认） / Dark / Light
- 配置文件：`config.yaml` 里的 `theme` 字段
- 实现：shadcn/ui 的 CSS variables + `next-themes`
- 用户偏好：亮色为心智模型

### 1.2 主色（Brand）
- **Linear 紫** `#5e6ad2`（500 档）
- 10 阶色板（50-900）
- 暗色模式：紫色变亮为 `#7c87e8`

### 1.3 语义色
| 用途 | 色值 | 用途 |
|---|---|---|
| Success | `#16a34a` | 完成/通过 |
| Warning | `#f59e0b` | 等待/注意/CLARIFYING |
| Error | `#ef4444` | 失败/阻塞/L3 推送 |
| Info | `#64748b` | 次要提示/灰阶 |

### 1.4 字体
- **正文**：`Inter`（无衬线，干净）
- **代码**：`JetBrains Mono`
- **CJK 回退**：`PingFang SC`（macOS） / `Microsoft YaHei`（Windows）

### 1.5 信息密度（Linear 紧凑型）

```css
/* === 间距（4 的倍数） === */
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;

/* === 字号（9 档） === */
--text-xs:  11px;   /* 标签/小字 */
--text-sm:  12px;   /* 副信息 */
--text-base:13px;   /* 默认正文 */
--text-md:  14px;   /* 强调正文 */
--text-lg:  16px;   /* 小标题 */
--text-xl:  18px;   /* 标题 */
--text-2xl: 20px;   /* 大标题 */
--text-3xl: 24px;   /* 页面标题 */
--text-4xl: 32px;   /* 数字统计 */

/* === 行内行高 === */
--row-sm:  28px;   /* 紧凑列表 */
--row-md:  32px;   /* 默认列表 */
--row-lg:  36px;   /* 宽松列表 */
--row-xl:  40px;   /* 卡片标题 */
--row-2xl: 48px;   /* 大卡片 */

/* === 行间距 === */
--leading-tight:  1.25;
--leading-normal: 1.5;
--leading-relaxed:1.7;

/* === 圆角（4 档） === */
--radius-sm:  4px;   /* 标签 */
--radius-md:  6px;   /* 按钮/输入框 */
--radius-lg:  8px;   /* 卡片 */
--radius-xl:  12px;  /* 大卡片/弹窗 */

/* === 阴影（4 档，仅用于浮层） === */
--shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
--shadow-md: 0 2px 4px rgba(0,0,0,0.06);
--shadow-lg: 0 4px 12px rgba(0,0,0,0.08);
--shadow-xl: 0 8px 24px rgba(0,0,0,0.12);
```

**统一规则**：
- 列表行高：32px
- 卡片内边距：16px
- 页面内边距：24px
- 元素同级间距：8px
- 父级子级间距：16px
- 模块间距：24px
- 按钮/输入框圆角：6px
- 卡片圆角：8px

---

## 2. 需求状态色系统

### 2.1 9 个状态对应色

| 状态 | 中文 | 色组 | 视觉 |
|---|---|---|---|
| `DRAFT` | 草稿 | Neutral 浅灰 | ● 淡灰圆点 |
| `ANALYZING` | 分析中 | Brand 紫（浅） | ● 浅紫圆点 |
| `CLARIFYING` | 待澄清 | Brand 紫 + 警告红点 | ● 紫圆点 + 右上小红点 |
| `DESIGNING` | 设计中 | Brand 紫（浅） | ● 浅紫圆点 |
| `PLANNING` | 计划中 | Brand 紫（浅） | ● 浅紫圆点 |
| `IMPLEMENTING` | 实施中 | Brand 紫（实色） | ● 主紫圆点（强调） |
| `SUBMITTING` | 提交中 | Warning 橙 | ● 橙圆点 |
| `DONE` | 已完成 | Success 绿 | ● 绿圆点 |
| `ARCHIVED` | 已归档 | Neutral 暗灰 | ● 暗灰圆点 |

**视觉层级**：
- 灰 = 静态（未开始/已归档）
- 紫 = 活跃（5 个"进行中"状态）
- 橙 = 需关注（待澄清/提交中）
- 绿 = 正向结果

**CLARIFYING 特殊处理**：紫色 + 右上角小红点（"AI 提问待回答"），用户回答后自动消除。

**MVP 阶段状态徽章不带数字**（"3/7"），P2 再加。

---

## 3. AI 实时状态

### 3.1 6 种状态

| `state` | 中文 | 视觉 | 触发场景 |
|---|---|---|---|
| `idle` | 空闲 | 灰圆点 | AI 不在工作 |
| `thinking` | 思考中 | 紫●●● 跳动 | AI 生成回复 |
| `tool_calling` | 工具调用中 | 紫 + 单点旋转 | AI 执行 shell/file/git |
| `writing` | 写入产物中 | 绿✓ 一闪 | AI 写文件到磁盘 |
| `awaiting_user` | 等待用户回答 | 橙常亮 + 脉冲 | AI 提问后等回复 |
| `error` | 错误 | 红常亮 + 脉冲 | SDK 错误 / 超时 |

### 3.2 出现三规矩
1. **默认隐身**：AI 不主动占 UI 空间
2. **主动但克制**：只在完成/错误/需关注时推送
3. **响应但精准**：用户用 Cmd+K 提问，AI 给"可执行结果"（不是聊天回复）

### 3.3 主动推送触发条件
- ✅ AI 完成 Skill 阶段
- ✅ AI 提问需用户回答
- ✅ 发生错误或关键决策

### 3.4 推送克制 4 原则
1. **30 秒静默窗口**：同类型事件 30s 内不重复推
2. **专注保护**：用户正在命令面板输入时，非 L3 推送延迟
3. **批量合并**：同类事件合并为一条
4. **静默列表**：用户可配置 `config.yaml` 里的 `notifications.silenced`

---

## 4. 关键页面布局（PRD §5 升级版）

### 4.1 整体范式变化：AI 隐身
- ❌ **取消** PRD §5.3 的"右栏常驻 AI 对话面板"
- ✅ AI 默认隐身，融入系统各面板
- ✅ 通过 Cmd+K 命令面板主动唤起

### 4.2 顶部状态条（StatusBar，常驻）

```
┌────────────────────────────────────────────────────────────┐
│  [Logo]  [Tab 1: 退款 ●●] [Tab 2: 会员 ○] [+]  ...  │  ← 标签栏
│                                                          │
│  退款功能 · 实施中    [紫●●● 思考中...]  [⚠ 3 待回答]  │  ← 状态条
└────────────────────────────────────────────────────────────┘
```

**职责**：
- 标签栏：多需求 Tab 切换（`Cmd+T` 新建、`Cmd+W` 关闭、`Cmd+1~9` 切换）
- 状态条：当前需求的 AI 实时状态
- 永远在视线上方

### 4.3 需求详情页（核心，三栏）

```
┌────────┬─────────────────────────────┬──────────┐
│        │                             │          │
│ 资源树 │     主工作区（动态 Tab）      │  Inline  │
│  240px │                             │  提示    │
│        │                             │  120px   │
│        │                             │  可折叠  │
└────────┴─────────────────────────────┴──────────┘
```

**变化**：
- 右栏不再是"AI 助手"，改为"Inline 提示栏"（AI 主动推送的浮窗收纳处）
- 极简默认，可折叠到 0

### 4.4 资源树（Explorer 风格）

- 行高 32px
- 节点类型图标（📄/📋/🎨/📝/📦/💬/📦）
- 状态色点（需求级）+ 完成度小标记
- 快捷键：`↑↓` 移动、`Enter` 打开、`→/←` 展开折叠、`H` 折叠当前、`Cmd+Shift+H` 折叠所有

### 4.5 AI 对话展现位置（重要）

**不再有右栏对话流**。AI 对话内容展现形式：

- **运行 Skill 时的产物**：写入 `conversations/<seq>.md` 文件，用户在资源树点击查看
- **AI 回答（在命令面板中）**：以"可执行结果卡片"呈现
- **AI 主动推送**：Toast 或 Inline 浮窗
- **AI 提问**：命令面板顶部 L3 状态 + Inline 浮窗

---

## 5. 核心组件 API

### 5.1 StatusBar（顶部状态条）

```typescript
// packages/web/src/components/status/StatusBar.tsx
interface StatusBarProps {
  /** 当前激活的需求 ID（从全局 context 拿） */
  requirementId: string
  /** AI 状态（SSE 推送） */
  aiStatus: AIStatusEvent | null
  /** 需求快照（REST 拉取） */
  snapshot: RequirementSnapshot
  /** 错误事件（SSE 推送） */
  errors: ErrorEvent[]
  /** 点击状态条 → 打开命令面板 */
  onOpenCommandPalette: () => void
  /** 点击错误 → 跳转到详情 */
  onErrorClick: (event: ErrorEvent) => void
}

interface AIStatusEvent {
  event: 'ai.status'
  requirementId: string
  state: 'idle' | 'thinking' | 'tool_calling' | 'writing' | 'awaiting_user' | 'error'
  detail?: {
    toolName?: string
    filePath?: string
    questionCount?: number
    errorCode?: string
    errorMessage?: string
  }
  startedAt: number
}
```

### 5.2 CommandPalette（命令面板）

```typescript
// packages/web/src/components/command/CommandPalette.tsx
interface CommandPaletteProps {
  /** 是否打开 */
  open: boolean
  /** 默认上下文（绑当前需求 / 全局） */
  defaultContext: 'current-requirement' | 'global'
  /** 关闭 */
  onClose: () => void
  /** 执行命令后回调 */
  onCommandExecuted?: (command: Command) => void
}

interface Command {
  id: string                       // 'run.analyze-stage'
  label: string                    // '运行 analyze-stage Skill'
  description?: string             // 副标题
  group: 'skill' | 'navigation' | 'requirement' | 'repo' | 'knowledge' | 'settings'
  shortcut?: string                // '⌘R'
  icon?: string                    // lucide 图标名
  requiresContext?: 'requirement'  // 需要在某个需求下才能执行
  execute: (context: CommandContext) => Promise<void>
}
```

**三段式布局**：
1. **命令**（确定性操作）— `> refund` 模糊匹配
2. **AI 提问**（自然语言）— `Cmd+I` 切换；输出"可执行结果卡片"
3. **历史**（最近命令与 AI 问答）

**输入模式**：
- 默认：模糊匹配命令
- `/` 开头：全局搜索（知识库/需求/产物）
- `>` 开头：直接命令模式
- `Cmd+I` 切换：AI 提问模式（输入框变紫色边框）

### 5.3 Toast（推送）

```typescript
// packages/web/src/components/feedback/Toast.tsx
interface ToastProps {
  type: 'info' | 'success' | 'warning' | 'error'
  title: string                    // 'analyze-stage 完成'
  description?: string             // '3 个产物已生成'
  actions?: Array<{                 // 快捷动作
    label: string
    onClick: () => void
  }>
  duration?: number                // ms，默认 8000
  /** L3 推送专用 */
  level?: 'L1' | 'L2' | 'L3'       // L3 不自动消失
}
```

**L1/L2/L3 分层**：
- L1：状态条文字变化（持续显示，无 Toast）
- L2：Toast 自动消失 8s
- L3：状态条变橙/红 + 脉冲 + 浏览器 Tab 闪烁 + 不自动消失

### 5.4 InlineHint（内联 AI 标记）

```typescript
// packages/web/src/components/inline/InlineHint.tsx
interface InlineHintProps {
  /** 关联的内容（文件/产物/任务） */
  target: {
    type: 'file' | 'artifact' | 'task' | 'requirement'
    path: string
  }
  /** 触发方式 */
  trigger: 'hover' | 'click' | 'always'
  /** 提示内容（可展开看详情） */
  hint: {
    summary: string                 // '缺少索引建议'
    severity: 'info' | 'warning' | 'error'
    action?: {
      label: string
      command: string               // 命令面板命令
    }
  }
  position?: 'right' | 'top' | 'bottom'
}
```

**应用场景**：
- 资源树节点 hover：显示状态摘要
- 产物列表行右侧：显示质量评分
- 代码 diff 上方：显示 AI review 建议

### 5.5 StatusBadge（状态徽章）

```typescript
// packages/web/src/components/status/StatusBadge.tsx
interface StatusBadgeProps {
  status: RequirementStatusValue
  /** 是否带"待回答"红点（CLARIFYING 专用） */
  awaitingUser?: boolean
  /** 紧凑模式（只显示圆点） */
  compact?: boolean
  /** 显示文字 */
  showLabel?: boolean
}
```

---

## 6. 实时通信契约（SSE）

### 6.1 为什么用 SSE
- AI DevSpace 的实时通信本质是"服务端→客户端"单向流
- SSE 走 HTTP，浏览器原生自动重连，代理友好
- 客户端→服务端（执行命令、提交提问）走 REST POST

### 6.2 SSE 端点（Agent 端）

```
GET /sse/requirement/:id           # 订阅单个需求的实时事件
GET /sse/agent/status              # 订阅 Agent 整体状态
GET /sse/requirement/:id/output    # 订阅 AI 输出流（打字机用）
```

### 6.3 SSE 消息格式

```
event: ai.status
data: {"state":"thinking","startedAt":1720531200000}

event: ai.output.chunk
data: {"messageId":"m1","delta":"我来帮你","position":4,"finished":false}

event: ai.output.chunk
data: {"messageId":"m1","delta":"分析退款功能","position":10,"finished":true}

event: ai.tool_call
data: {"messageId":"m2","toolName":"Read","input":{"path":"design/02-api.md"},"status":"completed","durationMs":200}

event: requirement.status
data: {"status":"IMPLEMENTING","progress":60,"currentSkill":"code-stage","currentTask":"Task #12 退款接口开发"}

event: artifact.created
data: {"artifactPath":"artifacts/refund.sql","artifactType":"code"}

event: error
data: {"severity":"error","title":"SDK 调用失败","message":"...","action":{"label":"重试","command":"run.current-skill"}}
```

### 6.4 完整 TypeScript 契约

```typescript
// packages/shared/src/sse-events.ts

/** AI 实时状态 */
export interface AIStatusEvent {
  event: 'ai.status'
  requirementId: string
  state: 'idle' | 'thinking' | 'tool_calling' | 'writing' | 'awaiting_user' | 'error'
  detail?: {
    toolName?: string
    filePath?: string
    questionCount?: number
    errorCode?: string
    errorMessage?: string
  }
  startedAt: number
}

/** AI 文本输出片段（流式打字机） */
export interface AIOutputChunkEvent {
  event: 'ai.output.chunk'
  requirementId: string
  messageId: string              // 同一 messageId 的 chunks 属于同一条消息
  delta: string                  // 10-100 字符的片段
  position: number               // 累计字符数
  finished: boolean
  timestamp: number
}

/** 工具调用（独立事件，不走打字机） */
export interface AIToolCallEvent {
  event: 'ai.tool_call'
  requirementId: string
  messageId: string
  toolName: 'Read' | 'Write' | 'Edit' | 'Bash' | 'Grep' | 'Glob' | 'WebFetch'
  input: unknown
  output?: string
  status: 'started' | 'completed' | 'failed'
  durationMs?: number
  timestamp: number
}

/** 需求状态变化 */
export interface RequirementStatusEvent {
  event: 'requirement.status'
  requirementId: string
  status: 'DRAFT' | 'ANALYZING' | 'CLARIFYING' | 'DESIGNING' | 'PLANNING' | 'IMPLEMENTING' | 'SUBMITTING' | 'DONE' | 'ARCHIVED'
  progress: number               // 0-100
  currentSkill?: string
  currentTask?: string
  timestamp: number
}

/** 产物更新 */
export interface ArtifactEvent {
  event: 'artifact.created' | 'artifact.updated'
  requirementId: string
  artifactPath: string
  artifactType: 'requirement' | 'analysis' | 'design' | 'plan' | 'code' | 'test' | 'submission'
  timestamp: number
}

/** 错误事件 */
export interface ErrorEvent {
  event: 'error'
  requirementId: string
  severity: 'warning' | 'error' | 'critical'
  title: string
  message: string
  action?: {
    label: string
    command: string              // 命令面板命令
  }
  timestamp: number
}

export type SSEEvent =
  | AIStatusEvent
  | AIOutputChunkEvent
  | AIToolCallEvent
  | RequirementStatusEvent
  | ArtifactEvent
  | ErrorEvent
```

---

## 7. REST API 契约

```typescript
// packages/shared/src/api.ts

// ============ 需求 ============
GET    /api/requirements                    → RequirementSnapshot[]
GET    /api/requirements/:id                → RequirementSnapshot
POST   /api/requirements                    → RequirementSnapshot
PATCH  /api/requirements/:id                → RequirementSnapshot
POST   /api/requirements/:id/archive        → { ok: true }

// ============ 仓库 ============
GET    /api/repos                           → RepoInfo[]
POST   /api/repos                           → RepoInfo          // { url, name }
DELETE /api/repos/:name                     → { ok: true }
GET    /api/requirements/:id/worktrees      → WorktreeInfo[]
GET    /api/requirements/:id/repos/:repo/diff → DiffResult

// ============ 知识库 ============
GET    /api/knowledge                       → KnowledgeEntry[]
GET    /api/knowledge/*path                 → { content: string, meta: ... }
POST   /api/knowledge/*path                 → { ok: true }
GET    /api/knowledge/search?q=...          → KnowledgeEntry[]

// ============ 规范 ============
GET    /api/standards                       → StandardEntry[]
GET    /api/standards/*path                 → { content: string }

// ============ Skill ============
GET    /api/skills                          → SkillInfo[]
GET    /api/skills/:name                    → SkillInfo

// ============ 命令面板 ============
GET    /api/commands?context=:id            → Command[]
POST   /api/commands/:id/execute            → { ok: true, result?: unknown }

// ============ AI 提问 ============
POST   /api/requirements/:id/ask            → { messageId: string }  // 流式从 SSE 收
                                                              // Body: { question: string, context?: {...} }

// ============ Workspace ============
GET    /api/workspace                       → WorkspaceInfo
PATCH  /api/workspace/config                → { ok: true }
GET    /api/agent/status                    → { status: 'online' | 'offline', version: string }

// ============ 通用类型 ============
export interface RequirementSnapshot {
  id: string
  title: string
  status: 'DRAFT' | 'ANALYZING' | 'CLARIFYING' | 'DESIGNING' | 'PLANNING' | 'IMPLEMENTING' | 'SUBMITTING' | 'DONE' | 'ARCHIVED'
  progress: number
  currentSkill?: string
  currentTask?: string
  repos: string[]
  createdAt: number
  updatedAt: number
}

export interface RepoInfo {
  name: string
  url: string
  branch: string
  lastFetchedAt: number
}

export interface WorktreeInfo {
  repoName: string
  branch: string
  worktreePath: string
  latestCommit: { sha: string; message: string; author: string; timestamp: number }
  changedFiles: number
}
```

---

## 8. 打字机效果规范

### 8.1 推送粒度
- **后端 SSE 推送**：按 chunk（10-100 字符一次）
- **前端展示**：按字符打字机

### 8.2 速度
- 默认 **20ms/字**
- 可设档：快 10ms / 中 20ms（默认）/ 慢 30ms / 关（即时）
- 配置：`config.yaml` 里的 `typewriterSpeed` 字段

### 8.3 跳过机制
- **点击气泡** → 立即显示完整内容
- 后续 chunk 仍按流式追加，但不再"打"
- 类似 Cursor / Notion AI 体验

### 8.4 视觉
- **打字机光标**：`▍` 块状光标
- **光标闪烁**：500ms 周期
- **气泡背景**：亮色模式浅紫、暗色模式深紫
- **完成态**：去掉光标，气泡加 0.5px 边框
- **工具调用卡片**：与气泡视觉区分（浅灰背景 + 折叠图标），**不打字机**

---

## 9. 快捷键体系

### 9.1 全局快捷键

| 快捷键 | 动作 |
|---|---|
| `Cmd+K` | 唤起命令面板（当前需求上下文） |
| `Cmd+Shift+K` | 唤起命令面板（全局上下文） |
| `Cmd+I` | 命令面板切到 AI 提问模式 |
| `Cmd+N` | 新建需求 |
| `Cmd+T` | 切换/新建需求 Tab |
| `Cmd+W` | 关闭当前 Tab |
| `Cmd+1/2/3/4/5/6` | 切左侧一级导航 |
| `Cmd+Shift+L` | 切换主题 |
| `Cmd+,` | 打开设置 |
| `Cmd+/` | 唤起快捷键速查面板 |
| `?` | 唤起快捷键速查面板（非输入态） |
| `Esc` | 关闭弹窗/退出聚焦 |

### 9.2 需求详情页快捷键

| 快捷键 | 动作 |
|---|---|
| `Cmd+R` | 重新跑当前 Skill |
| `Cmd+Enter` | 命令面板提交 AI 提问 |
| `Cmd+1~7` | 切主工作区 Tab |
| `Cmd+[/]` | 上/下一个 Tab |
| `Cmd+Shift+E` | 用 IDEA 打开当前 worktree |
| `Cmd+Shift+D` | 查看当前 Diff |
| `Cmd+Shift+C` | 跳到当前 worktree 最新 commit |

### 9.3 命令面板内

| 快捷键 | 动作 |
|---|---|
| `↑↓` | 选中上下项 |
| `Enter` | 执行当前选中 |
| `Tab` | 切换命令/AI 提问模式 |
| `Esc` | 关闭 |
| `Cmd+Backspace` | 清空输入 |

### 9.4 资源树内

| 快捷键 | 动作 |
|---|---|
| `↑↓` | 上下选中 |
| `Enter` | 打开当前节点 |
| `H` | 折叠/展开当前节点 |
| `Cmd+Shift+H` | 折叠/展开所有 |
| `→/←` | 展开/折叠 |

### 9.5 快捷键发现性（3 层）
1. **L1 UI 标注**：hover UI 元素显示快捷键
2. **L2 命令面板搜**：`Cmd+K` → 输"快捷键"→ 显示所有
3. **L3 速查面板**：`Cmd+/` 唤起全屏速查（按作用域分组 + 搜索）

### 9.6 跨平台
- macOS：显示 `⌘` 图标
- Windows：显示 `Ctrl` 文字
- 实现库：`react-hotkeys-hook`

---

## 10. 三态规范

### 10.1 空态（Linear 极简风）

```
┌──────────────────────────────────┐
│                                  │
│            📦                     │  ← 单色 icon 48px
│                                  │
│      还没有需求                    │  ← text-md 主色
│                                  │
│   从一份 PRD 开始你的 AI 开发流     │  ← text-sm 次要色
│                                  │
│     [ + 新建需求 ]                │  ← 主按钮
│                                  │
└──────────────────────────────────┘
```

| 场景 | 文案 | CTA |
|---|---|---|
| 需求列表 | 还没有需求 / 从一份 PRD 开始 | + 新建需求 |
| 需求详情 | 选个需求开始 | 浏览需求 |
| 仓库列表 | 克隆仓库开始 | + 添加仓库 |
| 知识库 | 沉淀第一条知识 | + 新增知识 |
| 命令面板 | 试试命令或问题 | （无） |
| 对话 | 运行 Skill 开始 | ▶ 运行 |

### 10.2 加载态（按场景混合）

| 场景 | 形式 |
|---|---|
| 列表/页面初次加载 | 骨架屏（shimmer 1.5s 循环） |
| 长操作（git/Skill） | 顶部进度条 + 状态条变化 |
| 按钮提交 | 按钮内 spinner + "加载中..." |
| 资源树加载 | 节点 spinner |

**骨架屏规范**：
- 背景色：`var(--color-bg-elevated)`（比底色高 5% 亮度）
- 圆角：4px
- 形状：模拟真实内容（行/卡片/列表项）

### 10.3 错误态（分层使用）

| 场景 | 形式 | 举例 |
|---|---|---|
| 列表为空/单次操作失败 | **内嵌** | "加载失败 [重试] [查看帮助]" |
| 表单校验/短时网络错误 | **Toast**（5s） | "保存失败，请重试" |
| 阻塞性错误（Agent 断、workspace 损坏） | **弹窗** | "Agent 已断开 [重新连接]" |
| AI 错误/必答 | **状态条 L3** | 状态条变橙 + Tab 闪烁 + 不消失 |

### 10.4 按钮状态

- **default**：主色背景 + 白字
- **hover**：背景加深 5%
- **disabled**：opacity 0.5 + `cursor: not-allowed`
- **loading**：按钮内 spinner + "加载中..." 文字
- **error**：按钮变红 1s 后恢复

---

## 11. 前端 monorepo 落地建议

### 11.1 文件组织

```
apps/web/                              # Next.js 14
├── src/
│   ├── app/                           # App Router
│   │   ├── (workspace)/
│   │   │   ├── layout.tsx             # 全局布局（顶部状态条 + 左侧导航）
│   │   │   ├── page.tsx               # /  Dashboard
│   │   │   ├── requirements/
│   │   │   │   ├── page.tsx           # /requirements 列表
│   │   │   │   └── [id]/
│   │   │   │       ├── layout.tsx     # 三栏布局
│   │   │   │       ├── page.tsx       # 默认 workspace tab
│   │   │   │       ├── repos/page.tsx
│   │   │   │       ├── artifacts/page.tsx
│   │   │   │       └── history/page.tsx
│   │   │   ├── repos/
│   │   │   ├── knowledge/
│   │   │   ├── skills/
│   │   │   └── settings/
│   │   └── layout.tsx
│   ├── components/
│   │   ├── status/
│   │   │   ├── StatusBar.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── AIStatusDot.tsx
│   │   ├── command/
│   │   │   ├── CommandPalette.tsx
│   │   │   ├── CommandList.tsx
│   │   │   ├── AIInput.tsx
│   │   │   └── HistoryList.tsx
│   │   ├── tree/
│   │   │   ├── ResourceTree.tsx
│   │   │   └── TreeNode.tsx
│   │   ├── chat/
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── TypewriterText.tsx
│   │   │   └── ToolCallCard.tsx
│   │   ├── inline/
│   │   │   └── InlineHint.tsx
│   │   ├── feedback/
│   │   │   ├── Toast.tsx
│   │   │   ├── EmptyState.tsx
│   │   │   ├── Skeleton.tsx
│   │   │   └── ErrorState.tsx
│   │   └── layout/
│   │       ├── Sidebar.tsx
│   │       ├── TabBar.tsx
│   │       └── ThreeColumnLayout.tsx
│   ├── hooks/
│   │   ├── useSSE.ts                  # SSE 订阅 hook
│   │   ├── useRequirement.ts
│   │   ├── useTypewriter.ts
│   │   ├── useShortcuts.ts
│   │   └── useTheme.ts
│   ├── stores/
│   │   ├── requirementStore.ts        # Zustand
│   │   ├── aiStatusStore.ts
│   │   ├── commandStore.ts
│   │   └── themeStore.ts
│   └── styles/
│       ├── tokens.css                 # CSS 变量
│       └── globals.css

packages/shared/                       # 跨端共享
├── src/
│   ├── sse-events.ts                  # SSE 事件类型
│   ├── api.ts                         # REST API 类型
│   ├── commands.ts                    # 命令定义
│   ├── status.ts                      # 状态枚举
│   └── theme.ts                       # 主题类型

apps/agent/                            # Node.js 守护进程
├── src/
│   ├── server.ts                      # Fastify 入口
│   ├── routes/
│   │   ├── sse.ts                     # SSE 端点
│   │   ├── requirements.ts
│   │   ├── repos.ts
│   │   ├── knowledge.ts
│   │   ├── commands.ts
│   │   └── workspace.ts
│   ├── services/
│   │   ├── RequirementService.ts
│   │   ├── RepositoryService.ts
│   │   ├── ClaudeCodeProvider.ts
│   │   ├── SkillLoader.ts
│   │   └── WorkspaceService.ts
│   └── events/
│       └── event-bus.ts               # 事件总线
```

### 11.2 依赖清单（apps/web）

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.0.0",
    "react-hotkeys-hook": "^4.0.0",
    "react-markdown": "^9.0.0",
    "rehype-highlight": "^7.0.0",
    "react-diff-viewer-continued": "^4.0.0",
    "lucide-react": "^0.400.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0",
    "next-themes": "^0.3.0",
    "sonner": "^1.0.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-tooltip": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.0.0",
    "typescript": "^5.0.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.0.0",
    "postcss": "^8.0.0",
    "shadcn-ui": "^0.5.0"
  }
}
```

### 11.3 依赖清单（apps/agent）

```json
{
  "dependencies": {
    "fastify": "^4.0.0",
    "@fastify/cors": "^9.0.0",
    "@fastify/sse": "^0.0.5",
    "@anthropic-ai/claude-code": "^0.0.1",
    "simple-git": "^3.0.0",
    "gray-matter": "^4.0.0",
    "yaml": "^2.0.0",
    "zod": "^3.0.0"
  }
}
```

---

## 12. Issue 拆分建议

在 `.scratch/ai-devspace-mvp/issues/` 目录下补充打磨相关的 issue：

- **12-design-tokens.md**：建立 CSS variables、Tailwind config、shadcn/ui 主题
- **13-shadcn-init.md**：初始化 shadcn/ui 组件库
- **14-status-bar-component.md**：实现 StatusBar + StatusBadge
- **15-command-palette-component.md**：实现 CommandPalette + 三段式布局
- **16-toast-component.md**：实现 Toast + L1/L2/L3 分层
- **17-sse-client-hook.md**：实现 useSSE hook（前端订阅）
- **18-sse-server-routes.md**：实现 SSE 服务端端点（Agent）
- **19-shortcut-system.md**：实现快捷键体系 + 速查面板
- **20-typewriter-effect.md**：实现打字机效果 + 跳过机制
- **21-three-state-guidelines.md**：实现空/加载/错误三态组件

---

## 13. 核心变更 vs PRD v1.0

| 项 | PRD v1.0 | UI Polishing v1.0 |
|---|---|---|
| AI 助手 | 右栏常驻聊天面板 | **隐身** + Cmd+K 唤起 |
| AI 对话流 | 右栏气泡流 | 写入文件 + 命令面板"可执行结果卡片" |
| 实时通信 | WebSocket | **SSE** |
| AI 输出 | 流式文本 | 流式文本 + **打字机效果** |
| 主题 | 未定 | 跟随系统 + 手动覆盖 |
| 主色 | 未定 | Linear 紫 `#5e6ad2` |
| 状态色 | 未定 | 9 态分组共享色 |
| 信息密度 | 未定 | Linear 紧凑型 |
| 快捷键 | 未定 | Linear 风格（90% 走 Cmd+K） |
| 三态规范 | 未定 | 极简空态 + 混合加载 + 分层错误 |

---

## 14. 立即可做（前端先行）

1. **初始化 Tailwind + CSS variables** — 锁定设计 token
2. **初始化 shadcn/ui** — 拿到基础组件库
3. **实现 `useSSE` hook** — 前端实时通信基础设施
4. **实现 StatusBar** — 第一个打磨成果
5. **实现 CommandPalette** — 新范式的核心入口
6. **实现 Toast + 打字机** — AI 体验核心

后端按 `packages/shared/src/sse-events.ts` + `packages/shared/src/api.ts` 的契约并行开发。
