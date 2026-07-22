# ANALYZING 主区文档阅读器(ADR-0017)E2E 验收清单

> **本文档用途**:ticket 05 落地的端到端验收清单。仅文档形式,不参与自动化测试。
> Playwright 尚未在本项目建立独立框架(e2e 工作流是 ticket "setup Playwright e2e" 的
> 范畴),所以本 ticket 落地改为:
>
> 1. **单元 + 集成层覆盖**:`apps/web/src/__tests__/` 下 `analyzing-zone.test.tsx` /
>    `analyzing-zone-synthetic.test.tsx` / `analyzing-zone-narrow.test.tsx`(本 ticket 新增)
>    / `document-reader-pane.test.tsx` 共 **71 个 vitest 用例**
> 2. **人工 + 截图证据**(本文档):按 ADR-0017 D1-D6 + ticket 05 窄视口 验收项,
>    跑 6 步手工复测并贴截图 / 文字说明;任一步失败 → ticket 标 ready-for-agent 返工
>
> **跑测环境**:开发机 + `pnpm dev` + 浏览器 DevTools 切设备 viewport。

---

## 前置条件

- [ ] 仓库根 `pnpm install` 已完成
- [ ] `pnpm --filter @ai-devspace/web dev` 跑起 Next.js(`http://localhost:3333`)
- [ ] 浏览器访问 `http://localhost:3333/requirements/req-001/analyzing/`
      (req-001 已预置退款功能优化的 PRD + aux,见 `analyzing-designing-fs-loader.test.ts`)
- [ ] DevTools 模拟器可切换:"Desktop (≥1024px)" / "Mobile (<1024px)"

---

## 验收步骤

### 步骤 1 · 桌面形态基础渲染

**期望**(ADR-0017 D1):

- [ ] 进入 `/requirements/req-001/analyzing/` → 看到 ANALYZING ② 徽章 + 进度 + 状态
- [ ] 准入仪表板 5 维度卡可见(ADR-0013 D4)
- [ ] SessionTabs(多会话,VS3 基线)
- [ ] 主区 2:1 分栏:
  - 左栏 2 份(≈ 66.67%):`<DocumentReaderPane>`,Tab 栏 + 阅读区
  - 右栏 1 份(≈ 33.33%):Summary + ProductList
- [ ] 左栏 Tab 列表 = [PRD, aux-api.md · 🔗 N, aux-data.md · 🔗 N](按 usage_tag 排序)
- [ ] 右栏 Summary 标题 = "退款功能优化"
- [ ] 顶部三 stats:子问题 5 / 风险点 3 / 方案方向 2

**截图位**:`docs/_artifacts/ticket-05/step-01-desktop.png`

**自动化证据**:
- `analyzing-zone.test.tsx` 'AnalyzingZone · 满数据渲染' describe 块
- `analyzing-zone.test.tsx` '统计' 子用例

---

### 步骤 2 · 阅读器 Tab 切换 + 引用计数

**期望**(ADR-0017 D2):

- [ ] 默认 active Tab = PRD → 正文渲染 PRD Markdown
- [ ] PRD Tab 标签显示 `PRD · 🔗 3`(req-001 数据有 3 处 PRD 引用)
- [ ] 点击 "aux-api.md" Tab → 阅读区切换到 `aux-api.md` body
      (`currentFile="aux-api.md"`,见 `data-current-file` 属性)
- [ ] Tab 切换无网络请求(DevTools Network 面板:Network 中无新请求)
- [ ] 键盘 ← → 在 tablist 上左右切换 Tab 工作(对 a11y 友好)

**截图位**:`docs/_artifacts/ticket-05/step-02-tab-switch.png`

**自动化证据**:
- `document-reader-pane.test.tsx` 'PRD + AuxFile,默认 Tab = PRD' describe 块
- 'A11y + 键盘 ← → 切换 Tab' describe 块

---

### 步骤 3 · 画线联动 — 点右栏卡片切左栏 Tab + 高亮 pulse

**期望**(ADR-0017 D4):

- [ ] 点右栏子问题卡片 Q1(关联 aux-api.md 行 [0,1))→ 左栏自动切到 "aux-api.md" Tab +
      滚到对应行 + 高亮 span 加 `animate-pulse-brand` class + 1.5s 后移除
- [ ] 点右栏风险点 R1(关联 PRD 行 [2,3))→ 左栏自动切回 PRD Tab + 滚 + pulse
- [ ] 点右栏无 source_ref 的卡片(留 1 个无出处风险做测试)→ 弹 toast
      "⚠️ 该产物未关联原文出处",Tab 不变

**截图位**:`docs/_artifacts/ticket-05/step-03-linkage.png`

**自动化证据**:
- `analyzing-zone.test.tsx` '画线联动(ticket 03)' describe 块
- `document-reader-pane.test.tsx` 'pulseRef 联动' describe 块

---

### 步骤 4 · 增改风险 / 方案 → UI 同步(ADR-0017 D6)

**期望**(ticket 04 + D6):

- [ ] 点击右栏底部 "+ 新增风险" → 弹添加对话框
- [ ] 输入 risk 标题"测试" → 选 none 的关联出处(或默认空)→ 保存
- [ ] 新卡片立即出现在"风险点"分组,标题 = "测试"
- [ ] 新卡片有 `data-synthetic="true"` 属性 + 显示 ⚠️ "无出处" 角标
- [ ] 点击新卡片 → 弹 toast"未关联原文出处"(联动路径与无 source_ref 卡片一致)

**截图位**:`docs/_artifacts/ticket-05/step-04-synthetic-add.png`

**自动化证据**:
- `analyzing-zone-synthetic.test.tsx`(2 个集成用例)

---

### 步骤 5 · 资产 / 多源引用

**期望**(ADR-0017 D2):

- [ ] PRD 含图片引用 `![](assets/prd-1.png)` → 阅读器渲染图片
- [ ] 图片若有 source_ref 引用 → 加 `ring-brand-300` + 🔗 角标
- [ ] 若 aux file 也加 source_ref → aux Tab 标签显示"🔗 N"

**截图位**:`docs/_artifacts/ticket-05/step-05-asset-and-aux.png`

**自动化证据**:
- `document-reader-pane.test.tsx` 'Asset 内联' describe 块
- '画线高亮渲染' describe 块

---

### 步骤 6 · 窄视口(ticket 05 · 候选 A)

**期望**(ticket 05 · ADR-0017 D1 补完):

- [ ] DevTools 切到 `Mobile` 模拟(≤ 1023px,推荐 iPhone 14 390x844)
- [ ] 桌面 2:1 grid 隐藏
- [ ] 主区顶部出现 `<div role="tablist" data-testid="analyzing-narrow-tabs">`
      两 Tab:"📑 文档" / "🎯 产物"
- [ ] **默认 active = "产物"**:看到 Summary + ProductList;`<DocumentReaderPane>` 不渲染
- [ ] 点击 "📑 文档" Tab → 切到全宽阅读器:<DocumentReaderPane>;Summary +
      ProductList 隐藏
- [ ] 点击 "🎯 产物" Tab → 切回 Summary + ProductList;阅读器隐藏
- [ ] 联动:窄视口下点右栏子问题卡片 → 自动切到"文档" Tab + 左栏切对应 aux Tab +
      pulse 1.5s(行为同桌面)
- [ ] 切回 Desktop 模拟 → 桌面 2:1 形态自动恢复(data-layout 切换
      `narrow-tabs` ↔ `doc-reader-2-1`)

**截图位**:`docs/_artifacts/ticket-05/step-06-narrow-tabs.png`

**自动化证据**:
- `analyzing-zone-narrow.test.tsx`(10 个用例,本 ticket 新增)
- `analyzing-zone.test.tsx` '桌面形态 mock' 子用例(防止回归)
- vitest `matchMedia` stub(见 `apps/web/vitest.setup.ts`)

---

## 性能 / 体积监控(ticket 05 AC)

| 项目 | 期望 | 实测 | 备注 |
|---|---|---|---|
| chunks.jsonl(100 条 subproblem/risk/option × 50 字节 source_refs) | ≈ 5KB | 待跑 | 用 req-001 fixture 实测 |
| `AnalyzingData` RSC 序列化(加 3 字段后) | < 30KB(PRD < 50KB) | 待跑 | 用 req-001 SSR 实测 |
| Lighthouse LCP / CLS | 不退化超 10% | 待跑 | dev 环境跑一次 |

---

## 提交前最终自查

- [ ] 本文档 6 步全部打勾(步骤 1-6)
- [ ] 截图全部贴到 `docs/_artifacts/ticket-05/`(或附在本 ticket 评论)
- [ ] `pnpm --filter @ai-devspace/web test` 全绿(仅已知 2 条 HOME 路径 pre-existing
      失败,非本 ticket 范围)
- [ ] `pnpm typecheck` 仅剩 pre-existing `requirements-root.server.test.ts`
      `skipReqMd` 错误(与本 ticket 无关)
- [ ] 本 ticket 评论追加 6 步验收记录 + 截图链接

---

## 变更摘要

- `apps/web/src/components/analyzing-zone.tsx` —— 窄视口 Tab + `NarrowLayout` 子组件
- `apps/web/src/lib/use-media-query.ts`(新增)—— SSR-safe media query hook
- `apps/web/vitest.setup.ts` —— `window.matchMedia` 桩 + `setMatchMedia/resetMatchMedia` 测试工具
- `apps/web/src/__tests__/analyzing-zone-narrow.test.tsx`(新增)—— 10 个窄视口用例
- `apps/web/src/lib/__tests__/use-media-query.test.tsx`(新增)—— 3 个 hook 用例
- `apps/web/src/components/document-reader-pane.tsx` —— JSDoc ADR-0017 D2 引用 +
      Known limitations
- `docs/adr/0017-analyzing-main-document-reader.md` —— 变更记录追加 ticket 01-06 落地
- `apps/web/src/__tests__/__fixtures__/analyzing-doc-reader-e2e.md`(本文档)
