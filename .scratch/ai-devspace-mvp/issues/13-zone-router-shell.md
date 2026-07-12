---
Status: ready-for-agent
Type: task
Stage: 2
---

# 13 - `[id]/[zone]/` 路由层级 + 工位专属 shell

## 目标

把 [ADR-0012 §2-4](../docs/adr/0012-requirement-workbench-shell-topology.md) 的 shell 拓扑落地为 Next.js 14 App Router 路由 + 工位专属 shell。

## 范围

- [ ] Next.js dynamic route: `app/(workspace)/requirements/[id]/[zone]/page.tsx`
- [ ] 工位专属 shell: `app/(workspace)/requirements/[id]/[zone]/layout.tsx`
  - 读 zone 注册表,按 `has_resource_tree` 决定是否渲染资源树
  - 读 zone 注册表,按 `has_inline_rail` 决定是否渲染 Inline 栏
  - 主区交给 `page.tsx` 的工位布局组件
- [ ] 路由验证:访问不存在的 zone 时 404,访问不存在的 id 时走 PRD 既有 fallback
- [ ] Shell 层 1 增强: `app/(workspace)/layout.tsx` 加 ZoneBar slot(7 Tab,只在 `[id]/[zone]/` 路由渲染)
- [ ] `/requirements/[id]/page.tsx`:重定向到 cookie `last_zone` 或默认 `drafting`
  - **永不**基于 `meta.yaml.status` 推断(决策 15 反对状态机)
- [ ] 单元测试:6 个 zone 路由都能打开,资源树/Inline 栏按 yaml 决定

## 验收

- 访问 `/requirements/REF-001/` → 自动重定向到 `/requirements/REF-001/drafting/`
- 访问 `/requirements/REF-001/wrap-up/` → WRAP-UP 工位,资源树有,Inline 栏无
- 访问 `/requirements/REF-001/clarifying/` → CLARIFYING 工位,资源树无,Inline 栏无(主区全宽)
- 访问 `/requirements/REF-001/unknown-zone/` → 404
- 重定向 cookie `last_zone=executing` 后访问 `/requirements/REF-001/` → 跳到 `/executing/`

## 依赖

- [12-zone-registration-yaml.md](12-zone-registration-yaml.md)
- 关联 ADR:[ADR-0012 §2-4](../docs/adr/0012-requirement-workbench-shell-topology.md)
- 关联 ADR:[ADR-0012 §8 重定向逻辑](../docs/adr/0012-requirement-workbench-shell-topology.md)
