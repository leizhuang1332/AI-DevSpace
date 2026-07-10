---
Status: resolved
Type: task
Stage: 1
---

# 02 - 工作空间目录初始化

## 目标

Agent 端提供"创建/检测/读取" `~/.aidevspace/` 目录的能力，落地 ADR-0002（纯文件系统）。

## 范围

- [ ] `initWorkspace()` API：检查 `~/.aidevspace/` 是否存在，不存在则创建完整目录结构
- [ ] `getWorkspaceInfo()` API：返回根路径、各子目录是否存在、`config.yaml` 内容
- [ ] `updateConfig(patch)` API：合并更新 `config.yaml`
- [ ] Agent 端 `~/.aidevspace/.gitignore` 自动生成（忽略 `logs/`、`*/node_modules/` 等）
- [ ] Web 端"设置"页能展示工作空间信息、修改 config
- [ ] 路径解析用 `path.join(os.homedir(), '.aidevspace')`，跨平台（macOS/Linux/Windows）

## 验收

- 首次启动自动创建完整目录
- 重启后能正确读取已存在的工作空间
- `config.yaml` 写入后能被 Web 端读取并展示

## 依赖

- [01-monorepo-init.md](01-monorepo-init.md)

## Comments

- 2026-07-10 由 agent 实现完成。范围 = 3 API + WorkspaceService 全套 + agent boot init + web Settings 全 5 section 接 config.yaml + vitest + testing-library 测试基建。
- 测试：packages/shared 23 + apps/agent 36 + apps/web 35 = **94/94 GREEN**；typecheck 3/3 包通过；agent eslint `--max-warnings 0` 干净。
- 设计 spec 落 `docs/superpowers/specs/2026-07-10-workspace-init-design.md`。
- code-review 双轴：Standards 15 + Spec 5 全部 Important 修干净，再跑仍 GREEN。
- commit: `07ad54904952dcb5d960f5ab56603d901139285b` — feat(workspace): init workspace on agent boot + wire web settings to config.yaml (issue 02)
- 摘要：Agent 端 WorkspaceService + 路由 + boot init；Web Settings 全 5 section 接 config.yaml；packages/shared 加 DEFAULT_CONFIG + Zod schema；测试基建 Vitest+RTL；code-review 双轴均无 Important。
