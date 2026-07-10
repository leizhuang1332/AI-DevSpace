---
Status: ready-for-agent
Type: task
Stage: 2
Supersedes: 08-builtin-skills.md (partial — Skill 自我学习)
Related-ADRs:
  - docs/adr/0009-ai-failure-defense.md
Related-Decisions: 46, 48
---

# 08d - 👎 反馈通道 + Skill 自我学习

## 目标

落地 [ADR-0009](docs/adr/0009-ai-failure-defense.md) 的第 5 层"**学**"：用户对 AI 输出的反馈沉淀到 Skill 自身，下次跑同 Skill 时 AI 主动看这条记录 → 调整输出。

## 范围

### A. 👎 / 👍 按钮 UI

- [ ] 任何 AI 输出（chat 消息、artifact 块、code review 报告）旁都有 Ink-style 反馈按钮
- [ ] 按钮形态：
  - hover 整行输出 → 浮现 `[👎 这有问题]` `[👍 还行]` `[📋 复制]`
  - 不 hover → 不显示（不抢焦）
- [ ] 点 👎 → 弹出 1 行 modal：

```
+--------------------------------------+
| 这次哪里不好？                       |
|  □ 写错位置    □ 内容错误           |
|  □ 多此一举    □ 没理解我意思       |
|  □ 违反规范    □ 其他：_________   |
|  [提交]                              |
+--------------------------------------+
```

### B. 反馈数据模型

- [ ] `SKILL.md` frontmatter 新增 `bad_feedback:` 字段（数组）
- [ ] 每条反馈结构：

```yaml
bad_feedback:
  - id: bf-<uuid>
    created_at: 2026-07-10T15:30:22
    requirement_id: req-001
    reason: "写错位置"           # 6 类原因之一
    detail: "写到了别人家的 requirement.md"  # 用户可填
    skill_context: "code-scaffold"  # 哪个 Skill 的哪个 turn
    ai_output_excerpt: "..."     # 引发反馈的 AI 输出片段
  - id: bf-<uuid>
    ...
```

- [ ] `good_feedback:` 字段类似（👍 记录）——结构相同但语义反向
- [ ] 用户可手动编辑（Settings → Skill 管理 → 反馈历史）

### C. 反馈 → Skill 学习的注入

- [ ] Agent 每次跑某 Skill 时：
  1. 读该 Skill 的 `bad_feedback:` 字段
  2. 在 system prompt 末尾追加：

```
[本 Skill 历史反馈]
用户曾指出以下问题（按时间倒序，最近 5 条）：

- 2026-07-10 「写错位置」写到了别人家的 requirement.md
- 2026-07-09 「内容错误」把 decimal 写成 varchar
- 2026-07-08 「没理解我意思」我说的"加索引"是指普通索引，不是唯一索引
- 2026-07-07 「违反规范」未走 coding-standards Skill
- 2026-07-06 「多此一举」我不需要 update_time 字段

最近 10 次 👍 反馈的摘要：
- 大部分用户满意"加测试"动作
- 用户对 commit message 风格偏好 imperative mood
```

- [ ] LLM 据此调整输出
- [ ] 👍 反馈**不**注入到 prompt（避免诱导），仅用于统计 + 衰减旧 👎

### D. 反馈衰减机制

- [ ] 同一 (reason, skill_context) 组合的 👎 反馈**半年后**自动降权
- [ ] 衰减规则：`<半年`：正常显示 / `半年~1年`：标 `[已旧]` 弱化 / `>1年`：归档到 `bad_feedback.archive:` 字段
- [ ] 用户可手动"标记为已解决" → 立即归档

### E. Web 端

- [ ] Skill 管理页（`/skills`）每行 Skill 显示 `👎 N` `👍 M` 计数
- [ ] 点开 → 反馈历史时间线（可筛选 reason / 时间 / 关联 Requirement）
- [ ] 反馈详情页：完整 AI 输出 + diff + 用户原因
- [ ] "标记为已解决" / "删除" 操作

### F. 反馈触发源头去重

- [ ] 同一 (skill, requirement, output_hash) 的反馈 24h 内**只接受 1 次**
- [ ] 避免用户重复点 👎 重复记录
- [ ] 24h 后再点 → 新条目

## 验收

- [ ] AI 输出旁 hover 出现 👎 👍 按钮
- [ ] 点 👎 弹 6 类原因 + 详情输入
- [ ] 提交后写入该 Skill `SKILL.md` 的 `bad_feedback:` 字段
- [ ] 下次跑同 Skill 时，system prompt 注入"本 Skill 历史反馈"段
- [ ] 半年后旧反馈自动弱化 / 归档
- [ ] Skill 管理页能查看反馈历史 + 标记解决 + 删除
- [ ] 同一输出 24h 内不重复记录

## 不做

- 强制收集反馈（用户不点就不记）
- 自动发现"AI 错了"（必须用户主动点）
- 跨 Skill 反馈传染（一个 Skill 的反馈不污染另一个）

## 依赖

- [08a-skill-loader-arming.md](08a-skill-loader-arming.md)（Skill 加载器读取新字段）
- [08c-snapshot-undo.md](08c-snapshot-undo.md)（翻车防线前 4 层）
- 后续可考虑：自动从 git revert 推断"用户不喜欢这次 AI 输出"——P1+
