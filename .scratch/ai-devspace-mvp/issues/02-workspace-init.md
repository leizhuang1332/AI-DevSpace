---
Status: ready-for-agent
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
