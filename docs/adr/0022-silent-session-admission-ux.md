# ADR-0022: Silent Session Admission UX —— 让"按 Pack 跑"成为 UI 默认形态

**Status:** Proposed
**Date:** 2026-07-31
**Deciders:** 项目负责人(经 11 轮 grilling 沉淀)
**关联决策:** [CONTEXT.md](../CONTEXT.md) 决策 65, 67, 88-102

**关联 ADR:**
- [ADR-0013](0013-analyzing-zone-rewrite.md) D7(多会话 Tab) · D8(tech-brief 双文件) · D11(待裁决 / 接受风险) · D15(已裁决视觉状态) —— **本 ADR 覆盖 D8 / D11 整条线,改动 D7 / D15 落地形态**
- [ADR-0020](0020-analyzing-real-prd-analysis-onboarding.md) D14(generate-brief) —— **本 ADR 覆盖整条线**
- [ADR-0021](0021-admission-pack-framework.md) D4(workspace + req + session 三层装载作用域) · D10(POST body 必填 pack_id) —— **本 ADR 补充 D4 session 落地形态;沿用 D10**,pack_id 来源由 AdmissionDashboard dropdown 提供

**覆盖 / 补充:**
- **覆盖(搁置)**:`generate-brief` 端点([ADR-0020 D14](/Users/Ray/TraeProjects/AI-DevSpace/apps/agent/src/routes/analysis.ts#L477-L535))—— 整条线不再实现;tech-brief 不在 ANALYZING 区生成
- **覆盖(搁置)**:「待裁决 / 接受风险」交互([ADR-0013 D11](0013-analyzing-zone-rewrite.md))—— verdict 仅信息展示,不进入 override 交互
- **覆盖(改造)**:「重扫」按钮([ADR-0013 D11](0013-analyzing-zone-rewrite.md))—— 改成"再按一次开始分析 = 创建新 session"
- **覆盖(删除)**:AdmissionDashboard「+ 新建」按钮 + 「新建分析会话」弹窗(会话名 / 分析角度 4 选 1)
- **补充**:`apps/web/src/components/analyzing-zone.tsx` 挂载 AdmissionDashboard 时,新增顶部 dropdown + SessionTabs 不挂载
- **补充**:`apps/web/src/app/(workspace)/requirements/[id]/history/page.tsx` 新增"分析会话历史"分区(改造 mock 接入)
- **补充**:`apps/web/src/app/(workspace)/requirements/[id]/analyzing/page.tsx` 支持 `?session=<sid>` query 参数(SSR override 默认推断)
- **不覆盖**:ADR-0021 装载模型本体(D1-D3 / D5-D9 / D11-D15 全部沿用)

---

## Context

### 起点

ADR-0013 D7 把 ANALYZING 工位的多会话形态固化为"顶部 Tab 切换 + 准入仪表板全局共享";D11 给了"裁决 + 重扫"两条用户动作。ADR-0020 把 start handler 真接 SDK + 单 session 双 turn。ADR-0021 给出"装载作用域 = workspace + req + session"三层,以及 `POST /analysis/start` body 必填 `pack_id` 的契约。

**当前入口**:`AdmissionDashboard` 顶栏右端常驻「▶ 开始分析」+ 图 1 中 AdmissionDashboard 下方右端的 [+ 新建]「生成技术概要」「重扫」三个按钮 + 顶部的 SessionTabs 多会话切换。

**用户原话(2026-07-31 触发)**:
> 继续 analyzing 工位的其他功能改造:不再需要[新建分析会话]模块,每次分析只需要按用户选择的 Pack 包进行对 prd 需求的分析。

### 痛点

1. **「+ 新建」按钮 + 弹窗 = 让用户当数据录入员**。填"会话名"和"分析角度"4 选 1,实际后端 `angle` 写死 `architecture`,`label` 自动派生,`session_id` 自动生成。用户填啥都不影响结果。
2. **SessionTabs 多会话 UI 与 ADR-0021 的"沉默装载"诉求冲突**。Pack 切换器已经承担"按 Pack 选 session",再叠 Tab 是双层入口。
3. **「重扫」按钮的存在暗示"会话是产物"**。但沉默装载下,session 是"按一次 = 1 份历史",再按一次 = 新一份,按钮多余。
4. **「生成技术概要」和「⚠ 待裁决」在 ANALYZING 区是异类**。前者属设计阶段(ADR-0013 D8 本身就有这个暗示),后者属"AI 主动推送"的弱化形式(决策 25 哲学已经反对)。两者都违背 "AI 不推动流程" 的核心信条。
5. **沉默多 session 历史怎么回看**?完全靠文件系统不可接受,SessionTabs 已删,需要新出口。

### 真实场景(决定性输入)

金融工程师 A 打开 PRD-001 /analyzing,他看到一个顶部 dropdown(列出他 enabled 的 3 个 pack) + 5 维卡片 + 一个「▶ 开始分析」。他选 finance-baseline-v1 → 按按钮 → 后端建 `sess-fb1-<ts>/chunks.jsonl` → 双 turn 跑 → 产物落盘。一周后他想回看历史,他进 /history → 看到"分析会话历史"分区列出 4 次跑 → 点「查看」 → 跳 `/analyzing?session=sess-fb1-7f3a` → 看到原文 + 产物。

整个过程:**没有"会话名"概念、没有"分析角度"4 选 1、没有"待裁决"按钮、没有"重扫"按钮**。用户只需"想看 PRD-001 + 选 Pack + 按按钮"。

---

## Decision

通过 11 轮 grilling 会话,沉淀 D1-D9。**整体框架 = "沉默多 session + Pack dropdown 即选择器 + /history 即历史出口"**。

### D1 · 范围 = 删 [+] 弹窗 + 删 d 入参;保留「▶ 开始分析」

- ❌ 删 `AdmissionDashboard` 下方右端 [+ 新建] 按钮([admission-dashboard.tsx:140-142](/Users/Ray/TraeProjects/AI-DevSpace/apps/web/src/components/admission-dashboard.tsx#L140-L142)旁的 sibling)
- ❌ 删「新建分析会话」弹窗(会话名 input + 分析角度 4 选 1)
- ❌ 删 `d` 入参(`angle` / `label` / `session_id` 三字段)
- ✅ 保留 AdmissionDashboard 顶栏右端「▶ 开始分析」(常驻 CTA,ticket 08 后)
- ✅ 保留 5 维卡片 + verdict 徽章

### D2 · 产物组织 = 沉默多 session

- 后端:**保留** `_index.yaml` 多会话索引([routes/analysis.ts:355-356](/Users/Ray/TraeProjects/AI-DevSpace/apps/agent/src/routes/analysis.ts#L355-L356)) + `sessions/<sid>/chunks.jsonl` 目录结构
- 前端:**不挂载** `<SessionTabs>`([components/session-tabs.tsx](/Users/Ray/TraeProjects/AI-DevSpace/apps/web/src/components/session-tabs.tsx));组件代码可保留(v1.1 重启时再用)

### D3 · session × pack 对应 = 按一次 = 1 session

- 每次按「▶ 开始分析」= 后端**新建** 1 个 silent session
- `session_id` 格式:`sess-<packId>-<Date.now().toString(36)>`(后端自动生成;与 ADR-0020 `sess-<angle>-<ts>` 一致模式,改 packId 维度)
- 同一 PRD + 同一 pack 可有多份 session 文件并存(`_index.yaml` 持续 append)
- 「重扫」= 再按一次「▶ 开始分析」= 创建新 session,**无需独立按钮**

### D4 · Pack 选择器 = AdmissionDashboard 顶栏 dropdown

- 形态:5 维卡片上方一行 "📦 Pack: <dropdown> · <units> · algorithm: <name>"
- 来源:`POST /api/requirements/:id/analysis/enabled-packs` 返 enabled_packs 列表 + 算法元数据
- HTML 原型:[22-history-sessions-prototypes.html](/Users/Ray/TraeProjects/AI-DevSpace/docs/design/pages/22-history-sessions-prototypes.html)的 Variant A 风格(沿用 [11h-zone-multisession-form-compare.html](/Users/Ray/TraeProjects/AI-DevSpace/docs/design/pages/11h-zone-multisession-form-compare.html)的 AdmissionDashboard 视觉)

### D5 · dropdown 默认值 = PRD 上次用的 pack

- 持久化层:`localStorage`,key = `aidevspace:<reqId>:lastPack`
- fallback 顺序:
  1. localStorage 该 reqId 记录
  2. `enabled_packs` 列表的第一个
  3. 强制 `baseline-5dim`(built-in 默认)
- 切换 pack 不立即生效;按「▶ 开始分析」才生效

### D6 · 默认展示哪个 session = dropdown 当前 pack 的最新 session

- SSR 阶段:`loadSessionChunks` 增强,接收 `packId: string` 参数 → 读 `_index.yaml` → 过滤该 pack_id → 取 createdAt 最新
- fallback 顺序:
  1. dropdown pack 的最新 session
  2. `enabled_packs` 第一个 pack 的最新 session
  3. 空态(无任何 session;展示"按一下「▶ 开始分析」开始你的第一次分析")
- Query override(见 D8):`?session=<sid>` > D6 fallback 链

### D7 · AdmissionDashboard 按钮 = 只剩「▶ 开始分析」

| 按钮 | 状态 | 处置 |
|---|---|---|
| 「▶ 开始分析」 | ✅ 保留 | 唯一 CTA;按下去 = 创建新 session |
| [+ 新建] | ❌ 删 | D1 已含 |
| 「生成技术概要」 | ❌ 删 + 搁置 | ADR-0013 D8 / ADR-0020 D14 整条线**不再实现**;`generate-brief` 端点**保留代码 stub**(返 410 Gone + `feature_disabled` 错误码),不暴露 UI |
| 「重扫」 | ❌ 删 | 再按一次「▶ 开始分析」= 创建新 session(D3) |
| 「⚠ 待裁决」 | ❌ 删 + 搁置 | ADR-0013 D11 / D15 整条线**不再实现**;verdict 仅信息展示,不进入 override 交互 |

**ADR-0013 D11 / ADR-0020 D14 搁置不删除文档**——历史决策留痕;`modules.yaml` / `technical-brief.md` / `adjudication.md` 文件落点**不再被任何代码主动写**(代码 path 留着,v1.1 复用时不重写)

### D8 · 历史 session 回看 = /history 分区 + 跳 /analyzing?session=<sid>

- `/history` 页面(目前是 mock)新增"分析会话历史"分区:
  - 数据源:SSR 直读 `_index.yaml`(`requirements/<id>/analysis/sessions/_index.yaml`)
  - 列表项:`{ pack_id, createdAt, session_id(短), verdict, chunks count }`
  - 排序:createdAt desc
  - 视觉:已选 pack 的最新 session 标 `active` 高亮
  - 「查看」按钮:`<Link href="/requirements/<id>/analyzing?session=<sid>">`
- `/analyzing` 路由改造:支持 `?session=<sid>` query 参数
  - SSR 时:有 query → 读指定 sid 的 chunks.jsonl;无 query → D6 fallback 链
  - Active session 标识:页头小字"正在查看: <pack_name> · <createdAt 相对>"
- HTML 原型:[22-history-sessions-prototypes.html](/Users/Ray/TraeProjects/AI-DevSpace/docs/design/pages/22-history-sessions-prototypes.html)的 Variant A

### D9 · 「▶ 开始分析」按下去行为 = dropdown 当前值

- POST body:`{ pack_id: dropdown.value }`([analysis.ts:285-418](/Users/Ray/TraeProjects/AI-DevSpace/apps/agent/src/routes/analysis.ts#L285-L418)已支持 pack_id 必填,沿用 ADR-0021 D10)
- 同步:前端把 `localStorage[<reqId>:lastPack]` 设为 dropdown.value(D5 的持久化更新)
- 后端校验:ADR-0021 D10 严格生效,不在 `enabled_packs` → 400 + `pack_not_enabled` 错误体
- 不做二次确认弹窗(防误点);AdmissionDashboard 已经把 pack name 展示得很清楚

---

## 数据契约

### Frontend types(`apps/web/src/lib/analyzing.ts`)

```typescript
// D4 dropdown 数据源
export interface EnabledPacksResponse {
  packs: Array<{
    pack_id: string
    displayName: string
    unitsCount: number
    algorithmName: string
  }>
}

// D6 SSR 输入
export interface LoadSessionChunksParams {
  reqId: string
  // 优先序:explicitSessionId > activePackId > enabledPacks[0] > 'baseline-5dim'
  explicitSessionId?: string     // ?session=<sid>
  activePackId?: string          // dropdown 当前值
  enabledPacks: string[]         // 服务端列表(D6 fallback 链)
}
```

### Backend types(`packages/shared/src/admission.ts`,沿用 ADR-0021)

`PackVerdict` / `UnitJudgment` / `Verdict` 等类型**不变**。ADR-0021 已定义。

### Route changes

| 路径 | 变更 |
|---|---|
| `POST /api/requirements/:id/analysis/start` | body schema:`{ pack_id: string }`(去掉 `angle` / `label` / `session_id`) |
| `GET /api/requirements/:id/analysis/enabled-packs` | **新增**:返 D4 dropdown 数据源 |
| `GET /requirements/:id/analyzing?session=<sid>` | **新增 query**:SSR override D6 fallback 链 |
| `POST /api/requirements/:id/analysis/generate-brief` | 返 `410 Gone` + `{ error: 'feature_disabled', message: 'tech-brief 已在 ADR-0022 中搁置;请使用 ADR-0021 Pack 装载模型' }` |

### File-system contracts(不变)

```
~/.aidevspace/requirements/<req-id>/analysis/
├── sessions/
│   ├── _index.yaml              ← 多 session 索引,append-only
│   └── sess-<packId>-<ts>/
│       └── chunks.jsonl         ← 双 turn 产出
└── (technical-brief.md / modules.yaml / adjudication.md 不再被写入,但目录允许存在)
```

---

## 与现有契约的兼容

### 与 ADR-0013 D7(多会话 Tab)的兼容

- `<SessionTabs>` 组件**代码保留**,**不挂载**(v1.1 重启时再用)
- 后端 `sessions/<sid>/` 目录结构**完全不变**
- `_index.yaml` append-only **完全不变**
- 唯一变更:`analyzing-zone.tsx` 不再 import / render `<SessionTabs>`

### 与 ADR-0013 D8 / D15(tech-brief / 已裁决视觉)的兼容

- tech-brief 整条线**搁置**(`generate-brief` 端点返 410)
- 「⚠ 待裁决」按钮 + 「已裁决折叠区」**不挂载**;`adjudication.md` 不再被代码主动写
- ADR-0013 D8 / D11 / D15 决策**保留在 CONTEXT.md**(决策 65 / 71 / 72 留痕)

### 与 ADR-0020 D14(generate-brief)的兼容

- 端点代码 stub 保留,返 410
- 双 turn 编排(SSE / chunk parser / verdict_finalized)**完全不变**

### 与 ADR-0021 D4 / D10 的兼容

- D4(workspace + req + session 三层):session 概念从"UI 暴露的多会话"压缩为"silent 多 session";workspace + req 层不变;req 级 override 仍 v1.1 留位
- D10(`POST /analysis/start` body 必填 `pack_id`):**完全沿用**;pack_id 来源由 AdmissionDashboard dropdown 提供(D4 + D9)
- D11-D15 全部沿用;AdmissionPackLoader / algorithmInterpreter 等基础设施**不变**

### 与 admission-check Skill / AdmissionDashboard 现有契约

- AdmissionDashboard 5 维卡片 + verdict 徽章**完全不变**
- AdmissionPackLoader 装载的 admission unit 数据**不变**
- 唯一新增:AdmissionDashboard 顶部加 dropdown(D4)

---

## Considered Options(关键节点)

| 节点 | 候选 | 选择 | 否决理由 |
|---|---|---|---|
| 范围 | A 删 d 但保留弹窗 / B 删 d + 删弹窗 / C 删 d + 删弹窗 + 删 SessionTabs / D 删全部 UI(连 AdmissionDashboard) | **B**(删 d + 删弹窗) | A 留弹窗无意义(angle 写死,label 派生,session_id 自动);C 多删 SessionTabs 但本期不展开 UI 改;D 太激进 |
| 产物组织 | A 每次跑覆盖 / B 每次跑追加 / C 每 pack 各一份 / D 沉默多 session | **D** | A/B 丢历史;C 与 Pack 模型冲突但用户暂无强需求;D 与"按一次=1 session"自然对齐 |
| session × pack | A 按一次=1 / B PRD×Pack=1 / C PRD=1 / D 自适应 | **A** | B 隐式强制 pack 不可重复跑;C 太激进;D 状态归属不清晰 |
| 选择器位置 | A /analyzing 顶部 / B 全局 /settings / C PRD /settings / D 入口侧栏 | **A** | B 不灵活;C 需多页;D 与 AdmissionDashboard 重复 |
| 选择器形态 | A 顶部 dropdown / B 底部 chips / C 左侧列表 / D 维度卡压 chip | **A** | B 占底部;C 拉高 AD;D 与原图差异最大 |
| dropdown 默认 | A enabled_packs[0] / B default 标记 / C PRD 上次 / D 服务端推导 | **C** | A 无个性化;B schema 增字段;C 与"沉默多 session"协同;D 需后端多写(req 级 override 留 v1.1) |
| 默认 session | A 最新 / B 匹配 pack 最新 / C active 指针 / D 合并视图 | **B** | A 不响应 pack 切换;C 需多 UI;D 需重写读取逻辑 |
| 生成概要 触发 | A CLARIFYING 进 / B DESIGNING 进 / C 完全删 / D 手动命令 | **C** | A/B 错位(分析 ≠ 设计);D 留 stub 即可 |
| 历史回看 | A /history + 跳详情 / B /history 仅摘要 / C AD chip + 弹层 / D 完全沉默 | **A** | B 丢画线联动;C 形态 A 高度增加;D 用户不可查 |
| 待裁决 按钮 | A 保留 / B 完全删 / C 移产物区 / D 自动重跑 | **B** | A 与决策 25 哲学冲突;C 仍占 UI;D 太激进 |
| 开始分析 行为 | A dropdown 当前 / B + 二次确认 / C + 自动 reset localStorage / D + name | **A** | B 防呆但 UI 已清晰;C 是 D5 的延伸但本期不强求;D 增 schema |

---

## Consequences

### 正面

- **真正落地"按 Pack 跑"作为默认形态**——用户不再当数据录入员;打开 /analyzing = 看到 Pack + 5 维 + 一个 CTA
- **历史可回看但不打扰**——/history 是用户**主动查**的入口,不是 AdmissionDashboard 的常驻 UI
- **AdmissionDashboard 极简**——只剩"顶部 dropdown + 5 维 + 一个按钮",符合 Linear 紧凑风格(决策 28)
- **彻底贯彻决策 24 哲学**——"AI 不推动流程";tech-brief / 待裁决 / 重扫全部不出现,符合"不打扰,克制在场"
- **沉默多 session 与 ADR-0021 装载模型天然兼容**——session 是装载作用域最细粒度(ADR-0021 D4),silent 多份 history 是该模型的"自然扩展"
- **decision 25 进一步强化**——AI 主动推送零例化(tech-brief / 待裁决 / 重扫全部消失)

### 负面 / 代价

- **多会话 UI 关闭**——v1.1 之前,用户无法在 /analyzing 内直观看到/切换多份 session(只能去 /history)
- **「重扫」语义被悄悄改变**——原本是"按相同参数重跑",现在是"按当前 dropdown pack 重跑 + 创建新 session"。如果用户**期望**"按上次 pack 重跑",需 dropdown 显式切换回去(UI 没强调这点,可能踩坑)
- **tech-brief / 待裁决搁置是单向门**——一旦用户重新需要,需 v1.1 ADR 重新启
- **dropdown 默认值的 localStorage 持久化**——浏览器换设备 / 清缓存会丢;用户切回"原始"pack 需手动操作(低频)
- **`?session=<sid>` query 参数**——意味着 /analyzing 路由不再是纯 SSR,有动态 query;需要在 RSC / client component 边界处理

### 风险缓解

| 风险 | 缓解 |
|---|---|
| 用户想重扫但忘了切回原 pack | /history 列表项 hover tooltip "由 <pack> 创建" 提示;用户点「查看」即跳回当时的 pack context |
| 多 session 文件系统增长无界 | 沿用 ADR-0009 D47 的 30 天 snapshot 清理机制 + 用户手动 `aidevspace analysis cleanup` CLI(本期不实现,留 v1.1) |
| dropdown 切换不生效(用户以为立即生效) | AdmissionDashboard 顶部小字 "切换不会立即生效,按「▶ 开始分析」才用此 Pack" 一次性 hint(dismiss 后不再显示) |
| localStorage 跨设备不同步 | workspace 级 `~/.aidevspace/config.yaml` 可选存储 lastPack per-reqId(v1.1 + ADR-0021 D4 req 级 override 一起做);本期仅 localStorage |
| tech-brief 搁置后用户找不到入口 | 错误码 `feature_disabled` 在 `generate-brief` 端点返 410,带 message 指向 ADR-0022;StatusBar 不弹 |
| `/analyzing?session=<sid>` 与 `/analyzing`(无 query)SSR 行为不一致 | RSC 入口函数 `loadSessionChunks` 统一处理两路径;query 优先级明确;`?session=<sid>` 校验 sid 存在性,无效 → fallback 到 D6 链 |
| 「待裁决」消失后,verdict=fail 没法 override | 用户可:**手动禁用该 Pack** + 切到另一个 Pack 重跑(系统层面强制重决策)+ 或接受 verdict=fail 但继续推进后续工位 |

---

## 实施路径(Batch 1-3)

**Batch 1 · AdmissionDashboard 顶部 dropdown + 沉默化(最小可运行)**

1. `apps/web/src/components/admission-dashboard.tsx` 顶部加 dropdown(D4);接 `GET /enabled-packs` 数据源
2. `apps/agent/src/routes/analysis.ts` 新增 `GET /api/requirements/:id/analysis/enabled-packs`
3. `apps/web/src/components/analyzing-zone.tsx` **不挂载** `<SessionTabs>`(D2)
4. 删除 [+ 新建] 按钮 + 「新建分析会话」弹窗(D1)
5. 删 `angle` / `label` / `session_id` 入参(D1);POST body schema 收紧为 `{pack_id}`
6. 删除「⚠ 待裁决」「重扫」「生成技术概要」三个按钮(D7)
7. `apps/agent/src/routes/analysis.ts` `POST /generate-brief` 改为返 `410 Gone`(D7 搁置)
8. `apps/web/src/lib/analysis-start.ts` 入参 schema 收紧(D1)

**Batch 2 · 历史回看 + 路由改造**

9. `apps/web/src/app/(workspace)/requirements/[id]/history/page.tsx` 改造 mock 接入 → 读 `_index.yaml` + 新增"分析会话历史"分区(D8)
10. `apps/web/src/lib/analyzing.server.ts` `loadSessionChunks` 增强,接收 `{ explicitSessionId, activePackId, enabledPacks }` 参数(D6 / D8)
11. `apps/web/src/app/(workspace)/requirements/[id]/analyzing/page.tsx` 读 search params `session` → 传给 `loadSessionChunks`(D8)

**Batch 3 · 持久化 + 打磨**

12. `apps/web/src/components/admission-dashboard.tsx` dropdown 切换时,`localStorage[<reqId>:lastPack]` 写入(D5);首次进入读 localStorage fallback(D5)
13. AdmissionDashboard 顶部一次性 hint "切换不会立即生效..."(D5 风险缓解)
14. 配套:删除 `apps/agent/src/routes/analysis.ts` 中 `buildMockBriefArtifacts` + `simulateInterjectChunks` 等孤儿 mock(无 UI 消费,清理)

---

## Status 流转

- [x] Proposed:2026-07-31,11 轮 grilling 沉淀
- [ ] Accepted:实施完成后由项目负责人确认
- [ ] Deprecated:由 ADR-NNNN 取代时填写

---

## 变更日志

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-07-31 | 初稿:基于 11 轮 grilling 会话,沉淀 D1-D9,定义 ANALYZING 工位在沉默多 session + Admission Pack 装载模型下的 UI 完整形态 | Grilling 会话 |