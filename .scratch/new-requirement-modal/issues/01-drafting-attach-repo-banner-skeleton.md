---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 01 — DRAFTING 顶部 banner + 底部 RepoBar N=0 空态 + 关联仓库弹层

**What to build:**

用户在新建弹窗提交后跳转到 DRAFTING 工位(见 ticket 04 的后端 API + 当前已重写的 React 组件),看到:

1. **DRAFTING 骨架屏**(决策 30):进入时 shimmer 1.5s,内容占位 + 右上角"正在创建需求…"提示
2. **顶部 banner(成功路径)**:淡黄 `#fffbeb` 底,文字 `📦 未关联任何仓库 · 添加仓库后将在 RepoBar 操作`,右侧 `[+ 关联仓库]` 按钮 + `✕` 关闭按钮;**首次在 RepoBar 成功勾选第一个 repo 后 banner 自动消失**(决策 E10)
3. **底部 RepoBar(issue 08 已有)**:**扩展 N=0 空态** —— 当前 RepoBar 在 `selectedRepoIds.length === 0` 时只显示 "＋ 添加仓库…" 占位 chip;本 ticket 给空态加一行 hint 文字 `💡 首次添加仓库时会请你填写统一分支名`(决策 24 陪伴感),并把 chip 样式从纯占位改为主色淡底
4. **关联仓库弹层(首次关联 N=1)**:480px 宽,标题 `关联仓库 · <需求 title>`,字段 1 是仓库选择(checkbox 列表,从全局仓库池 + `+ 添加新仓库(粘贴 Git URL)` 行),字段 2 是 `统一分支名 *` input(autoFocus,placeholder `feat/<slug>`,maxLength=100),hint `基于默认 base 分支(main),可在仓库设置覆盖`;footer 左 `此分支将应用于 N 个仓库`,右 `[取消]` / `[✓ 添加]`;**触发方式**:顶部 banner `[+]` 按钮 / RepoBar `＋` 占位 chip
5. **追加关联仓库弹层(N>1)**:同上但**不显示**"统一分支名" input,顶部紫色 banner 提示 `将使用统一分支名 feat/refund-optimization(创建时已锁定)`;标题改为 `追加仓库 · <title>`

**Blocked by:** None — can start immediately.

**注:**DRAFTING 工位当前**没有资源树**(参见 `apps/web/src/components/drafting-zone.tsx` 实际结构 + issue 18 / 23 演变),仓库关联通过**底部 RepoBar** 实现。本 ticket 在 RepoBar 现有 issue 08 基础上扩展 N=0 空态和统一分支名弹层,**不引入资源树**。

**Status:** ready-for-agent

- [ ] 进入 `/requirements/<new-id>/drafting/` 显示 shimmer 骨架屏 1.5s 后切换
- [ ] 顶部淡黄 banner 可见,文案与图标正确,`[+ 关联仓库]` + `✕` 按钮就位
- [ ] 底部 RepoBar N=0 空态可见(原有 `＋ 添加仓库…` chip + 新增 hint `💡 首次添加仓库时会请你填写统一分支名`)
- [ ] 点 banner `[+ 关联仓库]` → 弹 480px"关联仓库"弹层,checkbox 列表 + 统一分支名 input
- [ ] 点 RepoBar `＋` 占位 chip → 弹同 480px"关联仓库"弹层(两个入口触发同一个弹层)
- [ ] 提交弹层 → RepoBar 显示已选 repo chips + 顶部 banner 自动消失
- [ ] 关 banner(点 `✕`)后,RepoBar 仍是引导入口(不闪烁、不推送)
- [ ] RepoBar 点 `＋`(N≥1 后)→ 弹"追加仓库"简化版(无分支名 input,顶部紫色提示)
- [ ] 提交追加弹层 → RepoBar 多一个 repo chip,沿用首条统一分支名
- [ ] 提交时若 name 空 / 字符非法,弹层 input 校验拦截,不调 API
- [ ] 提交时若 API 失败(由 ticket 04 mock 触发),banner 变红色 `#fef2f2`,文案 `<错误类型>`,右 `[重试]` 按钮
- [ ] 焦点陷阱:Tab/Shift+Tab 在弹层内循环;ESC 关闭;关闭后焦点回触发按钮(banner `[+]` 或 RepoBar `＋`)
- [ ] 视觉对照 [docs/design/pages/01-new-requirement-modal.html §5/§6/§7](../../../../docs/design/pages/01-new-requirement-modal.html) 三个 section(已修订为 RepoBar 形态)
- [ ] 组件 API 遵守 [UI-POLISH-SPEC §8/§9](../../UI-POLISH-SPEC.md)(已修订为 RepoBar 形态)
- [ ] 单元测试覆盖 banner 三态(空/成功/失败)+ 弹层二态(首次/追加)+ RepoBar N=0 / N≥1 切换
