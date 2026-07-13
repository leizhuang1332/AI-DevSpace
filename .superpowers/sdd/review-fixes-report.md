# P4 Broad Review Fixes Report

> Branch: `worktree-p4-error-handling`
> Date: 2026-07-13
> Scope: 5 review findings (C3, C1, maxPreviewChars, C4, envelopeRecoverable dead code)

## 修复概览

| # | 修复点 | 文件 | RED→GREEN |
|---|--------|------|-----------|
| C3 | markOutput/canRetry 在 resume 时不再依赖 `#sdkSessionId` | `apps/agent/src/session/AISession.ts` | ✓ |
| C1 | toEnvelope api_retry: business 4xx 转 error envelope | `apps/agent/src/providers/ClaudeCodeProvider.ts` | ✓ |
| maxPreview | DEFAULT_MAX_PREVIEW_CHARS: 500 → 2000 | `apps/agent/src/log/SessionLogger.ts` | n/a (配置常量) |
| C4 | retrying variant retry/maxRetries/delayMs → `number \| null` | 3 文件 + envelope 构造点 | ✓ |
| dead code | 删除 envelopeRecoverable 派生;显式 `recoverable: false` | `apps/agent/src/session/AISession.ts` | ✓ (拆测试断言) |

## 修复详细

### C3 — markOutput/canRetry 修复(RED→GREEN)

**RED 测试** —— `apps/agent/src/__tests__/AISession.test.ts:375-401`
```
initialSdkSessionId: 'sdk-old'
adapter: yield { kind: 'partial_assistant', delta: 'partial...' }
       then throw { status: 429, message: 'slow down' }
assert: calls === 1  // 不应 retry
```

**修复** —— `apps/agent/src/session/AISession.ts:380-384`
```ts
onText: (chunk) => { outputText += chunk },
// C3:只要 emit 过 text 就置 true —— resume 续上下文时若已发出 partial output,
// 后续 transient 错误也必须拒绝 retry(避免用户看到 partial 后又突然整体重发)。
markOutput: () => { sawOutputWithoutResume = true },
```

`canRetry` (同文件 386-390) 不变:依旧检查 `sawOutputWithoutResume`,但现在只要 text emit 过就置 true。

**RED→GREEN**:
- RED: `expected 4 to be 1`(retry 4 次)→ FAIL
- GREEN: 23 passed (含新 C3)→ PASS

### C1 — api_retry business 4xx 改为 error envelope(RED→GREEN)

**RED 测试** —— `apps/agent/src/__tests__/ClaudeCodeProvider.test.ts:184-228`
```
yield { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3,
        retry_delay_ms: 1000, error_status: 401, error: 'authentication_failed' }
assert: retries.length === 0  // 不应作为 retrying 透传
assert: capture.calls === 1   // Provider 不应被多次调用
```

**修复** —— `apps/agent/src/providers/ClaudeCodeProvider.ts:111-152`

判定流程:
1. error_status 非 number → D
2. error_status >= 500 → A
3. error_status === 408 || === 429 → A (transient)
4. 其它 4xx + business code (`authentication_failed` / `permission_denied` / `billing_error` / `invalid_request` / `model_not_found` + BUSINESS_CODES) → **转 error envelope**(不再 retrying)
5. 其它 4xx 非 business → D

business 4xx 转 error envelope 后,AISession 的 ErrorClassifier 会把它归 B → queryFailed 终态。

**RED→GREEN**:
- RED: `expected [ ... ] to have a length of +0 but got 1` → FAIL
- GREEN: 9 passed (含 C1)→ PASS

### maxPreviewChars — DEFAULT 2000(spec §3.4)

**修复** —— `apps/agent/src/log/SessionLogger.ts:54` (默认常量) + `apps/agent/src/log/SessionLogger.ts:48` (注释)
```ts
const DEFAULT_MAX_PREVIEW_CHARS = 2000
```
`summarize` / `truncate` 逻辑保持不变。`SessionLogger.test.ts` 显式 `maxPreviewChars: 12` 注入,不破坏。无需 RED→GREEN。

### C4 — retrying variant 字段可空(RED→GREEN)

**类型变更**:
- `apps/agent/src/providers/AIEvent.ts:23-31` `retrying` variant: `retry/maxRetries/delayMs: number` → `number | null`
- `apps/agent/src/session/AISession.ts:81-91` `SdkMessageEnvelope.retrying`: 同上
- `packages/shared/src/sse.ts:114-126` SSE `retrying` variant: 同上

**构造点** —— `apps/agent/src/providers/ClaudeCodeProvider.ts:149-153`
```ts
// C4:SDK 未提供 attempt/max_retries/retry_delay_ms 时为 null(spec 透明),不再补 1/3/0
return {
  kind: 'retrying',
  sessionId,
  category,
  retry: numberOrNull(m['attempt']),
  maxRetries: numberOrNull(m['max_retries']),
  delayMs: numberOrNull(m['retry_delay_ms']),
}
```

**RED 测试** —— `apps/agent/src/__tests__/ClaudeCodeProvider.test.ts:230-269`
```
yield api_retry fixture 仅给 attempt:1,error_status:503
assert: retry=1, maxRetries=null, delayMs=null
```

**RED→GREEN**: 9 passed (含 C4)→ PASS

### envelopeRecoverable 死代码清理

**删除** —— `apps/agent/src/session/AISession.ts:430-436`
```ts
// 旧(删)
const envelopeRecoverable =
  failure.classification.original && typeof failure.classification.original === 'object'
    ? (failure.classification.original as { recoverable?: boolean }).recoverable
    : undefined
```

**显式赋值** —— 同文件 `:466-470` + `mapSdkEnvelope` `:615-623`
```ts
this.#push({
  type: 'error',
  code: finalError.code,
  message: finalError.message,
  // envelope 错误是 deterministic 终态 —— recoverable 显式 false,不再透传 SDK 的标记
  recoverable: false,
  category: finalError.category,
})
```

**测试断言更新** —— `apps/agent/src/__tests__/AISession.test.ts:144-167`
旧测试期望 `recoverable: true`(从 envelope 透传),改为期望 `recoverable: false`(符合新契约)。

## 验证命令

| 命令 | 结果 |
|------|------|
| `pnpm --filter @ai-devspace/agent test` | 364 passed, 9 skipped (Windows POSIX), 0 failed |
| `pnpm --filter @ai-devspace/shared test` | 69 passed, 0 failed |
| `pnpm --filter @ai-devspace/agent typecheck` | clean |
| `pnpm --filter @ai-devspace/shared typecheck` | clean |
| `pnpm --filter @ai-devspace/agent lint` | clean (max-warnings 0) |
| `git diff --check` | clean (no whitespace issues) |

## 关键 file:line 引用

- C3 修复: `apps/agent/src/session/AISession.ts:381-384`
- C3 测试: `apps/agent/src/__tests__/AISession.test.ts:375-401`
- C1 修复: `apps/agent/src/providers/ClaudeCodeProvider.ts:111-154`
- C1 测试: `apps/agent/src/__tests__/ClaudeCodeProvider.test.ts:184-228`
- maxPreview: `apps/agent/src/log/SessionLogger.ts:48,54`
- C4 修复: `apps/agent/src/providers/ClaudeCodeProvider.ts:149-153`
- C4 类型: `apps/agent/src/providers/AIEvent.ts:23-31`, `apps/agent/src/session/AISession.ts:81-91`, `packages/shared/src/sse.ts:114-126`
- C4 测试: `apps/agent/src/__tests__/ClaudeCodeProvider.test.ts:230-269`
- 死代码删除: `apps/agent/src/session/AISession.ts:430-435` (删除段), `:466-470` (显式 false), `:615-622` (mapSdkEnvelope 显式 false)
- 测试断言更新: `apps/agent/src/__tests__/AISession.test.ts:144-167`

## 剩余 concerns

1. **C1 决策范围**: 仅 business-class codes + 4xx 转 error envelope。如果 SDK 之后扩展 BUSINESS_CODES 集合,这里需要同步扩展。当前 BUSINESS_API_RETRY_CODES 在 Provider 内本地声明,与 ErrorClassifier 的 BUSINESS_CODES 部分重叠但不完全一致(后者还含 `agent_abandoned` / `agent_gave_up` 等),可考虑后续提取共享常量。
2. **C4 UI 兼容性**: SSE `retrying` variant 字段从 `number` 变 `number | null`,web 端需要兼容 null 显示(目前 SsePayload 类型已声明 `number | null`,运行时若不处理可能 NaN)。spec 仅要求类型透明,web 渲染待 P4 后续处理。
3. **dead code 测试改动**: `maps error envelope` 测试从期望 `recoverable: true` 改为 `false`。若后续产品决定 recoverable 应可从 envelope 透传,需要重新引入 envelopeRecoverable 派生逻辑 + 恢复该断言。
4. **未跑 next build**: 按 CLAUDE.md「Next.js dev ↔ build 隔离」约定,只跑 typecheck + tests,build 留给 PR 阶段。dev server 不在本 worktree 运行。
5. **web 包未触碰**: 按约束不动 `apps/web`。Web 端如果消费 SseEvent.retrying 字段,需要单独 review。

## commit

```
fix(agent): address P4 broad review findings (C3/C1/maxPreview/C4/dead code)
```
