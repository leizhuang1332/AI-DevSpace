---
Status: ready-for-agent
Type: prd
Created: 2026-08-17
Feature: workspace-root-editable
Supersedes: 无
Implements: 用户原诉求「支持用户手动修改 workspaceRoot, 包括在 settings 页面修改, 以及直接在 config.yaml 配置文件修改」
Implements ADR: docs/adr/0037-editable-workspace-root.md
Related:
  - .scratch/repo-registry-clone/PRD.md(dataRoot 子目录布局源头)
  - docs/adr/0030-repo-registry-and-per-requirement-clone.md(repos.yaml 位置在 dataRoot)
  - docs/agents/issue-tracker.md(feature-per-directory 约定)
  - docs/agents/domain.md(术语 SSoT)
  - CLAUDE.md 全局 git add/commit/push 禁令 + 本项目特批
---

# workspaceRoot 可编辑 · PRD

> 本 PRD 是 ADR-0037 的任务拆分文档。9 轮 grill-with-docs 决策已锁,
> 实施按 `issues/01-*` ~ `issues/NN-*` 顺序推进。

---

## 1. Problem Statement

用户**没有任何官方路径**修改 `workspaceRoot`:

1. settings 页 workspace section 当前 `<input readOnly>` — 不可编辑
2. 直接编辑 `~/.aidevspace/config.yaml::workspaceRoot` — 字段已存在但 agent 不读
3. `AIDEVSPACE_HOME` env 可挪「配置目录」, 但与「数据目录」语义耦合, 用户改不动 workspaceRoot 字段

加上 agent / web 解析优先级**不一致**(web 读 yaml 字段, agent 不读), 三方真相源分裂。

后果:

- 换盘 / 备份恢复 / 同步到云盘后, 用户必须手动 `mv` 数据 + 重新设 env, 没有 UI 兜底
- 「数据 + 配置同住」是隐式假设, 没人能改 → 与决策 24「克制, 在场」表面冲突(用户无法自助)
- agent 进程级 root 锁定, 即便 yaml 改了也不切 → 引发「改了为啥不生效」UX 摩擦

## 2. 预期结果

详见 ADR-0037 D1 ~ D8:

- **配置 / 数据分离模型**:`configDir` (config.yaml) 与 `dataRoot` (requirements / knowledge / skills / repos.yaml / snapshots) 物理可分离, 默认同住
- **启动算法重写**: yaml > env > 默认, 算法见 ADR-0037 D2
- **settings 可编辑**: 行内编辑 v2 + 300ms debounce 校验 + PATCH 保存 + restart banner
- **路径校验**: 三档 UI 反馈 (不存在 / 无痕迹 / 有痕迹), 后端硬约束
- **运行中改 root**: SSE 广播 `agent-restarting` + `process.exit(0)` + supervisor 拉起
- **直接 yaml 编辑**: 不 watch 文件, 下次启动生效 (用户教育)

## 3. 范围 / 不范围

### 3.1 范围内(本期必做)

- [x] ADR-0037 决策沉淀 ✅
- [x] CONTEXT.md 新增 configDir / dataRoot / WorkspaceTrace 术语 ✅
- [ ] agent `WorkspaceService` 拆 constructor(configDir + dataRoot)
- [ ] agent 启动算法重写 + 测试
- [ ] agent `POST /api/workspace/validate-path` 端点
- [ ] agent `POST /api/agent/restart` 端点 + SSE `agent-restarting` 事件
- [ ] agent 错误码 `E_WS_ROOT_PATH_NOT_EXISTS` / `E_WS_ROOT_PATH_NOT_WORKSPACE` / `E_AGENT_RESTART_FAILED`
- [ ] web `useValidateWorkspaceRoot` hook + workspace section 行内编辑 v2
- [ ] web `agent-restart-banner` 全局 toast / banner
- [ ] packages/shared `validateWorkspaceRoot` 纯函数
- [ ] web / agent 全套件通过

### 3.2 不在范围(明确剔除, 留 P1+)

- 多 workspace 切换(B 场景)→ P2+
- 自动数据迁移(自动 `mv` 数据)→ 决策 24 反对
- agent 端热重载(不重启切 root)→ 决策 73 心智简化
- 文件选择器(HTML5 directory upload)→ webkit only
- env 可视化编辑(清除 `AIDEVSPACE_HOME`)→ shell 级, settings 不暴露
- yaml 文件 watch (用户直改后 UI 实时反映)→ 决策 24 反对

## 4. 实施拆分

| Issue | 标题 | 依赖 | 状态 |
|---|---|---|---|
| 01 | shared: `validateWorkspaceRoot` 纯函数 + zod schema | 无 | ready-for-agent |
| 02 | agent: WorkspaceService 拆 configDir / dataRoot + 启动算法重写 | 01 | ready-for-agent |
| 03 | agent: `POST /api/workspace/validate-path` 端点 + PATCH 强制校验 | 02 | ready-for-agent |
| 04 | agent: `POST /api/agent/restart` 端点 + SSE `agent-restarting` 事件 | 02 | ready-for-agent |
| 05 | web: useValidateWorkspaceRoot hook + workspace section 行内编辑 v2 | 03 | ready-for-agent |
| 06 | web: agent-restart-banner 全局 toast / banner | 04 | ready-for-agent |
| 07 | e2e: settings 改 root → restart → 新 root 生效 全链路 | 03, 04, 05, 06 | ready-for-agent |

## 5. 验收

### 后端
- [ ] agent 全套件通过(含 WorkspaceService 拆分 + 启动算法 5+ case + validate-path 4 case + restart 3 case)
- [ ] 不动现有 repos.yaml / requirements 等数据(测试用临时 tmp 目录)
- [ ] 鉴权: 新端点都走现有 `authPlugin` 全局 hook

### 前端
- [ ] web 全套件通过(含 settings workspace section 12 case + restart banner 5 case)
- [ ] 不引入 `process.exit` 等 node-only API 进 web bundle

### 端到端(必跑 dev server)
- [ ] settings 改 root → 三档 UI 反馈分别手动验证
- [ ] restart 按钮 → SSE `agent-restarting` 触发 → 自动恢复 → UI 显示新 root
- [ ] 直接编辑 yaml → 重启 agent 后生效

## 6. 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| WorkspaceService 拆分破坏现有 100+ 调用点 | 中 | 单 PR 走 + 全套件 100% 通过 + 临时保留旧 alias 1 个版本 |
| restart 后 supervisor 没拉起(用户裸跑 node) | 中 | agent 启动期检测 supervisor, 无则打 warning(具体启发式见 issue 04) |
| SSE 广播失败(restart 已触发) | 低 | 重试 3 次 → 仍失败则静默, 让 supervisor 拉起 (web 端靠重连兜底) |
| 数据迁移误操作 | 中 | settings 只改指针, 不动 IO; UI 三档警告前置 |

回滚: revert commit(WorkspaceService 单点改动)→ 旧逻辑读 env > 默认 + 单 root 仍可用。

## 7. 不做

- 不删 AIDEVSPACE_HOME env 支持(env 仍是合法入口)
- 不动 requirements / repos.yaml 等数据 schema
- 不动 settings 其他 section(appearance / ai / agent / danger)
- 不扩 analysis / board / wrap-up
- 不走 ADR-0023 MCP 守门(本 feature 无 MCP 改动)