---
Status: ready-for-agent
Type: task
Stage: 3
Feature: new-requirement-modal
---

# 06 — Web 端 NewRequirementModal 调通 POST /api/requirements

**What to build:**

ticket 05 e2e 验证发现的关键 gap:web 端 `NewRequirementModal` 提交时仍用 `Date.now()` 生成 mock id(`req-NNN-<slug>`),未真正调用 ticket 04 实现的 `POST /api/requirements` 后端契约。

**影响**:决策 11 I 方案"弹窗不阻塞 + id 由后端生成 + meta.yaml 真实落盘"未端到端打通;前端 mock id 不会落盘 → DRAFTING 骨架屏完成后无法找到对应 requirement 文件,会显示红色 banner(E6 路径)。

**Blocked by:** None — ticket 04 后端已就绪(`apps/agent/src/routes/requirement.ts:87` + `RequirementService.createRequirement`)。

**Status:** ready-for-human(代码已落地,29 tests passing;浏览器端到端验证由人类完成)

- [x] `apps/web/src/components/new-requirement-modal.tsx` `submit` 改为先 `await createRequirement({ title })` → 拿 `id` → close + router.push(`/requirements/<id>/drafting/`)
- [x] 鉴权:自动带 `X-AIDevSpace-Token`(由 agent-client 现有 `agentFetch` 处理,无需额外配置)
- [x] 错误处理映射:
  - `400 E_INVALID_TITLE` → 弹窗不关,inline 红字提示(决策 E9 风格)「标题不合法」
  - `401 E_AUTH` → 弹窗关,跳设置页(决策 34)`/settings/?section=agent`
  - `500 E_ID_COLLISION` → 弹窗不关,「编号冲突,请稍后重试」
  - `507 E_DISK_FULL` → 弹窗不关,「磁盘空间不足,请清理后重试」(由 humanizeError 集中映射)
  - 网络错 → 弹窗不关,inline 红字 + 原 message 显示
- [x] 取消语义保留:用户点 ✕ / Esc / 取消 → 不调 API → 弹窗关 → 无副作用(决策 E10)
- [x] loading 态:点击 `[✓ 创建]` 后按钮立即 `disabled` + 文本变"创建中…";✕ / 取消 / backdrop 也都 disabled(防止提交中误关)
- [x] 不再 mock id:完全移除 `Date.now()` 路径,所有 id 走后端
- [x] 测试(29 个,新增 7 个):
  - mock createRequirement 成功路径 → 拿 id → close + push
  - mock createRequirement 400 → 弹窗不关 + 错误显示
  - mock createRequirement 401 → 跳设置页
  - mock createRequirement 500 → 红色提示 + 重试按钮
  - 取消 / Esc → 不发请求
  - 提交中:按钮 disabled + 文本「创建中…」+ 阻止 backdrop 关闭
  - 错误显示后继续修改 input → 错误自动清掉
- [ ] e2e:本地起 agent + web,⌘N → 输入 → 提交 → 验 `~/.aidevspace/requirements/<id>/meta.yaml` 已落盘(需人类手工验证)

## 决策依据

- 决策 11 I 方案:弹窗不阻塞,但需要后端立刻接管(否则元信息不一致)
- 决策 31:SSE 推送创建成功 / 失败事件,web 端 DRAFTING 工位订阅(详见 `requirementEventsRoute.ts`)
- 决策 34:X-AIDevSpace-Token 鉴权

## 三件套

- PRD: [.scratch/new-requirement-modal/PRD.md §7 提交后行为](../PRD.md)
- SPEC: [.scratch/new-requirement-modal/UI-POLISH-SPEC.md §11](../../UI-POLISH-SPEC.md)
- HTML: [docs/design/pages/01-new-requirement-modal.html §3-§4](../../../../docs/design/pages/01-new-requirement-modal.html)
- 后端契约: [apps/agent/src/routes/requirement.ts](../../../../apps/agent/src/routes/requirement.ts)
