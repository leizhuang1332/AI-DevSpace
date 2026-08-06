---
status: accepted
---

# zones 注册表整体退役 + 4 section hardcode(ADR-0026)

[ADR-0011](0011-requirement-workbench-zone-adaptive.md) 与 [ADR-0012](0012-requirement-workbench-shell-topology.md) 引入的 zones 注册表(`ZONE_META` 数组 + `~/.aidevspace/zones/*.yaml` + `apps/agent/src/services/ZoneRegistry.ts`)是 v1.0.1 的关键决策:6 工位 + 1 Overview = 7 形态、声明式 YAML 配置、frontmatter 元信息。

随着 [ADR-0024](0024-taskcard-card-model.md) + [ADR-0027](0027-board-section-intro.md) 把 3 个工位退役、新增 `board` section,声明式注册表带来的好处(用户/agent 可动态注册、可热加载)显著小于成本(字段集 13 项、YAML 解析路径、注册表与代码不一致的风险)。本 ADR 决定 **整个 zones 注册表退役**,改为硬编码 section 枚举。

## 背景与现象

### 现状(烤之前)

- **Web 端**(`apps/web/src/lib/zones.ts`)持有 `ZONE_META`(6 工位 × 13 字段 = 78 字段)+ `ZONE_LIFECYCLE_ORDER`(固定排序)+ 路由解析 `REQUIREMENTS_ZONE_PATH_RE`
- **Agent 端**(`apps/agent/src/services/ZoneRegistry.ts`)在启动时从 `~/.aidevspace/zones/*.yaml` 加载 + 用 `ZoneConfig` Schema(Zod)校验,主要用作工位默认装备 default_arming 注入
- **共享**`packages/shared/src/zones.ts` 持有 `ZoneSchema` 与 `ZoneStatusColorSchema`,供两端共用
- 工位 6 个 + 1 Overview 共 7 个产品形态,见 CONTEXT.md 第 5 节

### 痛点

1. **数据形状分裂**:zones 元数据散落在 web 端(JS 数组)+ agent 端(yaml 文件 + ZoneConfig schema)。CLAUDE.md 一开始就指认这条:"agent yaml 是单一事实源,web 端复刻一份是为了避免在浏览器侧引入 yaml 解析"。但**仍然双写漂移风险**:任何字段在 yaml 改了,web 数组还得跟着改。
2. **注册表机制的价值无法兑现**:CLAUDE.md 提到 "v1.0 不开放 user 自定义",即注册表**目前不允许用户在运行时改**。也就是说,YAML 注册的"声明式 + 热加载"是 **不会发生的未来扩展**。
3. **board section 与现有 6 工位的语义不同**:board 是"看 + 推进",工位是"按工具集中度分工"(drafting 写 / analyzing 分析 / executing 执行)。它们形状不统一,硬塞进同一份 13 字段 schema 会让 `has_resource_tree / default_arming / status_pulse` 等字段出现"不适用"的废值。
4. **烤时用户决策**:用户 12 轮多次说「**全面放弃现有的 clarifying、designing、executing 工位设计,转而用任务看板页面替代**」。虽然没有点 drafting/analyzing/wrapup,但「放弃 3 个」已经导致 6 → 3,工位集合从大块变薄,ZONES 注册表的元信息密度不够覆盖 board 这种 shape。

## 决策

### D1. zones 注册表整套退役

**退役范围**:

- `apps/web/src/lib/zones.ts` 的 `ZONE_META` 数组 + `ZONE_LIFECYCLE_ORDER` + `REQUIREMENTS_ZONE_PATH_RE` — **整文件重写**(只保留路由解析函数)
- `apps/agent/src/services/ZoneRegistry.ts` — **整文件删除**
- `packages/shared/src/zones.ts` 的 `ZoneSchema` / `ZoneStatusColorSchema` / `ZoneConfig` — **整体删除**
- `~/.aidevspace/zones/*.yaml`(`~/.aidevspace/zones/drafting.yaml` 等 6 份) — **删除**(若 agent 启动时找不到,ZoneRegistry 抛异常的代码同步删除)
- 决策 56 「工位集合声明式注册表 = `~/.aidevspace/zones/*.yaml`,13 字段」 — **CONTEXT.md 标注 DEPRECATED**

**保留范围**:

- "工位(Zone)" 这一**UI 概念词**:用户仍在用「analyzing 工位」「drafting 工位」的口径;术语保留。改称 "section" 仅在代码层面注释出现,UI 名称不动
- `apps/web/src/lib/zones.ts` 的**路由解析函数**(如 `parseRequirementZonePath`):保留并简化为只识别 4 个合法 segment
- 部分元信息(segment → 状态色映射、segment → icon 映射):改为各 page 组件自带的 hard-coded 常量

### D2. 4 section hardcode 为 TypeScript 枚举

```typescript
// apps/web/src/lib/sections.ts (新增,原 zones.ts 替代)
export const REQUIREMENT_SECTIONS = ['drafting', 'board', 'analyzing', 'wrapup'] as const
export type RequirementSection = typeof REQUIREMENT_SECTIONS[number]

export const SECTION_META: Record<RequirementSection, {
  label: string         // UI 显示
  icon: string          // UI icon
  statusColor: 'gray' | 'purple-warn' | 'blue' | 'green'  // 卡片/徽章颜色
  hasResourceTree: boolean   // 是否渲染资源树
  hasInlineRail: boolean     // 是否保留 Inline 栏(决策 53)
  description: string        // Cmd+K 描述
  defaultArming: SkillId[]   // 默认 armed skill
}> = {
  drafting:  { label: 'DRAFTING',  icon: '📝', statusColor: 'gray',         hasResourceTree: true,  hasInlineRail: true,  description: '...', defaultArming: [...] },
  board:     { label: 'BOARD',     icon: '📋', statusColor: 'blue',         hasResourceTree: false, hasInlineRail: false, description: '...', defaultArming: [...] },
  analyzing: { label: 'ANALYZING', icon: '🔍', statusColor: 'purple-warn',  hasResourceTree: false, hasInlineRail: false, description: '...', defaultArming: [...] },
  wrapup:    { label: 'WRAP-UP',   icon: '🏁', statusColor: 'green',        hasResourceTree: true,  hasInlineRail: false, description: '...', defaultArming: [...] },
}
```

字段数对齐原 `ZONE_META` 的 13 字段中**实际使用的 7 项**:`label` / `icon` / `statusColor` / `hasResourceTree` / `hasInlineRail` / `description` / `defaultArming`。其余 6 项(`status_pulse` / `main_layout` / `has_ai_thinking_bar` 等)**整组退役**,因为代码已不再用。

### D3. 路由 contract: 4 segment

**Next.js 路由层**(`apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx`):

- 当前 `generateStaticParams` 用 `ZONE_LIFECYCLE_ORDER.map(...)` 生成 6 个合法路径
- 改为 `REQUIREMENT_SECTIONS.map(...)` 生成 4 个合法路径:`/requirements/[id]/drafting/`、`/requirements/[id]/board/`、`/requirements/[id]/analyzing/`、`/requirements/[id]/wrapup/`
- `parseRequirementZonePath` 从 `route_segment` 字符串映射到 page component 的 switch-case 改为 4-case
- 路由正则 `REQUIREMENTS_ZONE_PATH_RE` 由 6 个 segment 改成 4 个
- URL naming:沿用 `[id]/[zone]/` 段名(`[zone]` 是 Next.js 动态路由段名,**不重命名**;虽然语义上改为 section,但段变量名仍叫 zone,避免改大量代码)

### D4. 退役「工位切换 UI」语义

- `apps/web/src/components/zone-bar.tsx` 的 7 Tab 改为 4 Tab + 1 Overview(Overview 不属 section,继续走当前实现)
- `apps/web/src/components/command-palette.tsx` 工位搜索的关键词集从 6 改为 4
- `STATUS_PROGRESS_MAP`(父级 status → progress 0-100)保留(无关 zones 注册表)
- `RequirementStatus` enum 保留(10 态,与本 ADR 无关)

### D5. ADR-0011 / ADR-0012 的部分决策作废

| 原 ADR 决策 | 状态 |
|---|---|
| ADR-0011 D1 7 形态 = 1 Overview + 6 工位 | **改**:7 形态 = 1 Overview + 4 section |
| ADR-0011 D3 资源树按工位决定 | **改**:资源树按 section 决定(`SECTION_META.hasResourceTree`) |
| ADR-0011 D4 Inline 栏按工位决定 | **改**:同上 |
| ADR-0012 D5 `default_arming` 由 zones yaml 加载 | **改**:由 `SECTION_META.defaultArming` 硬编码 |
| ADR-0012 D5 工位集合声明式注册表(13 字段) | **作废** |

ZONES.yaml 文件本身 **不再出现在 agent 启动逻辑中**。这一步是 D1 的衍生。

### D6. 实施期硬约束(ADR-0023 守门延伸)

D6.1:删除 `~/.aidevspace/zones/*.yaml` 必须在 agent 启动逻辑中**先确认 yaml 不存在不报错**(否则老用户升级后启动崩)

D6.2:Web 端的 `ZONE_META` 数组删除后,**所有引用方**:`zone-bar.tsx` / `command-palette.tsx` / `requirements/[id]/[zone]/page.tsx` 等需同步迁移到 `SECTION_META`

D6.3:`packages/shared/src/zones.ts` 的删除 **必须先确认 web/agent 没有 import 副作用**:用 ripgrep 扫 `from '@ai-devspace/shared/zones'` 等 import pattern,全部清零后才能删除

## 不在范围内

- **board section 自身的 UI 形态** → [ADR-0027](0027-board-section-intro.md)
- **board 详情页结构 + transcript** → [ADR-0028](0028-taskcard-transcript-independence.md)
- **撤回 3 工位的具体页面/产物迁移** → 留给 implementation 阶段
- **注册表机制的"未来再开放"** 用户自定义能力 → 不在本 ADR,本 ADR 永久退役 YAML
- **`RequirementStatus` enum / `STATUS_PROGRESS_MAP`** 等不依赖 zones 注册表的状态字段 → 保留不动

## 主要取舍

- **选择「zones 注册表整体退役」而不是「保留 yaml + 减字段」**:后者会让 YAML 仍存在,但只服务 4 个 section + 7 字段,YAML 解析的代价(IO + 校验 + Zod)价值降到极低。整体退役更干净。
- **选择「SECTION_META 在 web 端」而不是「双端共享 packages/shared/src/sections.ts」**:agent 端不消费 SECTION_META(agent 只读 yaml 老路径);共享包 section 类型 + 元数据过于抽象。Web 端 hard-code 即可。
- **选择「Next.js 段名仍叫 [zone]」而不是「改名为 [section]」**:重命名影响所有现有 page.tsx / layout.tsx 的命名;语义不变(dev reader 知道这是历史术语) → 成本巨大价值小
- **选择「彻底退役 YAML」而不是「退役 yaml 但保留 ZONE_META JS 数组」**:JS 数组仍属于「声明式但不可热加载」的半成品;既然 4 个 section 都要硬编码,JS 数组也升级为 SECTION_META(命名更准)

## 关联

- **上游**(决定退役的根因):
  - [ADR-0024](0024-taskcard-card-model.md) TaskCard 引入,board section 替代 3 工位
  - [ADR-0027](0027-board-section-intro.md) board section 进入 section 集合
- **被替代**(原决策):
  - [ADR-0011](0011-requirement-workbench-zone-adaptive.md) D1 / D3 / D4 部分作废
  - [ADR-0012](0012-requirement-workbench-shell-topology.md) D5 工位注册表 13 字段作废
- **下游**:
  - [ADR-0027](0027-board-section-intro.md) 在 board section 路径上落在本 ADR 的 4-section hardcode 上
  - [ADR-0028](0028-taskcard-transcript-independence.md) 卡片详情 transcript 路径基于 SECTION_META 的 hasResourceTree / hasInlineRail 决策
- **实现位置**:
  - 新增:`apps/web/src/lib/sections.ts`(替代旧 zones.ts)
  - 删除:`apps/agent/src/services/ZoneRegistry.ts`
  - 删除:`packages/shared/src/zones.ts`
  - 删除:`~/.aidevspace/zones/*..yaml`(运行时不再生成;老用户升级时一次性清理)
  - 改动:`apps/web/src/components/zone-bar.tsx`、`command-palette.tsx`、`apps/web/src/app/(workspace)/requirements/[id]/[zone]/page.tsx`
