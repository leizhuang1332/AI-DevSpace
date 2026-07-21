---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 (全量验收 + 窄视口 UX)
Slice: 5/5
Priority: P2
---

# 05 — 窄视口折叠 + 全量回归 + E2E 验收

## What to build

把 [ADR-0017](docs/adr/0017-analyzing-main-document-reader.md) 整套改造在**窄视口**(`<1024px`)下的 UX 拍板落地,并补齐**全量回归测试 + E2E 验收用例**,确保 4 个 P0/P1 ticket 落地后整链不破。

> **本 ticket 不做**:新功能;只补视口适配 + 测试覆盖 + 文档/CHANGELOG。

## Blocked by

01 + 02 + 03 + 04 全部完成

## Acceptance criteria

### 窄视口适配(<1024px)

- [ ] ADR-0017 D1 注:"`<1024px` 时左栏折叠形态本 ADR 不锁,落地 issue 决定" —— **本 ticket 决定此 UX**
- [ ] 候选形态(本 ticket 内部选择,无需再 grill):

  | 候选 | UX |
  |---|---|
  | **A · 垂直堆叠 + 顶部 Tab 切换"文档 / 产物"** ⭐ 推荐 | 主区顶部加 `<div role="tablist">` 两个 Tab:📑 文档 / 🎯 产物;默认显示产物(Tab 顺序与桌面相反,因为产物是用户主要看的);Tab 切换无动画 |
  | B · 主区全宽默认显示产物 + 左下浮动按钮"📑 查看文档" | 弹抽屉 |
  | C · 保持 2:1 但比例改 1:1 | 简单但阅读体验差 |

- [ ] 实现候选 A:
  - `analyzing-zone.tsx` 检测 `useMediaQuery('(min-width: 1024px)')` → 桌面用 2:1,窄屏用 Tab 切换
  - 窄屏 DOM:`<div data-testid="analyzing-narrow-tabs" role="tablist">` 两个 button + 条件渲染左 / 右栏
  - 默认 active = '产物'(让用户一打开就看到产物)
  - 切到"文档" Tab → 全屏渲染 `<DocumentReaderPane>`
- [ ] 窄视口下,**联动行为不变**(点产物卡片 → 切到"文档" Tab + 高亮 pulse)

### 全量回归测试

- [ ] **现有测试** `pnpm test`(vitest run) 全部通过,无回归
- [ ] **现有测试** `pnpm typecheck`(`tsc --noEmit`) 全部通过
- [ ] **analyzing-zone.test.tsx** 关键场景补全:
  - 桌面 2:1 渲染(`min-width: 1024px` mock)
  - 窄屏 Tab 切换渲染(`max-width: 1023px` mock)
  - 空 PRD + 空 aux 时空态文案
  - 单 PRD + 多 aux 时 Tab 顺序(PRD → aux 按 usage_tag 排序)
- [ ] **新增 E2E**(`tests/e2e/analyzing-doc-reader.spec.ts`,Playwright):
  - 进入 `/requirements/req-001/analyzing/` → 看到左栏 Tab 栏(PRD / aux-api.md / aux-data.md)+ 文档阅读器 + 右栏产物
  - Tab 切换 → 阅读区内容变化
  - 点右栏子问题卡片 → 左栏切到对应 Tab + 高亮 pulse
  - 右栏"+ 新增子问题" → 输入 + 保存 → 新卡片显示"⚠️ 无出处"角标
  - 窄屏 resize → 顶部 Tab 切换形态激活

### 文档与变更记录

- [ ] `docs/adr/0017-analyzing-main-document-reader.md` 末尾"变更记录"追加本 ticket 落地日期
- [ ] `apps/web/src/components/analyzing-zone.tsx` 顶部 JSDoc 更新:
  - ASCII 布局图从"思考流(左) + 产物(右)1:1" 改为"文档阅读器(左,2 份) + 产物(右,1 份)2:1"
  - 引用 ADR-0017
- [ ] `apps/web/src/components/document-reader-pane.tsx` 顶部 JSDoc:
  - 引用 ADR-0017 D2
  - 解释 Tab 顺序 / 引用计数 / 切换不触发网络
- [ ] 若 ADR-0013 issue 文件(`.scratch/ai-devspace-mvp/issues/19b-analyzing-thinking-stream-interject.md`)状态需更新:
  - status: `superseded-by` 指向 ADR-0017(若项目使用此 label)
  - 或在 ADR-0013 末尾追加"v2 增量由 ADR-0017 承载"说明

### 集成验证(端到端)

- [ ] 在 `req-001` 数据上验证完整链路:
  1. 进入 DRAFTING 上传一份 .docx PRD(模拟"退款功能优化")
  2. 切到 ANALYZING → 左栏显示 PRD 全文(图片内联)
  3. AI emit 模拟 chunks 含 source_refs(手工 mock)
  4. 右栏显示 5 子问题 + 3 风险 + 2 方案;每卡片点 → 左栏切 Tab + pulse
  5. 点"+ 新增风险" → 输入"测试" → 保存 → 卡片显示"⚠️ 无出处"
  6. 在 aux file 中也加几个 source_refs → Tab 显示"🔗 N 处引用"
- [ ] 验收清单 `apps/web/src/__tests__/__fixtures__/analyzing-doc-reader-e2e.md`(新增或追加):
  - 6 步完整跑通截图 / 文字说明
  - 任何一步失败 → ticket 标 `ready-for-agent` 返工

### 性能与体积

- [ ] chunks.jsonl 体积监控:100 条 subproblem/risk/option × 50 字节 source_refs ≈ 5KB;**实测**验证不超预期
- [ ] RSC 序列化大小:`AnalyzingData` 加 3 字段后 SSR HTML 体积增量 < 30KB(PRD 1MB 时不现实,本期假定 PRD < 50KB);若超 → 改 lazy load(本期不做)
- [ ] Lighthouse / Web Vitals 验证:LCP / CLS 不退化超 10%

### 已知限制文档化

- [ ] `apps/web/src/components/document-reader-pane.tsx` JSDoc 加一段"Known limitations":
  - lineRange 漂移(AI 输出的 lineRange 与最新 PRD 行号不一致时)→ UI 高亮错位,留 v2 修
  - Asset 高亮基于 `assetId` 名匹配,rename 后失效
  - 反向联动(点左栏 → 滚右栏)未实装
  - Synthetic chunk 不持久化(刷新丢)

## 备注 / 提示

- **Playwright 已在项目内**(如未在,需先独立 ticket "setup Playwright e2e")
- **窄视口检测**:`useMediaQuery` 若项目无 hook,可用 `window.matchMedia` + `useEffect` 包一个;不要用 SSR-unsafe 的 `window.innerWidth` 直读
- **回归测试覆盖率目标**:本 ticket 完成后,`analyzing-zone.tsx` 改动行覆盖率 ≥ 80%,`document-reader-pane.tsx` ≥ 90%
- **5 个 ticket 实施顺序**:01 → 02 → 03 → 04 → 05(本);不允许乱序;若 03 提前完成可与 04 并行,但落地 PR 建议串行
- **CHANGELOG**:本项目若无 CHANGELOG.md,本 ticket 不创建;有则追加"v1.0.4 - ANALYZING 主区文档阅读器(ADR-0017)"

## 落地后最终验收对应 ADR-0017

- D1(2:1)✓ ticket 02
- D2(Tab 栏 + 阅读器 + Asset 内联)✓ ticket 02
- D3(source_refs 字段)✓ ticket 01 + 03
- D4(联动)✓ ticket 03
- D5(SSR 装载)✓ ticket 01
- D6(synthetic chunk)✓ ticket 04
- 窄视口✓ ticket 05(本)
- 全量回归 + E2E✓ ticket 05(本)