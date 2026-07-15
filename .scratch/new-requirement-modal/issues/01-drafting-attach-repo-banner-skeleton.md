---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 01 — DRAFTING 资源树 + 关联仓库弹层 + 顶部 banner + 骨架屏

**What to build:**

用户在新建弹窗提交后跳转到 DRAFTING 工位(见 ticket 04 的后端 API + 当前已重写的 React 组件),看到:

1. **资源树"仓库"节点空态**(决策 50 / Q7):标题 `📦 仓库 (0)` + 右侧 `+` 按钮;节点下方有浅色 hint 卡 `💡 首次添加仓库时会请你填写统一分支名`(决策 24 陪伴感)
2. **DRAFTING 骨架屏**(决策 30):进入时 shimmer 1.5s,内容占位 + 右上角"正在创建需求…"提示
3. **顶部 banner(成功路径)**:淡黄 `#fffbeb` 底,文字 `📦 未关联任何仓库 · 添加仓库后将自动创建 worktree`,右侧 `[+ 关联仓库]` 按钮 + `✕` 关闭按钮;**首次关联仓库成功后 banner 自动消失**(决策 E10)
4. **关联仓库弹层(首次关联 N=1)**:480px 宽,标题 `关联仓库 · <需求 title>`,字段 1 是仓库选择(checkbox 列表,从全局仓库池 + `+ 添加新仓库(粘贴 Git URL)` 行),字段 2 是 `统一分支名 *` input(autoFocus,placeholder `feat/<slug>`,maxLength=100),hint `基于默认 base 分支(main),可在仓库设置覆盖`;footer 左 `此分支将应用于 N 个仓库`,右 `[取消]` / `[✓ 添加]`
5. **追加关联仓库弹层(N>1)**:同上但**不显示**"统一分支名" input,顶部紫色 banner 提示 `将使用统一分支名 feat/refund-optimization(创建时已锁定)`;标题改为 `追加仓库 · <title>`

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 进入 `/requirements/<new-id>/drafting/` 显示 shimmer 骨架屏 1.5s 后切换
- [ ] 资源树"仓库"节点空态可见(标题 `📦 仓库 (0)` + `[+]` + hint 卡)
- [ ] 顶部淡黄 banner 可见,文案与图标正确
- [ ] 点 banner `[+ 关联仓库]` → 弹 480px"关联仓库"弹层,checkbox 列表 + 统一分支名 input
- [ ] 提交弹层 → 资源树"仓库"节点更新为 `(1)` 并列出已选 repo + banner 自动消失
- [ ] 关 banner(点 `✕`)后,资源树"仓库"节点仍是引导入口(不闪烁、不推送)
- [ ] 资源树点 `[+]` 第二次 → 弹"追加仓库"简化版(无分支名 input,顶部紫色提示)
- [ ] 提交追加弹层 → 资源树更新为 `(2)`,沿用首条统一分支名
- [ ] 提交时若 name 空 / 字符非法,input 校验拦截,不调 API
- [ ] 提交时若 API 失败(由 ticket 04 mock 触发),banner 变红色 `#fef2f2`,文案 `<错误类型>`,右 `[重试]` 按钮
- [ ] 焦点陷阱:Tab/Shift+Tab 在弹层内循环;ESC 关闭;关闭后焦点回触发按钮
- [ ] 视觉对照 [docs/design/pages/01-new-requirement-modal.html §5/§6/§7](../../../../docs/design/pages/01-new-requirement-modal.html) 三个 section
- [ ] 组件 API 遵守 [UI-POLISH-SPEC §8/§9](../../UI-POLISH-SPEC.md)
- [ ] 单元测试覆盖 banner 三态(空/成功/失败)+ 弹层二态(首次/追加)+ 资源树节点更新
