# workspaceRoot 可编辑 · 9 轮 grill 沉淀

> 本文档记录 `/grill-with-docs` 9 轮压力测试的逐轮 Q&A 与最终结论。
> ADR-0037 是本轮共识的「冻结版本」, 本文档保留完整推理轨迹供回溯。

---

## Q1（共 ~8 轮）· 动机

**问题**: 用户**在什么场景下**想改 workspaceRoot? A 迁移/B 多 workspace 切换/C 测试临时/D env 兼容

**答**: **A + D**

> - A (迁移): 用户换电脑 / 换磁盘 / 备份恢复后, 把 workspaceRoot 指到已有数据的新位置
> - D (env 兼容): 用户已经在用 env 切换 root, 现在想让 settings 也改, 两边双向同步
>
> 锁定后: **单 workspace 迁移** + **env 已存在** 组合, 不引入多 root 心智

---

## Q2（共 ~8 轮）· 优先级 / 真相源

**问题**: AIDEVSPACE_HOME env / config.yaml.workspaceRoot / 默认 ~/.aidevspace 三者优先级?

**答**: **B (yaml > env > 默认)**

> env 沦为「首次种子写入 yaml 的来源」; Agent 启动**两阶段**构造:
> 1. candidate = env || ~/.aidevspace (用来找 config.yaml)
> 2. 读 config.yaml.workspaceRoot → 若存在则 actual = yaml 值; 否则 actual = candidate
> 3. WorkspaceService(actual)

---

## Q3（共 ~8 轮）· 数据迁移责任 + settings 改 root 的 UX 边界

**问题**: settings 改 root 时对数据承担多少责任?

**答**: **B (指针 + 检测 + 警告)**

> | 新路径 | 行为 |
> |---|---|
> | 不存在 | 拒绝保存 |
> | 存在但无 workspace 痕迹 | 红警告 + 二次确认 |
> | 存在有 workspace 痕迹 | 绿提示 + 直接保存 |
>
> 旧路径**不动**, 用户自行处置; settings 改完 → Toast「下次启动 Agent 生效」

---

## Q4（共 ~8 轮）· Agent 运行中改 root 的语义

**问题**: agent 进程级 root 锁定 vs 热重载?

**答**: **A (进程级 stale + restart 按钮)**

> - PATCH 成功 → 返 200 + 新 config; agent 进程继续用旧 root 直到重启
> - settings 改完显 `[↻ 重启 Agent]` 按钮 → 调 `POST /api/agent/restart`
> - 进程级 mutex / SSE / SDK 状态机复杂, 热重载 B 方案放弃; 双 root 并存 C 多余状态字段放弃

---

## Q5（共 ~8 轮）· config.yaml 的权威位置

**问题**: config.yaml 写在哪一份? (env 路径 / actual root / 双写 / 双向收敛)

**答 (中途修订)**: **config.yaml 永远在 `~/.aidevspace`**

> 用户中途修正: 「以后 `~/.aidevspace` 目录是配置目录, 类似于 claude code 的 `~/.claude`」
> - configDir = `$AIDEVSPACE_HOME` 或 `~/.aidevspace` (env 切换)
> - dataRoot = `config.yaml::workspaceRoot` (可与 configDir 分离)
> - 两份真相源 = config.yaml + 数据 IO 目标, 单一职责

---

## Q6（共 ~8 轮）· workspaceRoot 默认值 + 现有用户迁移

**问题**: workspaceRoot 字段默认值?

**答**: **C (默认 = ~/.aidevspace, 向后兼容, opt-in 分离)**

> - 全新安装: workspaceRoot = ~/.aidevspace (同住)
> - 现有用户: 零迁移
> - 用户主动改: 可改到任意路径 (含 ~/Documents/aidevspace)
> - 不主动替用户做迁移决定 (决策 24 「克制, 在场」)

---

## Q7（共 ~8 轮）· Agent 启动算法 + WorkspaceService 拆分

**问题**: agent 启动如何确定两个根 (configDir + dataRoot)?

**答**: **A + dataRoot 拆目录**

> ```pseudo
> configDir = env.AIDEVSPACE_HOME || ~/.aidevspace (normalize)
> configPath = configDir + '/config.yaml'
>
> if exists(configPath):
>   cfg = readYaml(configPath)
>   dataRoot = cfg.workspaceRoot || configDir
> else:
>   dataRoot = configDir  # 首次启动; initWorkspace 会 seed
> ```
>
> - 不走 fallback 链 (env 设了就只看 env)
> - initWorkspace 创建的子目录全部在 **dataRoot** 下

---

## Q8（共 ~8 轮）· Settings UI 形态

**问题 8.1**: 编辑 UX 范式?
**答 8.1**: **C (行内编辑 v2)** — readOnly + hover ✏️ + 点 → 编辑模式 + [取消] [保存]

**问题 8.2**: 校验时机?
**答 8.2**: **C (前端 debounce + 后端兜底)** — 300ms debounce 调 validate-path, PATCH 强制校验

**问题 8.3**: workspace 痕迹定义?
**答 8.3**: **B (超集)** — `requirements/` / `knowledge/` / `skills/` / `analysis-skills/` 任一存在即视为有痕迹

---

## Q9（共 ~8 轮）· Restart 机制 + Settings UI 状态机

**问题 9.1**: restart 触发机制?
**答 9.1**: **C (SSE 通知 + exit(0))** — 先广播 `agent-restarting` → web toast → 清理 → `process.exit(0)` → supervisor 拉起

**问题 9.2**: Settings UI 状态机?
**答 9.2**: **B (workspaceRoot 字段旁 inline 状态条)** — 「已保存 · 待重启 · [↻ 重启]」, 不打扰其他 section

**问题 9.3**: 直接编辑 yaml 的体验?
**答 9.3**: **A (不感知)** — agent 不 watch yaml; 直接改下次启动生效; UI 显示 `info.root` (旧值), 不弹提示

---

## 最终锁定

8 大块共识, 见 ADR-0037 D1 ~ D8:

| # | 决策 |
|---|---|
| D1 | 模型拆分 configDir / dataRoot |
| D2 | 启动算法 yaml > env > 默认 |
| D3 | 数据迁移 = 纯指针 + 检测 + 警告 |
| D4 | 运行中改 root = 进程级 immutable + restart 按钮 |
| D5 | Settings UI = 行内编辑 v2 + debounce 校验 + restart banner |
| D6 | 新增 3 个错误码 |
| D7 | 数据 / UI 改动清单 (issue 01 ~ 07) |
| D8 | 不在范围 (留 P1+) |

---

## 待实施细节 (issue 落地时敲定)

- `POST /api/workspace/validate-path` 端点契约 (issue 03)
- `POST /api/agent/restart` 鉴权 (沿用 token, issue 04)
- supervisor 检测启发式 (issue 04: TSX_WATCH / 父进程名 / npm / pm2 / docker)
- WorkspaceInfo schema 扩展 (issue 02: 新增 configDir / dataRoot)
- workspace schema 在 packages/shared 的 fs 依赖隔离 (issue 01: 前端 import 时不崩)