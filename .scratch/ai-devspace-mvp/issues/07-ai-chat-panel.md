---
Status: ready-for-agent
Type: task
Stage: 2
---

# 07 - AI 对话面板（Claude Code SDK 集成 + 流式回传）

## 目标

落地 ADR-0004：通过 Claude Code SDK subprocess 跑 AI，对话流式回传到 Web。

## 范围

- [ ] Agent 端 `ClaudeCodeProvider`：
  - 抽象接口 `AIProvider`（`run(prompt, contextFiles): AsyncIterable<Chunk>`）
  - ClaudeCodeProvider 实现：`@anthropic-ai/claude-agent-sdk` SDK 调用
  - subprocess 池管理：每需求一个长连接，切换不重启
  - 流式 chunk 类型：`{type: 'text' | 'tool_call' | 'tool_result' | 'file_change' | 'done', ...}`
- [ ] Agent 端 `ConversationService`：
  - `runSkill(requirementId, skillName)`：加载 Skill 提示词 + 注入上下文 + 启动 SDK
  - 对话增量写入 `conversations/<seq>-<stage>.md`（落盘）
- [ ] Web 端对话面板（PRD §5.3）：
  - 消息气泡（user / assistant / tool_call / tool_result）
  - 工具调用可视化（折叠展开，展示命令、文件路径、diff）
  - 输入框 + `@` 引用自动补全（@file, @repo, @knowledge, @skill, @task）
  - WS 客户端（断线重连 + 消息重发）
- [ ] 上下文压缩：阶段切换时自动跑"摘要"任务，落 `*/99-summary.md`

## 验收

- 输入一句话能调通 Claude Code SDK
- AI 输出（包括工具调用）能流式回传到 Web
- 对话历史关闭 Web 再打开能恢复（从 `conversations/*.md` 读）
- @file 能正确注入文件内容到上下文

## 依赖

- [03-agent-skeleton.md](03-agent-skeleton.md)
- [05-requirement-crud.md](05-requirement-crud.md)
- [08-builtin-skills.md](08-builtin-skills.md)
