---
Status: ready-for-agent
Type: ticket
Parent: ../../ai-devspace-mvp/issues/19-zone-analyzing.md
Related-ADRs: [ADR-0017]
Implements: ADR-0017 D3(AI 端部分)
Slice: 6/6(独立于 01-05 串行链,可与 02 并行启动)
Priority: P0(否则 03 联动 + 04 synthetic 端到端 demo 无法跑通)
---

# 06 — Agent 端 AI Prompt:emit chunk 时输出 source_refs

## What to build

让 Agent 端在 emit `analysis_chunk` SSE 事件 / 写 `chunks.jsonl` 时,**每个 `subproblem` / `risk` / `option` chunk 都带上 `source_refs` 字段**(narration chunk 一律不带)。覆盖 3 层:

1. **AI Skill prompt** (`~/.aidevspace/skills/admission-check/SKILL.md`,当其实装时):在 system prompt 里明确指示 AI 在 emit chunk 时输出 `source_refs`
2. **Mock 函数**(`simulateStartChunks` / `simulateInterjectChunks`):硬编码合理的 `source_refs` 让 dev 端到端 demo 跑通
3. **Agent 序列化层**(`appendChunksToJsonl` / `hub.publish`):`source_refs` 字段**必须**透传到 JSONL 和 SSE,不能丢

> **本 ticket 不做**:Skill runtime 真实接通(独立 ticket);AI 复读 synthetic chunk 过滤(独立 ticket);Admission-check SKILL.md 本身的编写(独立 ticket)。

## Blocked by

01(`SourceRef` 类型已加,JSONL 兼容读写已实装)—— 软阻塞,**可并行启动**

## Acceptance criteria

### Mock 函数更新(立即可做,无 AI 依赖)

- [ ] `apps/agent/src/routes/analysis.ts` 的 `simulateStartChunks()` 输出的 5 条 mock chunks:
  - 第 3 条(DETECT, kind: subproblem)→ `source_refs: [{kind: 'prd', lineRange: [12, 14], quote: '退款单笔金额上限 ≤ 1000 元'}]`
  - 第 4 条(RISK, kind: risk)→ `source_refs: [{kind: 'prd', lineRange: [23, 23], quote: '幂等'}, {kind: 'aux', auxId: '<mock-aux-id>', lineRange: [45, 47], quote: '现有 API 无幂等键'}]`
  - 第 5 条(OPTION, kind: option)→ `source_refs: [{kind: 'aux', auxId: '<mock-aux-sop-id>', lineRange: [8, 8], quote: '退款流程规范第 3 条'}]`
  - 第 1 / 2 条(START / READ, narration)→ **不带** `source_refs` 字段
- [ ] `simulateInterjectChunks()` 输出的 2 条 narration → **不带** `source_refs`
- [ ] mock chunks 的 `auxId` 字段值**必须**与 `req-001` fixture 中的 aux file id 一致(否则前端 `[aux-id · 🔗 2]` 显示空);若 fixture 暂未注入 aux → 用 sentinel `'mock-aux-api'` / `'mock-aux-sop'` 并在 web 端 SSR loader 注入对应 mock aux
- [ ] mock chunks 的 `lineRange` 必须**实测**与 PRD 真实内容匹配(读 `requirements/req-001/requirement.md` 验证第 12-14 行真的是"退款金额上限"相关内容);若不匹配 → 改 PRD mock 内容或调整 lineRange

### Agent 序列化层

- [ ] `appendChunksToJsonl()`:
  ```ts
  // 当前序列化(无 source_refs)
  JSON.stringify({
    id, ts, label, tone, text, kind, session_id
  })

  // 本 ticket 后
  JSON.stringify({
    id, ts, label, tone, text, kind, session_id,
    ...(chunk.source_refs ? { source_refs: chunk.source_refs } : {}),
  })
  ```
  - `source_refs` 字段**仅在存在时写入**(避免 narration 行的 JSON 膨胀;与 web 端 ticket 01 的 JSONL 兼容性约束一致)
- [ ] `hub.publish(id, ev)` SSE 事件 payload:
  ```ts
  ev.chunk.source_refs ? { ...ev.chunk, source_refs: ev.chunk.source_refs } : ev.chunk
  ```
  - SSE 客户端 `analysis_chunk` 监听器拿到的事件对象**带** `source_refs`
- [ ] mock 函数返回的内部类型扩展:
  ```ts
  chunk: {
    id, ts, label, kind, tone, text,
    source_refs?: SourceRef[],  // ← 新增
  }
  ```
- [ ] 与 web 端 `SourceRef` 类型保持**结构一致**;避免反向 import(web 端 `import type` 反向耦合 agent)→ 在 agent 端**内联定义** `SourceRef` 类型(已知与 web 端镜像;web/agent 端类型一致性靠集成测试守护)

### AI Skill Prompt(未来 Skill runtime 实装后)

> 这一段在 admission-check SKILL.md 写入时落地;**本期 ticket 不创建该文件**,但 ticket 包含 "Admission-check SKILL.md 编写 ticket" 的引用。

当 `admission-check` SKILL.md 实装时,system prompt 段必须包含:

```markdown
## emit chunk 时输出 source_refs

对每条 `kind: 'subproblem' | 'risk' | 'option'` 的 chunk,必须附带 `source_refs: SourceRef[]`,
说明你得出此结论时参考了哪些原文位置。

### SourceRef 形态(三选一 / 多选)

1. PRD 文本段:`{kind: 'prd', lineRange: [start, end], quote: '原文片段'}`
   - lineRange 是 0-based 半开区间;end 不含
   - quote 是从 PRD 该位置复制的前 30-80 字原文,用于 SSR 兜底

2. AuxFile 文本段:`{kind: 'aux', auxId: 'aux-id', lineRange: [start, end], quote: '...'}`
   - auxId 对应需求 aux 目录下的某文件

3. Asset 图片:`{kind: 'asset', assetId: 'prd-1.png'}`
   - 仅当你参考了某张解出的图片时使用

### 约束

- narration 类 chunk(START / READ / SCAN / MATCH / INFER / THINK / COMPLETE)**禁止**带 source_refs
- 至少 1 个、最多 3 个 source_ref(超过 3 个应收敛为"主结论")
- lineRange 必须实测验证(读文件 → 数行 → 确认是相关段);不要凭印象写
- quote 必须**逐字**复制(可截断到 30-80 字),不能改写
- 若实在找不到出处(综合判断),允许省略 source_refs,但 chunk.kind 必须改为 'narration'
```

- [ ] 当 admission-check SKILL.md 实装时,本 ticket 验证 ticket 创建者已 include 上述段落
- [ ] 间接验证:跑一个 E2E 脚本,用真实 LLM 替换 mock → 期望 AI 输出 JSON 含 source_refs 字段

### Agent Prompt 上下文注入(AI 看到的源文件)

- [ ] admission-check Skill 启动时,系统 prompt 注入:
  - PRD 全文(已有,通过 `requirement.md` 读出)
  - AuxFile 列表 + 每个文件的 id / filename / usage_tag
  - Asset 列表(图片名 + URL)
- [ ] AI 在 system prompt 里**看得到**所有源 + 它们的路径 + 各自的 metadata,才能正确写 source_refs
- [ ] 注入格式约定(本期**不实装**,留作 Skill runtime ticket):
  ```
  ## 源文件上下文
  
  ### PRD (id: prd)
  <requirement.md 全文,标行号>
  
  ### AuxFile: aux-api (id: aux-api-1, usage_tag: api)
  <aux/api.md 全文,标行号>
  
  ### AuxFile: aux-sop (id: aux-sop-1, usage_tag: sop)
  ...
  
  ### Asset 列表
  - prd-1.png
  - prd-2.png
  ```

### 单测

- [ ] `apps/agent/src/__tests__/routes-analysis-start.test.ts`(可能已存在)追加:
  - mock chunks 含 source_refs → JSONL 序列化字段正确
  - SSE publish payload 含 source_refs
- [ ] `apps/agent/src/__tests__/routes-analysis-interject.test.ts` 追加:
  - mock interject chunks(narration)→ JSONL **不**含 source_refs 字段
- [ ] 新增 `apps/agent/src/__tests__/analysis-source-refs.test.ts`:
  - `appendChunksToJsonl` 含 / 不含 source_refs 两种场景的字节级断言
  - `hub.publish` payload 含 / 不含 source_refs

### 集成验证

- [ ] 端到端跑通:
  1. `POST /api/requirements/req-001/analysis/start` → 返回 201
  2. 读 `requirements/req-001/analysis/sessions/<sid>/chunks.jsonl` → 5 行,3 行含 source_refs / 2 行不含
  3. SSE 订阅 `GET /api/requirement/req-001/events` → 收到 5 个 `analysis_chunk` 事件,payload 含 source_refs
  4. web 端 ANALYZING 进入 → 左栏 PRD Tab 显示"🔗 1";点右栏 issue 卡片 → 左栏切到 PRD + 高亮对应行
- [ ] `apps/agent/src/__tests__/agent-skeleton.e2e.test.ts` 追加上述断言

### 不破坏现有

- [ ] `appendChunksToJsonl` 写入的 JSONL 字段顺序不变(id, ts, label, tone, text, kind, session_id 顺序);`source_refs` 追加在末尾
- [ ] 旧 chunks.jsonl(无 source_refs 字段)加载兼容(ticket 01 web 端已实装;agent 端 `appendChunksToJsonl` 用 spread,不影响写)
- [ ] 现有 `analysis-interject` / `analysis-start` 测试**全部通过**

## 备注 / 提示

- **Mock lineRange 与 PRD 内容匹配**:写 mock 前**实测**打开 `requirements/req-001/requirement.md` 数行号,确认 `[12, 14]` 真的是 "退款单笔金额上限" 段落;若 PRD mock 改动 → 同步更新 lineRange
- **SSE 与 JSONL 双重 sink**:`source_refs` 必须同时落 JSONL + SSE;任一丢字段会导致 web 端"刷新页面后画线消失"或"SSE 推来的 chunk 不带画线";测试两端都断言
- **AI Skill prompt 模板在外部仓库**:`admission-check` SKILL.md 在用户机器的 `~/.aidevspace/skills/admission-check/SKILL.md` 而非本仓库;本 ticket **不创建**该文件,只承诺落地时 include 上述段落;具体 SKILL.md 编写立独立 ticket(见下方"关联 ticket")
- **真实 AI 测试成本**:Skill runtime 实装后,跑一次完整 admission-check 流程约消耗 5-30K tokens,CI 不建议跑;留 manual / staging 验证
- **为什么不让 web 端合成 source_refs**?(一个被拒的替代方案):web 端仅做渲染,不知道 AI 推理时的真实依据;若让 web 端合成,等价于"伪造引用",违反决策 36 (markdown 为唯一真相源)

## 关联 ticket(本 ticket 不创建,需后续独立立)

- **"Admission-check SKILL.md 编写 + 真实 Skill runtime 接通"** —— 阻塞端到端 AI demo;依赖本 ticket 段落模板
- **"AI prompt: 重扫时忽略 synthetic: true chunk"** —— 配 ADR-0017 D6;本 ticket 不涉及
- **"Agent: AuxFile + Asset 数据注入 system prompt"** —— 阻塞 AI 正确写 source_refs;依赖本 ticket 注入格式约定

## 落地后最终验收对应 ADR-0017 D3

- D3 前半(字段定义 + JSONL 兼容)✓ ticket 01
- D3 后半(AI 真实输出 source_refs)✓ 本 ticket 06 + 关联 SKILL.md ticket
- 端到端 demo(用户进 ANALYZING 看到画线)✓ ticket 03 + 04 + 06 全部完成