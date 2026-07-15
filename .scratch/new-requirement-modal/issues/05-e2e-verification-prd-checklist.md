---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 05 — 端到端验证 + PRD §12 验收清单收尾

**What to build:**

跑通"⌘N → 填写 → 提交 → DRAFTING → 关联仓库 → worktree 创建"完整路径,把 [PRD §12 验收清单](../PRD.md#12-验收清单给-agent-落地用)15 项全部勾掉,如有 gap 提 follow-up ticket 或在主 spec 增补。

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-agent

- [ ] 跑 `pnpm typecheck`(CLAUDE.md 提到 dev/build 隔离,优先用 typecheck)
- [ ] 跑 `pnpm test`,所有新增 / 修改测试通过
- [ ] 跑 `pnpm dev` 在浏览器实际点开:
  - ⌘N 全局键触发弹窗
  - Cmd+K 搜"新建需求"触发
  - 概览页 / 需求列表页按钮触发
  - 弹窗输入"退款功能优化",slug 预览显示 `req-NNN-退款功能优化`
  - 粘贴路径非法字符被实时过滤
  - 提交后弹窗立即关,跳 `/requirements/<id>/drafting/`
  - DRAFTING 骨架屏 1.5s 后切换,顶部淡黄 banner 出现
  - 资源树 `[+]` → 弹 480px 关联仓库弹层 → 填统一分支名 → 提交
  - banner 自动消失,资源树显示已选 repo
  - 再点 `[+]` → 弹追加仓库简化版
- [ ] PRD §12 验收清单 15 项对照勾选(全部 ✓ 才能 close):
  - [ ] 弹窗 420px 宽,只剩 1 个 input
  - [ ] input maxLength=50 + 实时 slug 预览
  - [ ] ⌘N / Ctrl+N 全局快捷键
  - [ ] Cmd+K 命令面板搜"新建需求"能触发同 modal
  - [ ] 概览页 / 需求列表页 `+ 新建需求` 按钮接 modal
  - [ ] 点 `[✓ 创建]` 立即关闭 + 跳 DRAFTING
  - [ ] DRAFTING 骨架屏(决策 30)
  - [ ] DRAFTING 顶部 banner 空状态(成功路径)
  - [ ] DRAFTING 顶部 banner 失败态(网络/权限/磁盘)
  - [ ] 资源树"仓库"节点空态 + 首次关联时弹"统一分支名"小窗
  - [ ] 后端 `POST /api/requirements` 契约:`{ title: string }`
  - [ ] 后端写 `meta.yaml` + `requirement.md` 空模板
  - [ ] 旧 `15-new-requirement-modal.html` 加 deprecation 注释 + 重定向到 `01-new-requirement-modal.html`
  - [ ] `apps/web/src/components/new-requirement-modal.tsx` 按 PRD 重写
  - [ ] 测试:`__tests__/new-requirement-modal.test.tsx` 覆盖 E1-E10
- [ ] 截 4 张图归档到 `docs/design/pages/01-new-requirement-modal.html` 末尾(弹窗 / DRAFTING banner / 关联仓库弹层 / 追加仓库弹层)
- [ ] 如果发现 PRD / SPEC / HTML 三件套遗漏或不一致 → 补 commit,或提 follow-up ticket
- [ ] 在 [主 PRD](../ai-devspace-mvp/PRD.md) §5 需求管理章节加一行交叉引用本 feature
