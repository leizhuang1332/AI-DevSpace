---
Status: ready-for-agent
Type: spec
Created: 2026-07-15
Feature: new-requirement-modal
Related: PRD.md
Implements: 决策 17 / 20 / 24 / 28 / 30 / 36 / 43 / 50 / 57
---

# 新建需求弹窗 · UI 打磨设计稿 v1.0.3

> 本 spec 是 `PRD.md` 的 UI 打磨升级版。规范前端组件 API + Tailwind class + 前后端接口契约。
>
> 设计基线继承 `.scratch/ai-devspace-mvp/UI-POLISH-SPEC.md` §1-§6,本文件仅补充本弹窗特有规范。

---

## 1. 设计基线(继承主 spec)

| 项 | 继承自 | 本弹窗特例 |
|---|---|---|
| 主题策略 | 主 spec §1.1(三档: System / Dark / Light) | 无 |
| 主色 brand | 主 spec §1.2(Linear 紫 #5e6ad2) | 无 |
| 语义色 | 主 spec §1.3(Success #16a34a / Warning #f59e0b / Error #ef4444 / Info #64748b) | Error 用于 E6-E9 红色 banner |
| 字体 | 主 spec §1.4(Inter + JetBrains Mono) | input 用 Inter,slug 预览用 JetBrains Mono |
| 信息密度 | 主 spec §1.5(Linear 紧凑型) | 弹窗宽 420px(vs v1.0 的 720px) |
| 三态 | 主 spec §1.6 / 决策 30(空态极简 / 加载混合 / 错误分层 L3) | 见 §7 / §8 |

---

## 2. 弹窗尺寸与定位

| 属性 | 值 | 备注 |
|---|---|---|
| 宽度 | 420px | `w-[420px]`(对比 v1.0 的 `w-[720px]` 缩 40%) |
| 最大宽度 | 90vw | 移动端保护 |
| 最大高度 | 90vh | 极端屏幕保护 |
| 圆角 | 12px | `rounded-xl`,与主 spec 对齐 |
| 阴影 | `shadow-2xl`(0 24px 64px / 0 8px 16px) | 与 v1.0 弹窗一致 |
| 定位 | 视口居中 | `flex items-center justify-center` |
| 背景遮罩 | `bg-slate-900/40` + `backdrop-blur-sm` | 与 v1.0 一致 |
| z-index | 100(遮罩)/ 101(弹窗) | 与 v1.0 一致 |

**布局结构**(顶到底):

```
┌─ modal-head:flex justify-between items-center px-6 py-5 border-b ─┐
│ ✨ 新建需求                                            ✕ [关闭]  │
├─ modal-body:px-6 py-6(单字段,无 step) ──────────────────────────┤
│                                                                  │
│ 需求名称 *                                                       │
│ [input]                                                          │
│ 创建后跳到 DRAFTING 工位继续                                       │
│ req-NNN-refund-optimization  ← slug 预览                       │
│                                                                  │
├─ modal-foot:flex justify-between items-center px-6 py-4 ───────┤
│ ⌘N 全局 · ESC 关闭          [取消]            [✓ 创建]            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. 字段规范

### 3.1 标题区(modal-head)

| 子项 | 规范 | Tailwind class |
|---|---|---|
| 容器 | flex justify-between items-center,px-6 py-5,border-b border-border | — |
| 标题 | "✨ 新建需求" | `text-xl font-semibold tracking-tight flex items-center gap-3 text-text-1` |
| 标题 emoji | "✨" 18px | inline `text-lg` |
| 关闭按钮 | 28x28,圆角 6px,默认 bg-bg-subtle,hover 变 bg-bg-elevated + text-text-1 | `w-7 h-7 rounded-md bg-bg-subtle text-text-3 text-sm hover:bg-bg-elevated hover:text-text-1` |
| 关闭图标 | "✕" | inline |

### 3.2 标签(label)

| 属性 | 值 |
|---|---|
| 文案 | "需求名称 *"(`*` 用 destructive 色 `#ef4444`) |
| 字号 | 12px(`text-sm font-medium text-text-1`) |
| 边距 | 与 input 间距 8px(`mb-2`) |
| 与上方间距 | `mb-5`(20px) |
| 不需要 helper text(决策 28 紧凑型) | — |

### 3.3 input

| 属性 | 值 | Tailwind class |
|---|---|---|
| 类型 | text | `type="text"` |
| 占位符 | "如:退款功能优化" | `placeholder` |
| 自动聚焦 | 开(决策 24 陪伴) | `autoFocus` |
| 最大长度 | 50 字 | `maxLength={50}`(HTML 拦截 + JS 校验双保险) |
| 字号 | 14px(`text-md`) | 与主 spec 9 档对齐 |
| 行高 | input 32px | `h-8`(行内对齐用 `py-3`) |
| 内边距 | 12px(p-3) | `px-3 py-3` |
| 背景 | bg-bg-subtle 默认,focus → bg-bg-elevated | `bg-bg-subtle focus:bg-bg-elevated` |
| 边框 | 1px border-border-strong 默认,focus → brand-500 | `border border-border-strong focus:border-brand-500` |
| 圆角 | 6px(rounded-md) | `rounded-md` |
| focus 阴影 | `0 0 0 3px rgba(94,106,210,0.15)`(brand 15% 透明) | `focus:shadow-[0_0_0_3px_rgba(94,106,210,0.15)]` |
| 字数计数 | 右下角 "X / 50",11px text-text-3 | `text-xs text-text-3 text-right mt-1` |
| 字符过滤 | 实时去路径非法字符 `\` `/` `:` `*` `?` `"` `<` `>` `\|` | onChange 内 slice + replace |

### 3.4 hint 文字

| 属性 | 值 |
|---|---|
| 文案 | "创建后跳到 DRAFTING 工位继续" |
| 字号 | 11px(text-xs) |
| 颜色 | text-text-3(#94a3b8) |
| 位置 | label 与 input 下方,slug 预览上方 |
| Tailwind | `text-xs text-text-3 mt-1` |

### 3.5 slug 预览

| 属性 | 值 |
|---|---|
| 文案 | 模板 `req-NNN-<slug>`,NNN 占位为 `###` 或实际编号 |
| 字号 | 13px(text-sm) |
| 字体 | JetBrains Mono |
| 颜色 | text-text-3(#94a3b8) |
| 位置 | hint 下方 |
| 实时性 | input onChange 即时更新 |
| 空态 | 用户未输入时显示灰色 `req-NNN-<slug>` 占位 |
| Tailwind | `text-sm font-mono text-text-3 mt-1` |

---

## 4. 按钮规范

### 4.1 取消按钮(footer 左)

| 属性 | 值 | Tailwind class |
|---|---|---|
| 尺寸 | 32px 高 × auto 宽 | `h-8 px-4` |
| 文案 | "取消" | — |
| 字号 | 14px | `text-md` |
| 字重 | 500 | `font-medium` |
| 颜色 | text-text-2 默认 → text-text-1 hover | `text-text-2 hover:text-text-1` |
| 背景 | 透明 | (无 bg) |
| 圆角 | 6px | `rounded-md` |

### 4.2 创建按钮(footer 右)

| 属性 | 值 | Tailwind class |
|---|---|---|
| 尺寸 | 32px 高 × auto 宽 | `h-8 px-4` |
| 文案 | "✓ 创建" | — |
| 字号 | 14px | `text-md` |
| 字重 | 500 | `font-medium` |
| 颜色 | 白字 | `text-white` |
| 背景 | brand-500 默认 → brand-600 hover | `bg-brand-500 hover:bg-brand-600` |
| disabled 态 | opacity-50 + cursor-not-allowed | `disabled:opacity-50 disabled:cursor-not-allowed` |
| 启用条件 | `name.trim().length > 0`(决策 E1) | `disabled={!canSubmit}` |

### 4.3 footer 容器

| 属性 | 值 |
|---|---|
| 布局 | flex justify-between items-center |
| 内边距 | px-6 py-4 |
| 边框 | border-t border-border |
| 背景 | bg-bg-subtle |
| 左侧辅助文字 | "⌘N 全局快捷键 · ESC 关闭",11px text-text-3 |

---

## 5. 配色与间距

继承主 spec,本弹窗补充:

### 5.1 配色映射

| 用途 | 颜色 | Tailwind class |
|---|---|---|
| 标题文字 | #0f172a | `text-text-1` |
| 次要文字 / hint | #94a3b8 | `text-text-3` |
| 必填星号 | #ef4444 | `text-destructive` |
| 主按钮背景 | #5e6ad2 | `bg-brand-500` |
| 主按钮 hover | #525bc7 | `bg-brand-600` |
| input 默认背景 | #f5f5f7 | `bg-bg-subtle` |
| input focus 背景 | #fff | `bg-bg-elevated` |
| input 边框 | #d8d8de | `border-border-strong` |
| 弹窗背景 | #fff | `bg-bg-elevated` |
| 弹窗阴影 | 0 24px 64px | `shadow-2xl` |
| 遮罩 | slate-900 40% | `bg-slate-900/40` |
| DRAFTING banner(空态) | #fffbeb 底 + #fde68a 边 + #78350f 字 | 决策 30 |
| DRAFTING banner(失败) | #fef2f2 底 + #fecaca 边 + #991b1b 字 | Error 浅变体 |

### 5.2 间距

继承主 spec 4 倍数:

| 用途 | 值 | Tailwind class |
|---|---|---|
| modal 内边距(顶/底/左/右) | 24px | `px-6 py-6` |
| 字段间垂直 | 20px | `mb-5` |
| label 与 input | 8px | `mb-2` |
| input 与 hint | 4px | `mt-1` |
| footer 与 body | 0(border 隔) | `border-t border-border` |
| footer 内边距 | 16px(y) / 24px(x) | `px-6 py-4` |
| footer 按钮间 | 8px | `gap-2` |
| 标题与关闭按钮 | 12px | `gap-3` |

---

## 6. 动画

### 6.1 入场

| 项 | 规范 |
|---|---|
| 类型 | 缩放淡入(决策 17 Linear 风) |
| 时长 | 150ms |
| 缓动 | cubic-bezier(0.16, 1, 0.3, 1)(Linear 默认) |
| 起始态 | `scale(0.95)` + `opacity(0)` |
| 结束态 | `scale(1)` + `opacity(1)` |
| 实现 | Tailwind `animate-in fade-in zoom-in-95 duration-150`(或 framer-motion `<motion.div>`) |

### 6.2 关闭

| 项 | 规范 |
|---|---|
| 类型 | 反向缩放淡出 |
| 时长 | 100ms(比入场短,决策 24 克制) |
| 实现 | 不依赖动画(弹窗直接卸载,主流程够快) |

### 6.3 focus 动效

| 项 | 规范 |
|---|---|
| input focus | 边框色 150ms 渐变 + 阴影 150ms 渐变 |
| 按钮 hover | 背景色 100ms 渐变 |
| slug 预览更新 | 无动画(瞬时) |

---

## 7. 错误/校验态视觉

| 错误码 | 触发条件 | 视觉表现 | Tailwind 实现 |
|---|---|---|---|
| E1 name 空 | trim 后空 | 创建按钮 disabled | `disabled:opacity-50` |
| E2 name 超 50 字 | maxLength=50 | input 层拦截 | `maxLength={50}` |
| E3 name 路径非法字符 | 用户粘贴 | input 层实时过滤 + slug 预览同步 | onChange 内 replace |
| E4 name 全空白 | 仅空格 | 视同空(E1) | trim() |
| E5 name 重复 | 与已有 title 同 | **不提示** | (无 UI) |
| E6-E9 提交失败 | 见 PRD §9 | DRAFTING 顶部红色 banner | 见 §8.2 |
| E10 用户取消 | 点 ✕ / ESC / 取消 | 弹窗关闭 | 无 |

**字数计数**(右下角):

```
需求名称 *
[退款功能优化                ]
创建后跳到 DRAFTING 工位继续
req-NNN-refund-optimization                  6 / 50
```

- `12 / 50`(默认色 #94a3b8)
- `50 / 50`(到达上限时不变红,只是不能再输入)

---

## 8. DRAFTING 跳转后空状态

### 8.1 成功路径:banner + 骨架屏

**阶段 1:骨架屏(决策 30)**

```html
<div class="flex items-center justify-center h-64">
  <div class="animate-pulse flex flex-col gap-3 w-full max-w-2xl">
    <div class="h-8 bg-bg-subtle rounded w-1/3"></div>
    <div class="h-4 bg-bg-subtle rounded w-2/3"></div>
    <div class="h-4 bg-bg-subtle rounded w-1/2"></div>
  </div>
  <div class="ml-4 text-text-2 text-sm">正在创建需求…</div>
</div>
```

- shimmer 1.5s 循环
- 阶段 2 切换到正常页面后消失

**阶段 2:顶部 banner(成功后)**

```html
<div class="px-6 py-3 bg-[#fffbeb] border-b border-[#fde68a] 
            flex items-center justify-between">
  <div class="flex items-center gap-2 text-sm text-[#78350f]">
    <span>📦</span>
    <span>未关联任何仓库 · 添加仓库后将自动创建 worktree</span>
  </div>
  <div class="flex items-center gap-2">
    <button class="h-7 px-3 rounded-md bg-bg-elevated border border-[#fde68a] 
                   text-sm text-[#78350f] hover:bg-[#fffbeb]">
      + 关联仓库
    </button>
    <button class="w-7 h-7 rounded-md text-[#78350f] hover:bg-[#fffbeb]">
      ✕
    </button>
  </div>
</div>
```

| 属性 | 值 |
|---|---|
| 高度 | ~48px(py-3) |
| 背景 | #fffbeb(决策 30 警告色淡变体) |
| 边框 | border-b border-[#fde68a] |
| 文字 | #78350f,14px |
| 左侧图标 | 📦 |
| 中部按钮 | "+ 关联仓库",32px 高 |
| 右侧关闭 | ✕,28x28 |
| 关闭后行为 | 不再显示,需手动触发"重新关联仓库"流程 |
| 首次关联第一个 repo 后 | banner 自动消失 |

### 8.2 失败路径:红色 banner(决策 30 L3)

```html
<div class="px-6 py-3 bg-[#fef2f2] border-b border-[#fecaca] 
            flex items-center justify-between">
  <div class="flex items-center gap-2 text-sm text-[#991b1b]">
    <span>❌</span>
    <span>创建失败 · 网络异常</span>
  </div>
  <button class="h-7 px-3 rounded-md bg-bg-elevated border border-[#fecaca] 
                 text-sm text-[#991b1b] hover:bg-[#fef2f2]">
    重试
  </button>
</div>
```

| 属性 | 值 |
|---|---|
| 背景 | #fef2f2(Error 红淡变体) |
| 边框 | border-b border-[#fecaca] |
| 文字 | #991b1b(Error 深色) |
| 错误文案 | 区分类型:"网络异常" / "鉴权失败" / "磁盘空间不足" |
| 重试按钮 | 调相同 POST,失败不重试超过 3 次(决策 30) |

### 8.3 底部 RepoBar N=0 空态

> 注:DRAFTING 工位**没有资源树**(参见 `apps/web/src/components/drafting-zone.tsx` 实际结构 + issue 18 / 23 演变)。仓库关联 UI 已在 `apps/web/src/components/repo-bar.tsx`(issue 08)以**底部 sticky bar** 形式存在。本节扩展 N=0 空态。

```html
<!-- RepoBar N=0 空态(扩展 issue 08) -->
<div data-testid="repo-bar-empty" class="repo-bar px-4 py-2.5 
            border-t border-border bg-bg-elevated flex items-center gap-3">
  <span class="text-xs text-text-3 font-medium">关联仓库</span>
  <button data-testid="repo-bar-add"
          class="h-7 px-3 rounded-md bg-brand-50 border border-brand-500 
                 text-sm text-brand-600 hover:bg-brand-100">
    ＋ 添加仓库…
  </button>
  <span data-testid="repo-bar-empty-hint" 
        class="text-xs text-text-3 ml-2">
    💡 首次添加仓库时会请你填写统一分支名
  </span>
  <span class="ml-auto text-xs text-warning">⚠ 0 个仓库 · ANALYZING 可能无法完整关联代码上下文</span>
</div>
```

| 属性 | 值 |
|---|---|
| 位置 | sticky bottom,DRAFTING 工作区底部 |
| 高度 | ~44px |
| 触发 | 点 `＋ 添加仓库…` chip → 弹 480px"关联仓库"弹层(§9.1) |
| N=0 视觉 | 原 chip 灰底 → 改 brand-50 淡紫底 + brand-500 边,引导点击 |
| 空态 hint | `💡 首次添加仓库时会请你填写统一分支名`,11px text-text-3 |
| 软警告 | 沿用 issue 08 的 `shouldShowRepoSoftWarning()` 函数 + 软警告文案 |

**改动范围**(基于 issue 08 已有 `repo-bar.tsx`):

- 新增 `data-testid="repo-bar-empty"`(N=0 时整条 bar 加这个 testid)
- 新增 `data-testid="repo-bar-empty-hint"`(N=0 时显示 hint)
- 复用 issue 08 的 `＋ 添加仓库…` chip,但 N=0 时改 brand 色样式
- N≥1 时 chip 仍显示(可继续追加仓库,触发 §9.2 简化弹层)

---

## 9. 首次关联仓库弹层规范

**触发**:DRAFTING **顶部 banner** `[+ 关联仓库]` 按钮 / **底部 RepoBar** `＋ 添加仓库…` chip(N=0 首次)/ `＋`(N≥1 追加,触发 §9.2 简化弹层)。两个入口共用同一个 480px 弹层。

### 9.1 首次关联(N≥1)—— 需填分支名

| 属性 | 值 |
|---|---|
| 宽度 | 480px |
| 标题 | "关联仓库 · <需求 title>" |
| 字段 1 | 仓库选择(多选 checkbox 列表,从全局仓库池 + 粘贴 Git URL) |
| 字段 2 | 统一分支名 input(必填,autoFocus) |
| 提交按钮 | "[✓ 添加]" |

```html
<div class="modal fixed inset-0 z-[100] flex items-center justify-center 
            bg-slate-900/40 backdrop-blur-sm">
  <div class="w-[480px] bg-bg-elevated rounded-xl shadow-2xl 
              flex flex-col">
    <div class="px-6 py-5 border-b border-border flex justify-between">
      <h2 class="text-xl font-semibold">关联仓库 · 退款功能优化</h2>
      <button>✕</button>
    </div>
    <div class="px-6 py-6">
      <div class="mb-5">
        <label class="block text-sm font-medium mb-2">此需求将关联以下仓库(可多选)</label>
        <div class="bg-bg-subtle border border-border rounded-md p-3 max-h-[200px] overflow-auto">
          <!-- checkbox list: refund-service / order-service / pay-gateway -->
        </div>
      </div>
      <div class="mb-5">
        <label class="block text-sm font-medium mb-2">统一分支名(应用于所有仓库)</label>
        <input placeholder="feat/refund-optimization" autoFocus 
               class="..."/>
        <div class="text-xs text-text-3 mt-1">基于默认 base 分支(main),可在仓库设置覆盖</div>
      </div>
    </div>
    <div class="px-6 py-4 border-t border-border bg-bg-subtle flex justify-end gap-2">
      <button>取消</button>
      <button>✓ 添加</button>
    </div>
  </div>
</div>
```

### 9.2 追加关联(N>1)—— 简化弹层

差异:
- **不显示**"统一分支名"字段
- 顶部一行小字提示:"将使用统一分支名 `feat/refund-optimization`(创建时已锁定)"
- 标题改为"追加仓库 · 退款功能优化"
- 其他字段一致

### 9.3 字段映射

| 字段 | v1.0.3 规范 |
|---|---|
| 仓库选择 | checkbox 列表(继承自 v1.0.3 的 `repo-picker` 组件,详见 `UI-POLISH-SPEC §3.6`) |
| 统一分支名 | input,placeholder "feat/<slug>",maxLength 100,禁止 `\` `/` `:` `*` `?` `"` `<` `>` `\|` 空白 |
| 提交 | Agent 给每个勾选 repo 创建 worktree |

---

## 10. 跨页面入口规范

### 10.1 概览页按钮(已存在,需接 modal)

位置:`(workspace)/page.tsx:18`

```html
<button class="h-8 px-3 rounded-md text-md font-medium bg-brand text-white 
               hover:bg-brand-600">
  + 新建需求
</button>
```

- 尺寸:32px 高 × auto 宽
- 主色 brand 背景 + 白字
- 触发:onClick → `useUIOverlay().openCmdN()`

### 10.2 需求列表页按钮(已存在,需接 modal)

位置:`(workspace)/requirements/page.tsx:27`

规范与 10.1 完全一致(同款按钮,共享样式)。

### 10.3 Cmd+K 命令面板

位置:`(workspace)/layout.tsx` → `command-palette.tsx`

新增命令:
- label: "新建需求"
- icon: ✨
- shortcut hint: ⌘N
- action: `useUIOverlay().openCmdN()`

### 10.4 ⌘N 全局快捷键

位置:`(workspace)/layout.tsx` → `keyboard-bridge.tsx`

```ts
if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
  e.preventDefault()
  useUIOverlay.getState().openCmdN()
}
```

---

## 11. 键盘快捷键

| 快捷键 | 场景 | 行为 |
|---|---|---|
| `⌘N` / `Ctrl+N` | 任何页面 | 打开新建需求弹窗 |
| `ESC` | 弹窗打开时 | 关闭弹窗(无副作用,决策 E10) |
| `Enter` | input 聚焦时 | 提交创建(若 canSubmit=true) |
| `Tab` / `Shift+Tab` | 弹窗内 | 焦点在 [关闭] → [input] → [取消] → [✓ 创建] 间循环(焦点陷阱) |

---

## 12. 无障碍(a11y)

| 项 | 规范 |
|---|---|
| role | `role="dialog"` |
| aria-modal | `aria-modal="true"` |
| aria-labelledby | 指向 modal-head 标题(`<h2 id="modal-title">`) |
| aria-describedby | 指向 hint(`<p id="modal-desc">`) |
| 焦点管理 | 打开时 autoFocus 到 input;关闭后焦点回到触发按钮 |
| 焦点陷阱 | Tab / Shift+Tab 在弹窗内循环 |
| ESC 关闭 | 见 §11 |
| 颜色对比 | 所有文字 WCAG AA(主 spec §1.3 已对齐) |
| 屏幕阅读器 | 必填字段 aria-required="true";错误态 aria-invalid="true"(本弹窗 E1-E4 由 HTML 层拦截,无需 aria-invalid) |

---

## 13. 验收 Checklist(给前端 Agent 落地)

- [ ] 弹窗 420px 宽 / rounded-xl / shadow-2xl
- [ ] 标题区 "✨ 新建需求" + ✕ 关闭
- [ ] 标签 "需求名称 *" 12px
- [ ] input 14px / maxLength=50 / autoFocus / bg-subtle focus:bg-elevated / focus:border-brand-500
- [ ] hint "创建后跳到 DRAFTING 工位继续" 11px text-3
- [ ] slug 预览 `req-NNN-<slug>` JetBrains Mono 13px text-3 实时
- [ ] 字数计数 `X / 50` 右下角 11px text-3
- [ ] footer 左 "⌘N 全局快捷键 · ESC 关闭" 11px text-3
- [ ] footer 右 [取消] 32px ghost + [✓ 创建] 32px brand-500(disabled 当 title 空)
- [ ] 入场动画:缩放淡入 150ms
- [ ] ⌘N 全局 / Ctrl+N 全局 / Cmd+K "新建需求" / 概览页按钮 / 需求列表页按钮 共 5 入口
- [ ] 提交后:弹窗立即关 + 跳 DRAFTING
- [ ] DRAFTING 骨架屏 1.5s shimmer
- [ ] DRAFTING 顶部 banner(成功:淡黄 / 失败:红色)
- [ ] 资源树"仓库"节点空态 + hint 卡
- [ ] 首次关联仓库弹层 480px + 统一分支名 input
- [ ] 追加关联仓库弹层(简化版,无分支名 input)
- [ ] 角色 / aria 属性 / 焦点陷阱 / ESC 关闭 全部就位
- [ ] 旧 `15-new-requirement-modal.html` 加 deprecation 注释
- [ ] `new-requirement-modal.tsx` 按本 spec 重写
- [ ] 测试:`__tests__/new-requirement-modal.test.tsx` 覆盖 PRD §9 的 E1-E10

---

> **状态**:ready-for-agent。可直接驱动 React 组件 + Tailwind class 落地。
