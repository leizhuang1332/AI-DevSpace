---
Status: ready-for-agent
Type: task
Stage: 2
Supersedes: 08-builtin-skills.md (partial — trigger 机制)
Related-ADRs:
  - docs/adr/0008-skill-as-prompt-fragment.md
Related-Decisions: 39, 42, 44, 49
---

# 08b - 触发规则引擎 + Inline 提示栏 UI

## 目标

落地 [ADR-0008](docs/adr/0008-skill-as-prompt-fragment.md) 的**触发信号声明式、零 LLM 推理**机制 + [CONTEXT.md 决策 49](../CONTEXT.md) 的 Inline 提示栏 UI 边界。

## 范围

### A. 触发规则声明

每个 Skill 的 `SKILL.md` frontmatter 声明 `triggers:`：

```yaml
triggers:
  file_globs: ["requirement.md", "**/prd*.md"]      # 文件名模式（glob）
  focus_states: ["requirement.read", "requirement.draft"]  # 视图聚焦态
  artifact_kinds: ["sql.ddl", "openapi.yaml"]        # 工程物料类型
  project_signals: ["has_analysis=false"]            # 项目状态谓词
```

支持的操作符（**纯前端纯函数评估，零 LLM**）：

- [ ] `file_globs` → 匹配当前打开/选中的文件路径
- [ ] `focus_states` → 匹配当前 view 的 focus state（枚举值）
- [ ] `artifact_kinds` → 匹配当前 Requirement 的 artifact 类型集合
- [ ] `project_signals` → 谓词表达式解析（`has_X=true/false` / `count_X>N` / `last_X<7d`）

### B. 触发规则引擎

- [ ] 暴露 `matchTriggers(skill, currentContext): boolean` API
- [ ] Web 前端每次 focus / route / file 变化时调用 → 返回当前候命 Skill 列表
- [ ] 候命列表实时同步给 Agent（通过 SSE）
- [ ] Agent 收到后**只更新候命池**，不自动跑任何 Skill

### C. 5 类必沉默屏蔽（决策 44）

`matchTriggers` 之前先过必沉默 5 类：

1. [ ] 用户在读（focus 在文本块 + 2s 无输入 + 无滚动）→ 不出任何提示
2. [ ] 全屏沉浸模式（PRD 阅读 / Diff 全屏 / Schema 可视化）→ 不出
3. [ ] Web 标签不在前台（`document.hidden`）→ 不出
4. [ ] 麦克风/摄像头激活（`getUserMedia` active）→ 不出
5. [ ] 同 (skill, context) 被主动 dismiss ≥ 3 次 → silence 2 小时

实现：

- [ ] `SilenceDetector` 服务聚合 5 类信号
- [ ] 任一触发 → 直接屏蔽全部 Inline 提示栏
- [ ] dismiss 计数写入 localStorage（key: `skill:<name>:context:<hash>:dismiss_count`）

### D. Inline 提示栏 UI（决策 49）

视觉：

- [ ] 12px 灰字 + 1px 顶部分隔线 + 整行 ≤ 32px 高
- [ ] 不用按钮 / 不用弹窗 / 不用浮窗
- [ ] 内容：`💡 N 个候命能力 · ⌘K 打开 · 详见 knowledge://skills`
- [ ] hover 整行 → 浮出 3 行能力卡（不抢焦）

位置（由 Skill `hint.anchor` 声明）：

- [ ] 支持 `file.footer`（文件底部）
- [ ] 支持 `view.corner`（视图角落）
- [ ] 支持 `sidebar.bottom`（侧栏底部）
- [ ] 支持 `editor.selection`（编辑器选区旁）

消失逻辑：

- [ ] 进入新 (skill, context) → 1.5s 渐入
- [ ] 停留 > 30s 无动作 → 1.5s 渐出
- [ ] 用户**已见过**该 (skill, context) → 不再展示（除非 Skill 升级）
- [ ] 滚动过该区域 → 立即渐出
- [ ] hover 整行 → 撑住不消失

关闭粒度：

- [ ] 全局 on/off（Settings → AI 协作）
- [ ] 单 Skill on/off
- [ ] 关闭 ≠ 候命停止，关的只是"提醒"

### E. `Cmd+K` 升级

- [ ] Cmd+K 命令面板新增「能力」tab
- [ ] 顶部固定搜索 + Skill 标签分组
- [ ] 每个 Skill 一行：`<name> · <能力名> · <📍候命中 / 💤 休眠>`
- [ ] 末尾"候命"标记 = 当前 On-arming 或 Always-on
- [ ] 不分上下文，**全 Skill 全展示**（包含 Dormant）
- [ ] 输入 `/<skill-name>` 可直接执行（不需通过面板）

## 验收

- [ ] 打开 PRD → `requirement-clarify` / `requirement-brainstorm` / `requirement-critique` 自动进入候命
- [ ] 打开 `artifacts/*.sql` → `ddl-index-suggest` 自动进入候命
- [ ] worktree 有未提交 diff → `code-review` 自动进入候命
- [ ] 用户在读（焦点在文本 + 无输入）→ Inline 提示栏不出现
- [ ] 用户主动 dismiss 同 (skill, context) 3 次 → 2 小时内不再出现
- [ ] Inline 提示栏 12px 灰字 1 行 + hover 卡片
- [ ] Cmd+K 「能力」tab 显示全部 Skill + 候命状态标记
- [ ] 输入 `/<skill-name>` 直接执行（不需在面板里点）

## 依赖

- [08a-skill-loader-arming.md](08a-skill-loader-arming.md)（先有 Skill 才有触发）
- [05-requirement-crud.md](05-requirement-crud.md)（focus state 来源）
- [06-repo-worktree.md](06-repo-worktree.md)（worktree diff 信号）
