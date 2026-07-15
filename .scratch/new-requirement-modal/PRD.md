---
Status: ready-for-agent
Type: prd
Created: 2026-07-15
Feature: new-requirement-modal
Supersedes: docs/design/pages/15-new-requirement-modal.html (已 deprecate,见 [§11](#11-v10--v103-字段变更表))
Implements: 决策 15 / 17 / 24 / 28 / 36 / 38 / 43 / 50 / 57 / 71
Related:
  - .scratch/ai-devspace-mvp/PRD.md §5(主 PRD)
  - .scratch/ai-devspace-mvp/UI-POLISH-SPEC.md(主 UI spec)
  - docs/agents/issue-tracker.md(feature-per-directory 约定)
  - docs/agents/domain.md(CONTEXT.md / ADR)
---

# 新建需求弹窗 · PRD v1.0.3

> 本 PRD 补全决策 36 锁定的"三件套单一事实源"中缺失的两环(PRD + UI-POLISH-SPEC),并把 v1.0 时代的 720px / 5 字段弹窗重做为 v1.0.3 的 420px / 1 字段极简弹窗,符合决策 17(Linear 风)+ 决策 28(紧凑型)+ 决策 24(陪伴哲学)。
>
> 后端落盘由 Agent 端 (1) 创建 `~/.aidevspace/requirements/req-NNN-<slug>/` 目录,(2) 写 `meta.yaml` + `requirement.md`,(3) **不**预先建 worktree——worktree 在 DRAFTING 工位首次关联仓库时建(决策 4 + Q7)。

---

## 1. Problem Statement

v1.0 时代 `new-requirement-modal.tsx` + `docs/design/pages/15-new-requirement-modal.html` 是 720px / 5 字段 / 步骤指示器(不分步)的弹窗,字段包含:**需求名称 / 目标分支 / 关联仓库 / PRD 原文(5000 字) / Skill 链(analyze→design→plan→code→test→submit)**。

这个设计与 v1.0.2 后的决策栈冲突:

| v1.0 字段 | v1.0.3 决策 | 冲突点 |
|---|---|---|
| Skill 链 | 决策 38(Skill = 提示词封装,不是执行单元) | "链"概念已死;Skill 按工位装填(决策 54) |
| PRD 原文(5000 字) | 决策 50(DRAFTING 独立工位)+ 决策 28(紧凑型) | 双写源不一致;弹窗太重 |
| 目标分支 | 决策 4(git worktree 多 repo) + 决策 50(EXECUTING 接管 submit) | 需求级 target 在多 repo 场景语义分裂 |
| 关联仓库 | 功能内聚原则(Q7) | 应归属 DRAFTING 工位资源树 |

**结果**:弹窗承担了它不该承担的配置决策,与"AI 陪伴哲学"违反。

---

## 2. User Story

> "我按下 `⌘N`,快速给一个想法起个名字,点 `[✓ 创建]` 弹窗立即消失,自动跳到 DRAFTING 工位。我在那里先点资源树的 `📦 仓库` 节点关联仓库,首次关联时弹一个小窗让我给所有 repo 统一起一个分支名(比如 `feat/refund-optimization`),然后写 PRD、写 AC——剩下的事 AI 会兜底,我主导。"

**用户角色**:后端开发者,刚冒出"我要做 XX"的想法,想立刻落地为工作单位。

**核心诉求**:
1. **极简创建**:从 `⌘N` 到落地 ≤ 3 秒(填名字 + 回车)
2. **零认知负担**:不强迫用户思考"我该选哪个 base 分支""我该怎么起分支名""PRD 写多长"
3. **上下文就近**:关联仓库 / 分支名等决策,**留到用户进入 DRAFTING 工位、有 PRD 编辑环境、有资源树时再做**

---

## 3. 范围(Scope)

**弹窗做**:
- 接收 1 个 input:需求名称(`title`)
- 校验:`a2`(50 字软限制)/ `b2`(禁止路径非法字符 + slug 实时预览)/ `c1`(允许同名)
- 提交后:立即关闭弹窗 → 跳 DRAFTING 工位(决策 57)
- 触发入口:`⌘N` 全局 / Cmd+K 命令面板搜"新建需求" / 概览页按钮 / 需求列表页按钮

**DRAFTING 工位承接**(在弹窗外):
- **底部 RepoBar N=0 空态**(issue 08 已有 RepoBar,本 ticket 扩展 N=0 视觉 + hint 卡)
- 首次关联时弹"统一分支名"小窗(480px)
- PRD 编辑器 + 辅助文件
- 关联仓库(支持多 repo 选 + 粘贴 Git URL,沿用 issue 08 的 RepoBar chip 模型)

> 注:DRAFTING 工位**没有资源树**(参见 `apps/web/src/components/drafting-zone.tsx` 实际结构 + issue 18 / 23 演变;仓库关联通过**底部 RepoBar** 实现)。决策 50 表格中的"DRAFTING ✅ 仓库"指 RepoBar,不是资源树节点。

**弹窗不做**:
- 不暴露 Skill 链 / PRD 文本 / 目标分支 / 关联仓库

---

## 4. 非目标(Non-goals)

| 不做 | 理由 | 决策依据 |
|---|---|---|
| Skill 链选择 | 决策 15 + 38 + 50:Skill 是上下文触发能力,不是流程链 | 决策 38 |
| PRD 原文输入 | 决策 50:DRAFTING 工位独立写 PRD | 决策 50 |
| 目标分支 / base 分支 | 决策 4:worktree 由仓库级配置 + EXECUTING 工位接管 | 决策 4 |
| 关联仓库 | 功能内聚原则(Q7) | Q7 |
| 标签 / 分类 | 决策 15:不写状态机 | 决策 15 |
| 优先级 / 截止日期 | v1.0 范围外 | — |
| 模板复制 | v1.0 范围外 | — |

---

## 5. 触发入口(Triggers)

按优先级排序:

| # | 入口 | 触发场景 | 实现位置 |
|---|---|---|---|
| 1 | `⌘N` / `Ctrl+N` 全局快捷键 | 任何页面,用户在写代码时突发想法 | `keyboard-bridge.tsx` |
| 2 | Cmd+K 命令面板搜"新建需求" | 用户习惯命令面板流 | `command-palette.tsx` |
| 3 | 概览页 `+ 新建需求` 按钮 | 0 个需求时的空态 CTA / 常规入口 | `(workspace)/page.tsx` |
| 4 | 需求列表页 `+ 新建需求` 按钮 | 列表页新建 | `(workspace)/requirements/page.tsx` |

**入口语义**:四个入口共用同一个 `useUIOverlay().cmdN = true` 状态(decision 36 三层叠 overlay),背后渲染同一个 `<NewRequirementModal />` 组件。

---

## 6. 弹窗 UX 流程

详见 `UI-POLISH-SPEC.md §2-§7` 与 `docs/design/pages/01-new-requirement-modal.html`。

**流程概要**:

```
[触发] → [弹窗出现 420px] → [用户输入 title] → [点 ✓ 创建]
                                          ↓
                          [弹窗立即关闭 + 跳 /requirements/<new-id>/drafting/]
                                          ↓
                          [DRAFTING 顶部 banner 提示"未关联仓库"]
```

---

## 7. 提交后行为

| 阶段 | 行为 | UI 表现 |
|---|---|---|
| 1. 提交 | 点 `[✓ 创建]` | 按钮瞬时 disabled + 弹窗立即关闭(不显示 spinner) |
| 2. 跳转 | router.push(`/requirements/<new-id>/drafting/`) | 浏览器路由切换 |
| 3. 创建中 | Agent 端 `POST /api/requirements` + 写 meta.yaml + requirement.md | DRAFTING 骨架屏(决策 30:shimmer 1.5s) |
| 4. 完成 | 骨架屏消失 | DRAFTING 顶部 banner 出现"📦 未关联任何仓库…" + **底部 RepoBar N=0 空态**(issue 08 已有) |
| 5. 失败 | 网络错 / 权限错 / 磁盘满 | DRAFTING 顶部 banner 变红色"创建失败 · [重试]" |

**关键决策(决策 11 I 方案)**:**弹窗不阻塞 UI**——创建动作完全在 DRAFTING 接管,弹窗本身只负责"录入 title + 关闭 + 跳转"。失败由 DRAFTING 兜底。

---

## 8. 数据契约

### 8.1 输入(Frontend → Backend)

```ts
// POST /api/requirements
{
  title: string   // 1-50 字,已 b2 过滤路径非法字符,trim 后非空
}
```

后端**不接受**其他字段(Skill 链 / PRD / 分支 / 仓库 都不在契约里)。

### 8.2 输出(Backend → Filesystem)

按决策 2(纯文件系统):

```
~/.aidevspace/requirements/
  req-<NNN>-<slug>/
    meta.yaml
    requirement.md    # 空模板(只有 # <title> + 留白)
```

| 字段 | 来源 | 说明 |
|---|---|---|
| `req-<NNN>-<slug>` | 自动生成 | NNN 自增(查 `requirements/` 目录最大编号 +1);slug = title → kebab-case + 路径非法字符过滤 |
| `meta.yaml.id` | 自动 | `req-<NNN>-<slug>` |
| `meta.yaml.title` | 用户输入 | trim 后非空 |
| `meta.yaml.createdAt` | 后端 | ISO 时间戳 |
| `meta.yaml.status` | 不设 | 决策 15 + 57:不基于 status 推断 |
| `requirement.md` | 后端 | 空模板,等用户在 DRAFTING 编辑 |

**注意**:worktree **不在创建时建**——等用户在 DRAFTING 资源树"仓库"节点首次关联 repo 时,Agent 才基于配置 base 分支(默认 main)拉同名分支。

### 8.3 slug 生成规则

```ts
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s　]+/g, '-')              // 空白(含全角空格)→ -
    .replace(/[\\\/:*?"<>|]/g, '')              // 路径非法字符去除
    .replace(/[^\p{L}\p{N}\-_.]/gu, '')         // 仅保留字母数字 + - _ .
    .replace(/-+/g, '-')                        // 多个 - 合并
    .replace(/^-+|-+$/g, '')                    // 去首尾 -
    .slice(0, 50) || 'untitled'                // 截断 50 字,空 fallback
}
```

例:
- `退款功能优化` → `退款功能优化`
- `Order Refund V2!` → `order-refund-v2`
- `  测试 / 边界  ` → `测试-边界`

slug 预览在弹窗 input 下方实时渲染:`req-NNN-<slug>`(`NNN` 占位,提交后填实际编号)。

---

## 9. 错误态

| 场景 | 触发条件 | UI 表现 | 兜底 |
|---|---|---|---|
| **E1 name 为空** | trim 后空 | `[✓ 创建]` 按钮 disabled | 无 |
| **E2 name 超 50 字** | input maxLength=50 | input 层拦截,无法输入 | 无 |
| **E3 name 路径非法字符** | 用户粘贴 `\` `/` `:` 等 | input 层实时过滤 + slug 预览同步 | 无 |
| **E4 name 全是空白** | 仅空格 / 全角空格 | 视同空,E1 处理 | 无 |
| **E5 name 重复** | 用户输入与已有需求 title 相同 | **不提示**(决策 c1:允许同名,ID 唯一即可) | 无 |
| **E6 提交失败-网络错** | Agent 端 fetch 失败 | DRAFTING 红色 banner"创建失败 · 网络异常 · [重试]" | [重试] 按钮调相同 POST |
| **E7 提交失败-权限错** | Agent 鉴权失败(决策 34) | 红色 banner"创建失败 · 鉴权失败 · [查看]" | [查看] 跳设置页 |
| **E8 提交失败-磁盘满** | Agent 端写文件失败 | 红色 banner"创建失败 · 磁盘空间不足 · [查看日志]" | [查看日志] 打开 Agent 日志 |
| **E9 路由跳转失败** | router.push 失败 | 弹窗不关,红色 inline 提示"无法跳转,请刷新页面" | 手动刷新 |
| **E10 用户主动取消** | 点 `[取消]` / `ESC` / 关闭 ✕ | 弹窗关闭,**无副作用**(需求未创建) | 无 |

---

## 10. 关联(Related)

### 10.1 决策依赖

| 决策 | 引用方式 |
|---|---|
| 决策 15(不写状态机) | 弹窗不暴露标签/分类/Skill 链 |
| 决策 17(Linear 风) | 弹窗形态 |
| 决策 20(brand 紫 #5e6ad2) | 主色 |
| 决策 24(陪伴哲学) | slug 预览 / DRAFTING 顶部 banner |
| 决策 28(紧凑型) | 420px / 字号 9 档 / 间距 4 倍 |
| 决策 30(空态极简) | DRAFTING 骨架屏 / banner 设计 |
| 决策 36(三层叠 overlay) | Cmd+K / Cmd+/ / Cmd+N 都作 overlay |
| 决策 38(Skill = 提示词封装) | 移除 Skill 链字段 |
| 决策 43(陪伴哲学硬约束) | 错误态 / 失败兜底 |
| 决策 50(7 产品形态) | DRAFTING 是独立工位承接 PRD/仓库 |
| 决策 57(默认 redirect DRAFTING) | 提交后跳转目的地 |
| 决策 71(增量更新) | 后续追加 repo 时复用首条分支名 |

### 10.2 引用主 PRD / 主 UI-SPEC

- `.scratch/ai-devspace-mvp/PRD.md §5`(产品形态总览)
- `.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md §1-§6`(设计系统基线)

### 10.3 引用 ADR

- [ADR-0011](../docs/adr/0011-requirement-workbench-zone-adaptive.md):需求工作台 7 产品形态
- [ADR-0012](../docs/adr/0012-requirement-workbench-shell-topology.md):工位 shell + ZoneBar
- [ADR-0013](../docs/adr/0013-analyzing-zone-rewrite.md):决策 50 / 57 / 58 / 60 / 63

---

## 11. v1.0 → v1.0.3 字段变更表

| 字段 | v1.0 | v1.0.3 | 决策依据 |
|---|---|---|---|
| **需求名称** | ✅ 必填 | ✅ 必填 | 保留 |
| **目标分支(合并到)** | ✅ 可选,默认 main | ❌ **移除** | 决策 4 + 50:worktree base 由仓库级配置;EXECUTING 接管 submit |
| **关联仓库** | ✅ 必填,多选 + 粘贴 URL | ❌ **移除**(迁 DRAFTING) | Q7 功能内聚 |
| **PRD 原文(5000 字)** | ✅ 可选,textarea | ❌ **移除**(迁 DRAFTING) | 决策 50 + 28 |
| **默认 Skill 链** | ✅ 展示性 6 chip | ❌ **移除** | 决策 38 + 54 |
| **统一分支名** | ❌ 无 | ✅ DRAFTING 首次关联时填 | Q7 新增机制 |
| **slug 预览** | ❌ 无 | ✅ input 下方实时 | 决策 24 陪伴感 |
| **步骤指示器**(1/2/3) | ✅ 视觉装饰,实际不分步 | ❌ **移除** | 决策 15 不写流程 |

---

## 12. 验收清单(给 Agent 落地用)

- [ ] 弹窗 420px 宽,只剩 1 个 input
- [ ] input maxLength=50 + 实时 slug 预览
- [ ] `⌘N` / `Ctrl+N` 全局快捷键
- [ ] Cmd+K 命令面板搜"新建需求"能触发同 modal
- [ ] 概览页 / 需求列表页 `+ 新建需求` 按钮接 modal
- [ ] 点 `[✓ 创建]` 立即关闭 + 跳 DRAFTING
- [ ] DRAFTING 骨架屏(决策 30)
- [ ] DRAFTING 顶部 banner 空状态(成功路径)
- [ ] DRAFTING 顶部 banner 失败态(网络/权限/磁盘)
- [ ] 底部 RepoBar N=0 空态(issue 08 基础上扩展)+ 首次关联时弹"统一分支名"小窗
- [ ] 后端 `POST /api/requirements` 契约:`{ title: string }`
- [ ] 后端写 `meta.yaml` + `requirement.md` 空模板
- [ ] 旧 `15-new-requirement-modal.html` 加 deprecation 注释 + 重定向到 `01-new-requirement-modal.html`
- [ ] `apps/web/src/components/new-requirement-modal.tsx` 按本 PRD 重写
- [ ] 测试:`__tests__/new-requirement-modal.test.tsx` 覆盖 E1-E10

---

> **状态**:ready-for-agent。可直接驱动后续 issue 拆分与 React 组件重写。
