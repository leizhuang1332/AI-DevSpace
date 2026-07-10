---
Status: ready-for-agent
Type: task
Stage: 2
Supersedes: 08-builtin-skills.md
Related-ADRs:
  - docs/adr/0008-skill-as-prompt-fragment.md
Related-Decisions: 11, 15, 24, 38, 40, 41, 42
---

# 08a - Skill 加载器 + 装填深度（Arming Level）

## 目标

把旧"按阶段调用 Skill"模型**彻底反转**为"按上下文装填"模型。落地 [ADR-0008](docs/adr/0008-skill-as-prompt-fragment.md) 的核心机制：Skill 是提示词封装、装填深度三档、由 Skill loader 调度注入。

## 范围

### A. Skill 加载器

- [ ] 启动时扫描 `skills/_built-in/` 和 `skills/user/` 两个目录
- [ ] 解析每个 Skill 的 `SKILL.md` frontmatter（`triggers:` / `arming:` / `hint:` / `artifacts:` / `bad_feedback:` 字段）
- [ ] 缓存到内存：`Map<skillName, SkillManifest>`
- [ ] 提供 `getArmedSkills(context): Skill[]` API（按当前上下文 + arming 配置返回）
- [ ] 提供 `composeSystemPrompt(skills, userContext): string` API（按 arming 级别拼接 system prompt）

### B. 装填深度三档（Arming Level）

- [ ] 数据模型：`Skill.arming ∈ { 'always-on' | 'on-arming' | 'dormant' }`
- [ ] 注入策略：
  - **Always-on** → 完整 SKILL.md 正文追加到 system prompt
  - **On-arming** → 仅 `[候命] <name> — <1 句描述>` 一行追加
  - **Dormant** → 0 注入
- [ ] Always-on 数量**默认上限 3 个**（`config.yaml` 可配 `max_always_on: N`）
- [ ] 用户在 Skill 管理页把某 Skill 改为 Always-on 时弹**二次确认**（"这会让 AI 一直知道这件事"）
- [ ] 超过上限 → 阻止并提示用户先关掉一个

### C. 软必装填（开发用）

- [ ] 默认 Always-on = 1 个：**项目编码规范 Skill**（由 Issue 10 的 `code-standards/SKILL.md` 自动注册）
- [ ] 默认 On-arming = 系统按 Skill 数量 + 上下文智能排序前 10 个
- [ ] Dormant = 其余所有 Skill

### D. 默认 12 个内置 Skill（能力维度，非阶段维度）

替代旧的 6 阶段 Skill。**全部 On-arming 默认**（用户可自调）：

| Skill 名 | 触发场景（默认） | 能力 |
|---|---|---|
| `requirement-clarify` | 打开 PRD / 编辑 requirement.md | 列出待澄清问题 |
| `requirement-brainstorm` | 打开 PRD / 在 analysis 阶段 | 头脑风暴多种方案 |
| `requirement-critique` | 打开 PRD / 设计稿完成 | 挑刺找漏洞 |
| `schema-design` | 用户请求 DB 设计 / artifacts 缺失 DDL | 生成 DB schema |
| `api-design` | 用户请求 API 设计 / artifacts 缺失 openapi | 生成 OpenAPI spec |
| `service-design` | 设计阶段 | 生成 service 层设计 |
| `ddl-index-suggest` | `artifacts/*.sql` 文件被打开/编辑 | 基于查询模式推荐索引 |
| `code-scaffold` | worktree 激活 / 用户请求"开始写" | 生成代码骨架 |
| `code-review` | worktree 有未提交 diff | 静态检查 + 风格 + 风险 |
| `test-gen` | code 完成 / test-standards 引用 | 生成测试用例 |
| `commit-message-draft` | 用户请求 commit | 起草 commit message |
| `pr-description` | 用户请求 PR | 起草 PR 描述 |

> 这些 Skill **不**绑定到任何"阶段"——用户任何时候都可显式 `/<skill-name>` 加载。

### E. Web 端

- [ ] Skill 管理页（`/skills`）：列表 + 装填档位下拉 + 触发规则查看 + 启用/禁用开关
- [ ] Always-on 选择时弹二次确认 modal
- [ ] 当前 arming 配置导出到 `config.yaml`

## 验收

- [ ] 启动时 12 个内置 Skill 全部正确加载
- [ ] 切到 Always-on 1 个 Skill，SDK 调用的 system prompt 长度增加该 Skill 的正文长度
- [ ] 切到 On-arming，system prompt 仅多 `[候命] xxx — yyy` 一行
- [ ] 切到 Dormant，system prompt 不变
- [ ] Always-on 超过 3 个时被阻止 + 提示
- [ ] 把 Skill 从 Dormant 改 Always-on 时弹确认
- [ ] Web 端能查看/修改每个 Skill 的 arming 档位

## 不做

- 阶段化状态机（v1.0 旧模型，废弃）
- `▶ 运行当前 Skill` 按钮（删除）
- `meta.yaml.status` 强状态机（已改为软 `current_focus`）
- LLM 自主判断 Skill 加载（违反"零 LLM 决策"铁律）

## 依赖

- [03-agent-skeleton.md](03-agent-skeleton.md)（Agent 基础服务）
- [07-ai-chat-panel.md](07-ai-chat-panel.md)（SDK 集成已就位）
- [10-coding-standards.md](10-coding-standards.md)（code-standards Skill 注册为 Always-on）
- [08b-context-triggers.md](08b-context-triggers.md)（装填后还要做触发匹配）
