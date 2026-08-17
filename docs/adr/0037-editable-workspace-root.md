---
status: accepted
---

# workspaceRoot 可编辑:settings 页 + config.yaml 直改 + Agent 启动算法重写

## 背景与现象

[决策 3](https://) 锁定工作空间根 = `~/.aidevspace/`,但 [决策 73](/) 「决策 24 反对让用户编辑配置」的早期约束与今天「允许用户在 settings 改 root + 直接改 yaml」的产品诉求冲突。

当前真实痛点:

1. 用户换盘 / 备份恢复 / 同步到云盘后,**没有**任何官方路径把 workspaceRoot 指到新位置
2. 既有 `AIDEVSPACE_HOME` env 可挪配置目录,但 `config.yaml::workspaceRoot` 字段**已存在却未被 agent 读取**(只 web 端 `requirements-root.server.ts` 读)→ agent / web 解析优先级**不一致**
3. `WorkspaceService.root` 在构造时锁定 → 即使 yaml 改了,运行中 agent 不会切到新 root
4. Settings → 工作空间 section 当前 `<input readOnly>` 不可编辑;AgentSection 只显示「工作空间根 X」(从 `/api/health` 拿的),**没有任何编辑入口**

本 ADR 由 **9 轮 grill-with-docs 沉淀** 锁定(product / agent / web 三方共识),见 `.scratch/workspace-root-editable/decisions.md`。

## 决策

### D1. 模型拆分:configDir vs dataRoot

新模型下,agent 进程启动要分清**两个根**:

| 名称 | 物理位置 | 角色 |
|---|---|---|
| **configDir** | `$AIDEVSPACE_HOME` 或 `~/.aidevspace` | 仅放 `config.yaml` |
| **dataRoot** | `config.yaml::workspaceRoot` | requirements / knowledge / skills / analysis-skills / logs / repos.yaml / snapshots |

- 默认两者同住(`dataRoot == configDir`),向后兼容
- 用户主动改 `workspaceRoot` → opt-in 分离
- **`config.yaml` 永远在 configDir**,从不移动

### D2. 启动解析算法(yaml > env > 默认)

```
configDir = env.AIDEVSPACE_HOME || ~/.aidevspace
configDir = normalizeWorkspaceRoot(configDir)

configPath = configDir + '/config.yaml'

if exists(configPath):
  cfg = readYaml(configPath)
  dataRoot = (cfg.workspaceRoot && cfg.workspaceRoot !== '')
             ? normalizeWorkspaceRoot(cfg.workspaceRoot)
             : configDir
else:
  dataRoot = configDir  # 首次启动;initWorkspace 会 seed configDir/config.yaml
```

- **不**走 fallback 链(env 设了就只看 env)—— 老 env 用户语义「env = 配置目录切换」,要保留老配置自己 `unset` 或 `cp`
- `initWorkspace()` 创建的子目录(`requirements/` / `knowledge/` / `skills/` / `analysis-skills/` / `logs/` / `repos.yaml`)全部在 **dataRoot** 下

### D3. 数据迁移责任:纯指针 + 检测 + 警告(settings 改 root 时)

settings PATCH 改 workspaceRoot = **纯指针**,**完全不**碰任何数据(决策 24「克制,在场」)。前端 + 后端双层校验:

| 新路径状态 | 前端提示 | 后端响应 |
|---|---|---|
| 不存在 | 红 inline「目标路径不存在」 | 400 `E_WS_ROOT_PATH_NOT_EXISTS` |
| 存在但**无 workspace 痕迹** | 黄 inline「下次启动将初始化空白 workspace;旧路径数据留在原地」 | 200 + 警告文案 |
| 存在**有 workspace 痕迹** | 绿 inline「检测到 N 项数据,将接管」 | 200 + 接管文案 |

**workspace 痕迹定义(超集)** = 新路径下存在 `requirements/`、`knowledge/`、`skills/`、`analysis-skills/` 中**任一**子目录。
- 选超集而非「必须含 config.yaml」:用户 mv 数据时一般整体 mv,但 config.yaml 由 settings 接管后被新写,不依赖旧文件。

**旧路径不动**——用户自行处置(决策 24)。

### D4. 运行中改 root 的语义:进程级 immutable + restart

`WorkspaceService.configDir` / `dataRoot` 在构造期确定后**进程级 immutable**:

- settings PATCH 成功 → 返回 200 + 新 config;agent 进程**继续用旧 root**直到重启
- 触发机制 = 新增 `POST /api/agent/restart`:
  1. SSE 广播 `agent-restarting` 事件 → web toast「连接中断,恢复中...」
  2. 关 SDK / git / SSE 连接
  3. `process.exit(0)` → 外部 supervisor(`tsx watch` / `npm run dev` / docker / nohup)自动拉起新进程
  4. web 自动重连 `/api/health` → 拿到新 root

**直接编辑 yaml 的体验**:不被 agent 检测(Q4-A)——下次启动才生效,UI 不弹任何「待重启」提示(教育用户「改 root 都要重启」)。

### D5. Settings UI:行内编辑 v2

替换 `apps/web/src/app/(workspace)/settings/sections/workspace.tsx` 当前 readOnly 形态:

| 状态 | 视觉 |
|---|---|
| 默认(readOnly) | `<input readOnly>` + hover 时显 `[✏️]` 按钮(克制,默认无视觉噪点) |
| 编辑中 | input 可写 + 自动 focus 全选 + 旁 `[取消] [保存]` + input下方 300ms debounce 校验提示 |
| 保存成功 | 切回 readOnly + inline 状态条「✓ 已保存 · 待重启 · [↻ 重启 Agent]」 |

校验时序:**前端 debounce 300ms** 调 `POST /api/workspace/validate-path`(只读 hint),**保存走 PATCH**(`PATCH /api/workspace/config { workspaceRoot }`)由后端强制校验。

### D6. 新增错误码

| 错误码 | 含义 | HTTP |
|---|---|---|
| `E_WS_ROOT_PATH_NOT_EXISTS` | 新路径 fs 不存在 | 400 |
| `E_WS_ROOT_PATH_NOT_WORKSPACE` | 新路径无 workspace 痕迹(后端硬约束,前端应已挡) | 400 |
| `E_AGENT_RESTART_FAILED` | restart 端点前置清理失败(SSE 关 / SDK 关 / git clean) | 500 |

注册到 `apps/agent/src/error-codes.ts`(沿用既有错误码空间)。

### D7. 数据 / UI 改动清单

#### 后端 `apps/agent`

| # | 文件 | 改动 |
|---|---|---|
| 1 | `services/WorkspaceService.ts` | 拆 constructor:原 `root` → `configDir` + `dataRoot`;`configPath` 改用 `configDir`;`resolveRoot` 拆为 `resolveConfigDir` + `resolveDataRoot`;`initWorkspace` 在 `dataRoot` 下建子目录,在 `configDir` 下写 config.yaml |
| 2 | `services/WorkspaceService.ts` | 增 `validatePath(p: string): { exists, isWorkspace, errorCode? }`:纯函数,被 validate route 与 PATCH handler 共用 |
| 3 | `routes/workspace.ts` | + `POST /api/workspace/validate-path`(只读 hint)+ 改 `PATCH /api/workspace/config` 走 validate + 返 400 with errorCode |
| 4 | `routes/agent.ts` | + `POST /api/agent/restart`:SSE 广播 → 清理 → `process.exit(0)` |
| 5 | `server.ts` | SSE event 注册 `agent-restarting` 类型 |
| 6 | `error-codes.ts` | + 3 个新错误码(D6) |

#### 前端 `apps/web`

| # | 文件 | 改动 |
|---|---|---|
| 7 | `app/(workspace)/settings/sections/workspace.tsx` | 重写:行内编辑 v2 + 校验 + restart banner |
| 8 | `lib/config-hooks.ts` | + `useValidateWorkspaceRoot()` mutation(调 validate-path) |
| 9 | `lib/config-hooks.ts` | `useUpdateConfig()` 增强:200 响应里若 `workspaceRoot` 与运行时不同 → 自动 invalidate `workspace` query + 触发 restart banner |
| 10 | `components/agent-restart-banner.tsx` | 新建:全局 toast / banner 监听 SSE `agent-restarting` + `agent-restarted` 事件 |

#### 共享层 `packages/shared`

| # | 文件 | 改动 |
|---|---|---|
| 11 | `src/config-defaults.ts` | `DEFAULT_CONFIG.workspaceRoot` 默认值改为 `''`(明确区分「未设 vs 同住」) |
| 12 | `src/workspace-schema.ts` | 新增 `WorkspaceValidation` zod schema + `validateWorkspaceRoot()` 纯函数(前端 / 后端共享) |

#### 领域文档

| # | 文件 | 改动 |
|---|---|---|
| 13 | `CONTEXT.md` | v1.0.11 增量段;术语表新增 configDir / dataRoot / WorkspaceTrace / WorkspaceRootValidation |
| 14 | `docs/agents/domain.md` | 追加 4 条术语 |
| 15 | `.scratch/workspace-root-editable/{PRD,decisions,issues/NN-*}.md` | 本目录 |

### D8. 不在范围内(明确剔除)

- **多 workspace 切换**(B 场景)→ 留 P2+;本期不做「切到 D:/bar 同时保留 C:/foo 双 root 并存」心智
- **自动数据迁移**(mv 旧 → 新)→ 决策 24「克制,在场」红线;settings 只改指针,IO 责任归用户
- **agent 端热重载**(不重启切换 root)→ 违反决策 73「进程级 immutable」;SSE / SDK / git / mutex 状态切换风险高
- **直接编辑 yaml 的 UI 提示**→ 不 watch yaml 文件;用户教育「改 root 都要重启」即可
- **文件选择器**(HTML5 directory upload)→ webkit only;本期输入框 + 校验提示足够
- **env 可视化编辑**→ env 是 shell 级概念,settings 不暴露「清除 AIDEVSPACE_HOME」操作

## 主要取舍

- **选择「yaml > env > 默认」而非「env > yaml > 默认」**:UI 改了必生效;env 是「首次启动 seed」而非「运行时真相」;代价是老 env 用户切换路径要走 yaml 不是 env,但 yaml 与 config.yaml 同住的事实让操作一致
- **选择「configDir 永远在 ~/.aidevspace」而非「configDir 跟随 dataRoot」**:env 心智最契合(env 指「aidevspace 配置根」);代价是 opt-in 分离后用户看到「config 在 X,数据在 Y」两个目录,可能困惑
- **选择「纯指针」而非「自动 mv 数据」**:决策 24 + 跨盘符 / 权限 / 大数据 mv 的复杂度爆炸;代价是用户忘 mv 数据会「数据消失」(实际留在旧路径),用 D4 三档警告前置
- **选择「进程级 immutable + restart 按钮」而非「热重载」**:B 复杂度爆炸;决策 73 心智简化;代价是「我改了为啥不生效」UX 摩擦,用 SSE restart 事件 + inline banner 兜住
- **选择「行内编辑 v2」而非「常驻编辑」**:决策 17「Linear 紧凑型」;默认视觉安静;代价是多一次 click
- **选择「前端 debounce + 后端强制」而非「仅后端校验」**:所见即所得 + 后端是真相源;代价是 validate-path 多一个端点
- **选择「workspace 痕迹超集」而非「必须含 config.yaml」**:贴近用户实际操作(mv 时 config.yaml 往往不一起搬);代价是「新建空目录手建 skills/」可能误判为「接管」,但 settings 三档警告只 hint,不强制

## 关联

- **上游**:
  - 决策 2(纯文件系统)+ 决策 3(workspaceRoot = `~/.aidevspace`)+ 决策 73(目录即真相源)
  - [ADR-0030](0030-repo-registry-and-per-requirement-clone.md) D1:`repos.yaml` 在 dataRoot(沿用新模型)
  - `apps/web/src/lib/requirements-root.server.ts` 当前读 yaml 字段,本期改造后**与 agent 算法对齐**
  - `apps/agent/src/services/WorkspaceService.ts` 既有的 `registryLock` mutex 模式(D7 复用)
- **下游**(本期不立,留 P1+):
  - 多 workspace 并存(B 场景)
  - 自动数据迁移(C 场景增强)
  - agent 端热重载(D 场景增强)
- **实现位置**:
  - 后端:`apps/agent/src/services/WorkspaceService.ts` + `apps/agent/src/routes/{workspace,agent}.ts`
  - 前端:`apps/web/src/app/(workspace)/settings/sections/workspace.tsx` + `apps/web/src/lib/config-hooks.ts`
  - 共享:`packages/shared/src/{config-defaults,workspace-schema}.ts`
  - 领域文档:`CONTEXT.md`(v1.0.11 增量)+ 本 ADR