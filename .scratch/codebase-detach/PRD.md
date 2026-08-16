---
Status: ready-for-agent
Type: prd
Created: 2026-08-16
Feature: codebase-detach
Supersedes: 无(在 ADR-0030 架构上的增量)
Implements: 用户原诉求「增加取消关联仓库功能」
Implements ADR: docs/adr/0034-detach-requirement-codebase.md
Related:
  - .scratch/repo-registry-clone/PRD.md(codebase/ 路径源头)
  - docs/adr/0030-repo-registry-and-per-requirement-clone.md(本 feature 依赖的架构)
  - docs/adr/0033-incremental-attach-repos.md(attach 镜像对称对象)
  - docs/agents/issue-tracker.md(feature-per-directory 约定)
  - docs/agents/domain.md(术语 SSoT)
---

# 需求级 codebase detach · PRD

> 本 PRD 是 ADR-0034 的任务拆分文档。10 条 grill-with-docs 决策已锁,
> 实施按 `issues/01-detach-repo-from-requirement.md` 推进。

---

## 1. Problem Statement

DRAFTING 页面 RepoBar 展开态 chip 上的红色 ✕ 按钮当前只更新前端 React state,
后端从未收到请求:

- [apps/web/src/components/repo-bar.tsx:425-443](apps/web/src/components/repo-bar.tsx#L425-L443) 触发点
- [apps/web/src/components/drafting-zone.tsx:678-681](apps/web/src/components/drafting-zone.tsx#L678-L681) 纯前端 state 改动

导致:

1. 用户点了 ✕ 以为已取消关联,但 SSR 数据从 fs 派生,下次进 DRAFTING chip 又出现
2. `requirements/<reqId>/codebase/<repoName>/` 目录一直堆积(「以为」detach 后,clone 残留不清)
3. attach 失败的回退路径不可逆 —— 想换个干净仓库重试,只能保留原 codebase

## 2. 预期结果

详见 ADR-0034 Context / Decision:

- ✕ → 弹 DetachCodebaseDialog 二次确认 → 确认后 HTTP DELETE
- `codebase/<name>/` 目录被 `safeRm` 清理 + `.pending-<name>` 标记一并清
- N=1→0 时顺带清 `meta.yaml::branchName`(per-requirement 字段,N≥1 时保留)
- repos.yaml 全局条目**永远不动**(决策 b 沿用 ADR-0030 D5)

## 3. 决策账本

10 条 grill-with-docs 共识已写入 `decisions.md`,本文档仅列概要:

| # | 决策 | 选择 |
|---|---|---|
| Q1 | 删除范围 | rm 目录 + (N=1→0 时清 branchName) |
| Q2 | 状态门禁 | 仅 DRAFTING |
| Q3 | 二次确认 | 弹确认框 |
| Q4 | branchName 清理 | 仅 N 从 1 → 0 |
| Q5 | 并发保护 | per-requirement mutex |
| Q6 | 端点 | `DELETE /api/requirement/:id/codebase/:name` |
| Q7 | 写盘顺序 | rm 先,再 meta.yaml |
| Q8 | UI 策略 | 悲观更新 |
| Q9 | 测试 | service + route 集成,真 fs 不真 clone |
| Q10 | 文档 | ADR-0034 + 本目录 + domain.md |

## 4. 改动清单

详见 `issues/01-detach-repo-from-requirement.md`。

## 5. 验收

详见 `issues/01-detach-repo-from-requirement.md` 的「验收」段。

## 6. 不做(显式排除)

- 不删 `repos.yaml` 全局条目(`DELETE /api/repos/:name` 是独立路径)
- 不动 KB / RAG / 向量索引(本期不存在)
- 不扩 ANALYZING / BOARD / WRAP-UP 状态的 detach 入口
- 不加智能确认(git status 探查)
- 不加撤销 toast
- 不改 `CodebaseManager.remove`(只调用)
- 不走 ADR-0023 MCP wrapper 守门(非 MCP 改动)

## 7. 风险

详见 ADR-0034 Consequences。