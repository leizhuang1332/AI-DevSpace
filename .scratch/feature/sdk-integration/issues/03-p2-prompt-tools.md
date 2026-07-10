---
Status: needs-triage
Type: task
Stage: P2
---

# 03 - P2 System prompt 装配 + 5 类高危 hook

## 目标

落地 ADR-0010 Q5（System prompt 装配）+ Q6（5 类高危 → SDK PreToolUse hook）。

## 范围

### Q5 System prompt

- [ ] `prompt/SystemPromptAssembler.ts` — 拼装 system prompt
  - `assembleBase(session)` — per-session base：平台哲学 + Always-on Skills 全文（按 [ADR-0008](../../docs/adr/0008-skill-as-prompt-fragment.md) 装填三档）
  - `assembleDynamic(query, session, req)` — per-query dynamic：当前 focus + 99-summary + relevant Skill 反馈（按决策 48 👎 反馈通道）
  - 返回完整字符串，调 SDK 时用 `options.appendSystemPrompt`
- [ ] `prompt/SkillLoader.ts` — 解析 Skill `SKILL.md` frontmatter
  - 读 `triggers:` / `arming:` / `hint:` / `artifacts:` / `context:` 字段
  - 按 `context:` 字段声明的文件路径读 Skill 需要的上下文（Q5.4 严格按 Skill 自报家门）
  - `bad_feedback:` 字段读取（决策 48）
- [ ] Markdown 分节渲染（Q5.3）：
  ```
  ## Platform Philosophy
  ...
  ## Active Skills (Always-on)
  ...
  ## On-arming Skills
  ...
  ## Current Context
  ...
  ## Skill Feedback
  ...
  ```

### Q6 5 类高危 PreToolUse hook

- [ ] `tools/PermissionHook.ts` — 包装 SDK `PreToolUse` hook
  - 接收 `(toolName, input) => { allow: boolean, reason?: string }`
  - 返回 deny → 工具调用立即返回错误给 AI
- [ ] `tools/HighRiskDetector.ts` — 5 类检测
  - **删业务文件**：`Bash` 含 `rm ` 且非白名单；`Edit`/`Write` 目标在「不可碰」清单
  - **force-push**：`Bash` 正则 `git push.*(-f|--force)\b`
  - **推 main**：`Bash` 命令解析后 target branch ∈ {main, master}
  - **敏感信息**：`Write`/`Edit` content 走 secrets 扫描（`api_key=` / `Bearer ` / `AKID`）
  - **跳 verify**：`Bash` 含 `--no-verify` / `--no-gpg-sign`
- [ ] 模态弹窗交互（Q6.3）：
  - 触发 → Agent 推 SSE `permission_request` 事件
  - Web 端弹模态：approve / deny
  - 用户响应 → 工具调用继续或返回 deny 错误
- [ ] 危险工具「不可碰」清单：
  - 默认：`~/.aidevspace/` / `.git/` / `node_modules/`
  - per-req 扩展：meta.yaml 声明 `protected_paths: [...]`

## 验收

- 启动 session 后，system prompt 字符串里能看到「Platform Philosophy / Active Skills / Current Context」三段
- Skill `context:` 声明的文件被读进 prompt
- 触发 5 类任一 → Web 收到 `permission_request` 事件 → 模态弹出 → approve 后执行 / deny 后 AI 收到错误
- `git push --force` 命令被 hook 拦截
- 含 `api_key=...` 的 Write 内容被 secrets 扫描拦截

## 依赖

- [01-p0-skeleton.md](01-p0-skeleton.md)
- [Issue 08a-skill-loader-arming.md](../../ai-devspace-mvp/issues/08a-skill-loader-arming.md)（Skill loader 部分已实现）

## 估时

1 周
