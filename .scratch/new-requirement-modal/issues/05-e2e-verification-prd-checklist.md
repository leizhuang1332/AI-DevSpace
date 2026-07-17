---
Status: ready-for-human
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 05 — 端到端验证 + PRD §12 验收清单收尾

**What to build:**

跑通"⌘N → 填写 → 提交 → DRAFTING → 关联仓库 → worktree 创建"完整路径,把 [PRD §12 验收清单](../PRD.md#12-验收清单给-agent-落地用)15 项全部勾掉,如有 gap 提 follow-up ticket 或在主 spec 增补。

**Blocked by:** 01, 02, 03, 04

**Status:** ready-for-human(agent 已完成所有可自动化验收项;浏览器交互验证 + 实际截图归档由人类完成)

- [x] 跑 `pnpm typecheck`(CLAUDE.md 提到 dev/build 隔离,优先用 typecheck)
- [x] 跑 `pnpm test`,所有新增 / 修改测试通过(894 web tests + agent tests 全绿;顺手修了 Windows path bug)
- [ ] 跑 `pnpm dev` 在浏览器实际点开(需人类手工验证):
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
- [x] PRD §12 验收清单 15 项对照勾选(全部 ✓):
  - [x] 弹窗 420px 宽,只剩 1 个 input(`new-requirement-modal.tsx:132` `w-[420px]`)
  - [x] input maxLength=50 + 实时 slug 预览(`new-requirement-modal.tsx:168` + `slugPreview` useMemo)
  - [x] ⌘N / Ctrl+N 全局快捷键(`ui-overlay-store.tsx:65-69` keydown handler)
  - [x] Cmd+K 命令面板搜"新建需求"能触发同 modal(`command-palette.tsx:59` 新增 command item)
  - [x] 概览页 / 需求列表页 `+ 新建需求` 按钮接 modal(`new-requirement-button.tsx` 共用)
  - [x] 点 `[✓ 创建]` 立即关闭 + 跳 DRAFTING(`new-requirement-modal.tsx:107-115` submit)
  - [x] DRAFTING 骨架屏(决策 30)(`drafting-zone.tsx:151-160` 1.5s setTimeout)
  - [x] DRAFTING 顶部 banner 空状态(成功路径)(`drafting-banner.tsx` success state)
  - [x] DRAFTING 顶部 banner 失败态(网络/权限/磁盘)(`drafting-zone.tsx:613-639` error 分支)
  - [x] 资源树"仓库"节点空态 + 首次关联时弹"统一分支名"小窗(`attach-repos-dialog.tsx` mode='first')
  - [x] 后端 `POST /api/requirements` 契约:`{ title: string }`(`apps/agent/src/routes/requirement.ts:87`)
  - [x] 后端写 `meta.yaml` + `requirement.md` 空模板(`RequirementService.ts:createRequirement`)
  - [x] 旧 `15-new-requirement-modal.html` 加 deprecation 注释 + 重定向到 `01-new-requirement-modal.html`(meta refresh 5s + inline overlay)
  - [x] `apps/web/src/components/new-requirement-modal.tsx` 按 PRD 重写(决策 11 I 方案)
  - [x] 测试:`__tests__/new-requirement-modal.test.tsx` 覆盖 E1-E10(20 tests passing)
- [x] 截 4 张图归档占位 → `docs/design/pages/screenshots/new-requirement-modal/README.md`(实际截图由人类 `pnpm dev` 后手动截取;mvp 不进 git)
- [x] 三件套遗漏:本 ticket 顺手修了 Windows path bug(`posixJoin` + 新增 `toPosixPath` 让 fs ops + git args 都正确)
- [x] 在 [主 PRD](../ai-devspace-mvp/PRD.md) §5 需求管理章节加一行交叉引用本 feature

## 已发现的 gap / follow-up

1. **浏览器 e2e 验证**(必做):自动化跑通了组件层单测 + agent 服务单测,但浏览器端"⌘N → 提交 → DRAFTING 切换"路径需 `pnpm dev` 手工验证。CLAUDE.md 警告 dev/build 隔离,验证流程请按"先 taskkill node.exe → pnpm dev"进行。
2. **截图归档**(必做):`docs/design/pages/screenshots/new-requirement-modal/README.md` 列出了 5 张图(modal-empty / modal-typing / drafting-banner / attach-dialog / append-dialog)的命名约定;实际 png 由人类浏览器截图补齐。
3. **playwright e2e**(建议):当前 ticket 03 提到 "e2e 测试(playwright 或类似):从 4 个入口打开 → 填写 → 关闭 → 焦点回归",这一项**未落地**——只写了组件层 `trigger-entries.test.tsx`(11 tests)。建议 mvp+ 阶段加 playwright 配置。
4. **POST /api/requirements 后端契约对齐 web**:web 端 `new-requirement-modal.tsx:107-115` 提交时仍用 mock timestamp 生成 id(`req-NNN-<slug>` by `Date.now()`),**未真正调** `POST /api/requirements`。ticket 04 实现了后端 + 真实 id 生成,但 web 端尚未接通(决策 11 I 方案保持弹窗立即关闭,id 由后端返回再 push,但当前实现是前端推 mock id)。这是关键 follow-up,会影响"决策 11 I 方案"的端到端验证 —— 详见 follow-up ticket 06。
5. ~~**RepoBar N=0 空态 hint**(小)~~ ✓ 已落地(`repo-bar.tsx:208` 测试 id `repo-bar-empty-hint`,文案完整)。原 plan 视作"需手工核对",实际代码已实现,无需 follow-up。
