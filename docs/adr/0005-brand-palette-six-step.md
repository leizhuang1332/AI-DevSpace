# ADR-0005: 主色调色板采用 6 阶（不采用完整的 50–900 十阶）

**Status:** Accepted  
**Date:** 2026-07-09  
**Deciders:** 项目负责人

## Context

主色（Brand，Linear 紫 #5e6ad2）的阶梯数量，原本在 CONTEXT.md 决策 20 中约定为 **10 阶（50–900 完整阶梯）**，与 shadcn / Tailwind 的教科书范式一致。

但仓库内 15 页 HTML 原型仓（[`docs/design/pages/01..15-*.html`](docs/design/README.md)）实际采用的 CSS variables 是 **6 阶断续**：

```css
--brand:#5e6ad2;
--brand-50:#eef0fb;
--brand-100:#dde1f5;
--brand-500:#5e6ad2;
--brand-600:#525bc7;
--brand-700:#454eb0;
```

约束与权衡：

1. **产品哲学 = Linear 克制**（决策 17）。完整 50–900 提供 10 档灰度,但 Linear 密集信息密度场景里 200/300/400/800/900 这些中间阶梯多数位置不使用 —— token 成本↑、设计语言声音杂↑、却几乎无人读。
2. **HTML 已实装 6 阶**。改回 10 阶需重画所有 15 个 HTML 视觉稿（用户已直接确认采纳 6 阶）。
3. **决策 21–22 解决 4 档语义色的能力**：Success / Warning / Error / Info + 4 档需求状态色 (4+灰 + CLARIFYING 特殊)。Brand 不需要同时承担 10 档精细灰度。
4. **HTML 已是 6 阶的事实**，造成原本决策 20 文字与已落地视觉稿存在断层 —— 后续 agent 一旦按"10 阶"实现，就会与 HTML 视觉对照失配。

## Decision

**采用 6 阶断续方案**，更新 CONTEXT.md 决策 20 的字面表述：

| Token 名 | 用途 |
|---|---|
| `--brand` | 别名，与 500 同值 |
| `--brand-50` | 极淡背景、按钮 hover 浅态、Active Tab 背景 |
| `--brand-100` | 略深背景、图标容器底色 |
| `--brand-500` | **主色**，按钮、徽章主、品牌入口 |
| `--brand-600` | 按钮 hover、激活态 |
| `--brand-700` | 强调文字、Active 态前景色 |

**保留未来升级路径**：若产品进入扩张阶段（团队协作 SaaS / 营销页 / 多品牌）需要更细的灰度，再补全 200/300/400/800/900 5 档，作为额外的 `extended brand scale`。

## Consequences

### 正面

- 与 Linear 克制哲学一致；token 表 9 行而非 19 行。
- 与已实装的 15 页 HTML 原型 1:1 对齐，关闭"文字决策 vs 视觉稿"裂缝。
- 实施 agent 在写 `<globals.css>` 时直接一一对应 HTML 里既有变量名，不会出现"我有 50/100/500 没有 200" 的取舍。
- 后续扩展空间已被显式记录（升级路径），不算闭锁。

### 负面 / 代价

- 若未来某设计需要"brand-300"或"brand-800"的精细灰度，必须临时叠加 opacity 或回炉本 ADR。
- 与 shadcn / Tailwind 教科书范式不完全等同；外部 contributor 需读本 ADR 才知"为什么缺档"。

### 拒绝方案的理由

- **完整 10 阶（50–900）**：token 多 / 视觉杂 / 与 Linear 哲学冲突；改回需重画所有 HTML。
- **完整 11 阶（50–950）**：shadcn default 风格，但本项目 MVP 不上 SaaS，不需要这一档到顶。
- **唯 brand 单值**：失去 hover / focus / disabled 渐进灰阶，缺失交互所需层。

## Alternatives Considered

- 完整 10 阶（CONTEXT.md 决策 20 原文字）：见上文"拒绝方案的理由"。
- 仅 brand-500 / brand-600 两档：覆盖不了 50 / 100 的极淡背景场景（Active Tab 背景、徽章浅底）。
