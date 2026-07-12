---
Status: ready-for-agent
Type: task
Stage: 2
---

# 12 - 工位注册表(13 字段 yaml schema)

## 目标

把 [ADR-0012 §9](../docs/adr/0012-requirement-workbench-shell-topology.md) 定义的工位集合声明式注册表落地为 6 个 yaml 文件 + TypeScript 类型定义 + 加载器。

## 范围

- [ ] 6 个工位 yaml 文件落盘:`~/.aidevspace/zones/`(开发期可放仓库 `apps/agent/src/zones/`,部署时拷贝)
  - `drafting.yaml` / `analyzing.yaml` / `clarifying.yaml` / `designing.yaml` / `executing.yaml` / `wrapup.yaml`
  - 每个文件含 13 字段(5 身份 + 5 环境 + 1 装备 + 1 AI 思考条 + 2 触发器 + 1 备注)
- [ ] TypeScript 类型定义 `ZoneSchema`(基于 zod 或 yup)
- [ ] 加载器 `loadZone(id: string): ZoneConfig`
- [ ] 加载器 `loadAllZones(): ZoneConfig[]`
- [ ] 启动时校验:6 个 yaml 都加载成功 + 字段类型校验通过 + `route_segment` 唯一 + `id` 唯一
- [ ] 单元测试:6 个 yaml 都能加载,字段缺失会抛错
- [ ] 默认值兜底:`thinking_bar` 默认 `required`,`status_pulse` 默认 `false`

## 验收

- 启动时打印"6 zones loaded: drafting, analyzing, clarifying, designing, executing, wrapup"
- 字段类型错误立即报错(如 `has_resource_tree` 写了 "yes" 而不是 true)
- 修改某个 yaml 后,Web 工作台启动能读到新配置(热加载?v1.0 不要求)
- `route_segment` 重复时启动失败并报错

## 依赖

- 无前置 issue
- 关联 ADR:[ADR-0012 §9](../docs/adr/0012-requirement-workbench-shell-topology.md)
- 关联原型:[11g-zone-tab-navigator.html](../docs/design/pages/11g-zone-tab-navigator.html)(7 Tab 配置可视化基线)
