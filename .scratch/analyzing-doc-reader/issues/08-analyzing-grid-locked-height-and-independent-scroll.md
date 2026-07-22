---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017, ADR-0018, ADR-0019]
Implements: ADR-0019
Slice: 8/8
Priority: P0
---

# 08 — `analyzing-grid` 锁高度 + 左右两栏独立滚动(契约显式化)

## What to build

把 [ADR-0019](docs/adr/0019-analyzing-grid-locked-height-independent-scroll.md) 的决策落到代码层:**把"analyzing-grid 整体固定高度 / 内容超出滚动 / 左右两栏独立滚动"从隐式行为显式化为契约**,同时清除相关死代码。

> **本 ticket 不做**:重新设计 grid 高度算法(仍走"父容器高度 - 上方固定条 - 下方 InterjectInput");把 InterjectInput 移出 analyzing-main;引入 Playwright e2e;改 SVG 跨列画线视觉。

## Blocked by

无前置依赖(ticket 01~07 全部完成,可独立推进)。

## Acceptance criteria

### 1. 主区外层锁外(`analyzing-main`)

- [ ] `apps/web/src/components/analyzing-zone.tsx` 中 `[data-testid="analyzing-main"]` 的 className 从 `flex-1 overflow-auto px-6 py-6 flex flex-col gap-5` 改为 `flex-1 min-h-0 overflow-hidden px-6 py-6 flex flex-col gap-5`
  - 验证条件:测试断言 `expect(analyzingMain.className).toContain('overflow-hidden')` + `expect(analyzingMain.className).not.toContain('overflow-auto')` 同时成立

### 2. grid 自身锁高(桌面形态)

- [ ] `analyzing-grid` 容器 className 加 `overflow-hidden`,保留 `relative grid grid-cols-1 lg:grid-cols-3 gap-5 flex-1 min-h-0`
  - 验证条件:测试断言 `expect(analyzingGrid.className).toContain('overflow-hidden')`

### 3. 两列各自 `overflow-hidden`(列内 body 自滚)

- [ ] `analyzing-left-col` className 加 `overflow-hidden`,保留 `col-span-1 lg:col-span-2 flex flex-col min-h-0 relative`
- [ ] `analyzing-right-col` className 加 `overflow-hidden`,保留 `col-span-1 flex flex-col gap-5 min-h-0`
- [ ] DocumentReader.body / ProductList body **内部 `overflow-auto` 不变**(继续由组件内 body 处理滚动)
- [ ] Tab 栏(在 DocumentReader body 内)和 Summary 卡片(在 right-col 顶层)继续顶部吸顶,不随 body 滚动消失

### 4. 窄视口同契约(`NarrowLayout`)

- [ ] `<div data-testid="analyzing-narrow" ...>` className 从 `flex flex-col gap-3 flex-1 min-h-0` 改为 `flex flex-col gap-3 flex-1 min-h-0 overflow-hidden`
- [ ] `<div data-testid="analyzing-narrow-body" ...>` className 从 `flex-1 min-h-0` 改为 `flex-1 min-h-0 overflow-hidden`
- [ ] DocumentReader / Summary + ProductList 内部 `overflow-auto` 不变

### 5. 拆 `mainScrollRef` + 滚动位置持久化(死代码)

- [ ] 删 `const mainScrollRef = useRef<HTMLDivElement>(null)`(行 315)
- [ ] 删 `function scrollStorageKey(sessionId)`(行 109-111)
- [ ] 删 `handleSwitchSession` 中"保存当前会话滚动位置"那一段 try 块(行 620-631)
- [ ] 删 `handleSwitchSession` 中"恢复新会话滚动位置"那一段 `queueMicrotask` + try 块(行 640-655)
- [ ] 删 JSDoc 第 92 行 `"- 主区滚动位置按 sessionStorage \`analysis-scroll-<sid>\` 持久化"`
- [ ] 删除 caller 处传给 `<CitationOverlay>` 的 `mainScrollRef={mainScrollRef}`(行 831)

### 6. 删 `CitationOverlay.mainScrollRef?` props

- [ ] `apps/web/src/components/citation-overlay.tsx` 删 `CitationOverlayProps.mainScrollRef?` 字段(行 68-72)
- [ ] 删除对应 useEffect 里 `mainScrollRef?.current?.addEventListener('scroll', ...)` 一段(用 RefObject 推不出 mainScrollRef 后自然变 unreachable)
- [ ] 删除 JSDoc 第 68-72 段(`可选;不传 → 仅监听 ...`)

### 7. 测试(className 契约断言)

- [ ] `apps/web/src/__tests__/analyzing-zone.test.tsx` 新增 `describe('AnalyzingZone · 主区锁高度契约(ADR-0019 D1/D2)')`,含 4 条断言:
  - `analyzingMain.className` 含 `overflow-hidden`,**不含** `overflow-auto`
  - `analyzingGrid.className` 含 `overflow-hidden`
  - `analyzingLeftCol.className` 含 `overflow-hidden`
  - `analyzingRightCol.className` 含 `overflow-hidden`
- [ ] `apps/web/src/__tests__/analyzing-zone-narrow.test.tsx` 新增 `describe('NarrowLayout · 主区锁高度契约(ADR-0019 D3)')`,含 2 条断言:
  - `analyzing-narrow` 含 `overflow-hidden`
  - `analyzing-narrow-body` 含 `overflow-hidden`

### 8. ADR + CONTEXT 同步

- [ ] 新建 `docs/adr/0019-analyzing-grid-locked-height-independent-scroll.md`(`Status: Accepted`,Date 2026-07-22)
- [ ] ADR-0019 "关联 ADR" 段列出 ADR-0017 / ADR-0018
- [ ] ADR-0019 "覆盖/补充"段明确:**D1 锁外层 / D2 列级 overflow / D3 窄视口同契约 / D4 删死代码(D5 删 props 接口)**,并且"不覆盖 ADR-0017 D1~D6 / ADR-0018 D1~D4 任何决策"
- [ ] 视觉契约(锁高度 + 两栏独立滚动)验收记录:**手工浏览器视觉验证完成,记在 ADR-0019 "Decision" 段尾**

## 备注 / 提示

- **jsdom 测真滚动不可靠**:`vitest.setup.ts` 不接真实 layout,`Element.scrollHeight`/`clientHeight` 在 jsdom 恒返回 0。本 ticket 不引入真滚动测试,只锁 className 契约;真滚动验证留手工或 e2e(ticket 09 / 后续基建)
- **ADR 风格**:与 ADR-0018 同族,沿用"`Status` + `关联决策` + `关联 ADR` + `Context` + `Decision`"五段
- **不要**顺手改 InterjectInput 位置 / 配色;本 ticket 是"锁契约 + 删死代码",不动排版
- **不要**新增 `data-testid`;既存 testid 已够覆盖 grid / 左列 / 右列 / analyzing-main / analyzing-narrow / analyzing-narrow-body
- 顺序:**先 ADR-0019 + 本 ticket → 跑测试基线 → 改代码 → 跑测试看契约断言 PASS**
