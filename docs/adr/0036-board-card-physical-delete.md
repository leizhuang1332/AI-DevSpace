---
status: accepted
---

# board 卡片物理删除(真删 + 输入 DELETE 二次确认 + blocker 硬拒绝)

## 背景与现象

[ADR-0027 D3](0027-board-section-intro.md) 在 board section 5 列布局中定义了「卡片菜单 `⋯` → 归档」一项动作(同 [ADR-0024 D1](0024-taskcard-card-model.md) 13 字段中的 `is_archived: boolean`),后端 `POST /api/requirement/:id/board/cards/:cardId/archive` 走 `update({is_archived:true})` 软删路径——`is_archived=true` 后 `TaskCardStore.list()` 默认过滤,文件留在磁盘作为"回收站"。

但本轮 9 轮 grilling 沉淀的产品判断是:**软删语义与用户心智不符**。用户要的是"这张卡从看板永远消失",而非"它还在,我只是看不到"。本期 9 轮决策锁定「物理删除」为唯一删除路径:

| 原描述 | 新描述 |
|---|---|
| 卡片菜单 `⋯` → 归档(软删) | 卡片菜单 `⋯` → 删除任务(物理 rm) |
| 详情页工具栏 `🗄` 归档按钮 | 详情页工具栏 → 删除入口(对称) |
| ADR-0027 D3「自动归档 N」按钮 | **本期不做,推迟 P1+**(详见 ADR-0027 联动修改) |
| `is_archived` 字段 | **保留**——后端 archive 路径(snapshot / CLI 兜底) + 父 status 互锁豁免(ADR-0025 D6)仍用 |

## 决策

### D1. 物理删除语义 = `rm -rf board/tasks/<ulid>/`

- 删除路径 = `fs.rm('~/.aidevspace/requirements/<req-id>/board/tasks/' + cardId, { recursive: true, force: true })`
- 一次删除同时清掉:`<ulid>.json`(TaskCard 主数据) + `<ulid>/transcript.yaml`(协作历史,沿用 [ADR-0028](0028-taskcard-transcript-independence.md) D1 物理独立路径)
- 文件不可恢复:决策 47「自动 snapshot 机制」只兜 AI 写入,**不**兜用户主动删除(理由见 D7「不在范围内」)
- 不引入"已归档抽屉"或"回收站"UI——`is_archived=true` 的卡通过 snapshot 30 天保留窗口可见([ADR-0009](0009-ai-failure-defense.md) 决策 47)

### D2. blocker 硬拒绝(子任务 / 被依赖)

删除前置检查两类反向引用,**命中即 409 拒绝**:

| blocker 类型 | 检查方法 |
|---|---|
| **子任务** | `cards.filter(c => c.parent_id === cardId && !c.is_archived).length > 0` |
| **被依赖** | `cards.filter(c => c.depends_on.includes(cardId) && !c.is_archived).length > 0` |

后端 409 响应体:

```typescript
{
  error: 'E_CARD_HAS_BLOCKERS',
  blockers: {
    subtasks: Array<{ id: string; title: string }>,      // 该卡片的非 archived 子卡
    dependents: Array<{ id: string; title: string }>,    // depends_on 引用该卡的非 archived 卡
  }
}
```

- 后端沿用 [ADR-0025](0025-parent-child-status-lock.md) `StatusConstraintGuard.filterIsArchived` 的过滤语义——archived 卡不计入 blocker
- 前端接收 409 后弹 `BlockerModal` 显示 blocker 数量 + 「前往处理」链接(跳到子任务详情 / 依赖方列表)
- 不做级联删除、不可静默跳过

### D3. 二次确认 = 输入 `DELETE` 字样(Linear / GitHub 范式)

不可逆操作的"门槛"由 Modal 的输入框承担:

- 标题:**「永久删除任务?」**
- 警告区(图标 + 红字):「此操作不可恢复。任务本身(`<id 短哈希>`) + 协作 transcript 将被一起删除。」
- 输入框:placeholder = `输入 DELETE 确认`;未输入 → 确认按钮 `disabled`;输入其他 → 红框 + 错误文案;输入 `DELETE`(区分大小写)→ 确认按钮可点
- 取消路径:点 ✕ / 按 Esc / 点背景 → 全部关闭(与 [ADR-0022](0022-analyzing-history-floating-action-button.md) D4.1 决策 94 沿用「四种都关」)

理由:与决策 46「AI 翻车防线」D1「5 类高危操作默认阻止」的产品期望一致;Linear 删除工作区、GitHub 删除仓库、Claude.ai 删除 project 均用此范式。

### D4. UI 反馈 = Toast 无撤销(3s 静态)

- 看板那张卡:成功后 200ms 淡出(沿用 [ADR-0035](0035-board-drag-sort.md) D4 v2 拖拽 ghost 时长);**不**走后端 undo buffer
- Toast 顶部出现 3s,文案 `「已删除 <id 短哈希>」`,**不**提供「撤销」按钮(避免误导:不可恢复)
- 详情页删除后: `router.push('/requirements/<id>/board/')` 回看板
- 后端不走 SSE 推送删除事件——单卡操作,前端 React Query mutation 已能驱动重渲染

理由:语义最干净。"不可恢复"承诺不在 UI 上打折——不会出现「撤销按钮按了不真恢复」的安抚陷阱。

### D5. 删除 = 等同 archived(沿用 ADR-0025 D6)

删除一张子 `TaskCard` 不触发父 `Requirement` / 父 `TaskCard` 的 status 反向阻止:

- 理由 1:`TaskCardStore.delete()` 后文件不存在,`TaskCardStore.list()` 自然不返回——`computeParentProgress` 等派生计算**本来**就只看未删除的卡
- 理由 2:[ADR-0025 D6](0025-parent-child-status-lock.md) 已锁定「archived 不参与父 status 校验」;物理删除等于"更强的 archived",逻辑沿用
- ADR-0025 / ADR-0024 不动;`is_archived` 字段保留(后端 archive 路径仍可用)

### D6. 联动修改 ADR-0027 D3 「自动归档 N」按钮 → 本期不做

| ADR-0027 D3 原描述 | 联动后描述 |
|---|---|
| 看板顶部 toolbar 右:`自动归档 N` 按钮(批量把 status='done' && 完成 > 7 天 的卡片设 `is_archived = true`) | 看板顶部 toolbar 右:**无批量操作按钮**(批量清理本期不做,见 ADR-0036 D7) |

`is_archived=true` 软删路径**后端保留**(供 snapshot 兜底 / CLI 工具调用),仅 UI 不再有"自动归档"入口。`.scratch/board-section/PRD.md` 第 45 条「自动归档 N 预留 UI」对应打勾,标记「本期不做」。

### D7. API 契约

```
DELETE /api/requirement/:id/board/cards/:cardId
  200 OK                  → 删除成功
  404 Not Found           → { error: 'E_CARD_NOT_FOUND' }
  409 Conflict            → { error: 'E_CARD_HAS_BLOCKERS', blockers: {...} }
  500 Internal            → 文件系统错误(权限 / 磁盘满等)
```

- 复用现有 `E_CARD_NOT_FOUND`(沿用 board-cards route 已有错误码空间)
- 新错误码 `E_CARD_HAS_BLOCKERS`(在 agent `error-codes.ts` 注册)
- 并发保护:沿用 [ADR-0030](0030-repo-registry-and-per-requirement-clause.md) 决策 106 的"per-requirement mutex"模式——`TaskCardStore.delete()` 走 `withRequirementLock(reqId, fn)`

### D8. 数据 / UI 改动清单

#### 后端 `apps/agent`

| 文件 | 改动 |
|---|---|
| `services/board/TaskCardStore.ts` | + `delete(reqId, cardId): Promise<void>`: 检查 blocker → `fs.rm(..., { recursive: true, force: true })`;走 `withRequirementLock` |
| `services/board/StatusConstraintGuard.ts` | + `getBlockers(reqId, cardId): { subtasks, dependents }`:纯函数,被 delete 调用 + 后续可能的"批量"路径复用 |
| `routes/board-cards.ts` | + `DELETE /:cardId` route:调 `store.delete()`;409 / 404 / 500 错误体按 D7 契约 |
| `error-codes.ts` | + `E_CARD_HAS_BLOCKERS`(已在 D7 给出) |
| `__tests__/board/board-cards-route.test.ts` | + DELETE 4 case:200 / 404 / 409 + blocker 体 / 重删幂等 |

#### 前端 `apps/web`

| 文件 | 改动 |
|---|---|
| `components/board/Card.tsx` | 菜单项「归档」 → 「删除任务」;`data-testid="board-card-menu-archive"` → `board-card-menu-delete`;`onArchive` prop → `onDelete` |
| `components/board/BoardSection.tsx` | `useArchiveBoardCard` → `useDeleteBoardCard`;`onArchive` → `onDelete`;`onDelete(cardId)` 触发 → 弹 `ConfirmDeleteDialog` |
| `components/board/detail/CardDetail.tsx` | `🗄` 按钮 → 「删除任务」按钮(对称 Card.tsx 菜单);`onArchive` → `onDelete` |
| `components/board/detail/BoardCardDetailPage.tsx` | `useArchiveBoardCard` → `useDeleteBoardCard`;`onArchive` → `onDelete` |
| `components/board/delete/ConfirmDeleteDialog.tsx` | **新建**——D3 二次确认 Modal(输入 DELETE 字样) |
| `components/board/delete/BlockerModal.tsx` | **新建**——D2 blocker 列表展示 + 「前往处理」跳转 |
| `lib/board-hooks.ts` | `useArchiveBoardCard` → `useDeleteBoardCard`(mutation 路径改 `DELETE /cards/:cardId`);**保留** `useArchiveBoardCard`(后端端点仍在,仅 UI 不调) |

#### 领域文档

| 文件 | 改动 |
|---|---|
| `docs/adr/0027-board-section-intro.md` | D3 联动修改(见 D6 表);「不在范围内」段补「批量自动清理 → 本期不做,见 ADR-0036」 |
| `CONTEXT.md` | v1.0.10 增量段;术语表增「删除任务 = 物理 rm」定义 |

#### 不修改(明确)

- `packages/shared/src/task-card.ts`:`is_archived` 字段保留;schema 不动
- `packages/shared/src/board-card.ts`:`is_archived: z.boolean().optional()` 保留
- `apps/agent/src/services/board/TaskCardStore.ts` 的 `archive()` 方法保留(后端软删兜底)

## 不在范围内

- **批量真删**(多选 + 一次删除 N 张)→ 留 P1+;用户心智"批量 = 高频场景"未确认,等出现真实诉求再做
- **撤销 / undo buffer**(后端临时区 + 8s TTL)→ 语义冲突("不可恢复"承诺不让 UI 打折);决策 47 snapshot 仅兜 AI 写入,本期不扩展到用户操作
- **自动清理**(系统自动 batch 删 done > 7 天)→ 决策 24「克制,在场」红线之一"跨项目推送"反对;批量 × 自动 × 不可逆 三件套不友好,本期不做
- **"已归档抽屉" UI**(`is_archived=true` 的卡有独立列表页)→ C 解读已在 grilling 中明确拒绝(理由:本期 UI 唯一入口是"真删",软删走 snapshot / CLI);若未来 `is_archived` 的卡数量变多再考虑
- **`is_archived` 字段移除**→ 不做。后端 archive 路径 + ADR-0025 D6 父子互锁豁免仍依赖此字段
- **删除事件 SSE 推送**→ 单卡操作 React Query mutation 已足够,无需推送

## 主要取舍

- **选择「物理删除」而不是「软删升级版」**:用户语义"删了就是删了"远比"先软后硬"清晰;代价是失去"误删容错",用二次确认(输入 DELETE)+ blocker 硬拒绝弥补
- **选择「输入 DELETE 字样」而不是「checkbox + 按钮」**:决策 46 D1「5 类高危操作默认阻止」的产品期望;Linear / GitHub 范式一致性
- **选择「Toast 无撤销」而不是「后端 undo buffer」**:语义"不可恢复"不让 UI 打折;后端复杂度 +1 不值得;若用户删错,snapshot 30 天内可手工 `mv` 回来(走文档,不走 UI)
- **选择「联动修改 ADR-0027 D3」而不是「新立 ADR 单独承载」**:批量归档与单卡真删同属"删除语义"决策族,放一起更内聚;同时不让 ADR-0036 冗余定义"为什么 UI 不再有归档入口"
- **选择「保留后端 archive 路径」而不是「一并废弃」**:snapshot / CLI / 调试工具仍可调用;`is_archived` 字段在 ADR-0025 D6 仍有不可替代作用(archived 卡豁免父 status 校验);一刀切会带来连锁 ADR 改动

## 关联

- **上游**:
  - [ADR-0024](0024-taskcard-card-model.md) D1 / D5:TaskCard 字段集 + `is_archived` 语义
  - [ADR-0025](0025-parent-child-status-lock.md) D2 / D6:父子 status 互锁 + archived 豁免(本期删除沿用)
  - [ADR-0027](0027-board-section-intro.md) D3 / D5:board section 5 列 + 详情页结构(本期联动修改 D3 自动归档按钮)
  - [ADR-0028](0028-taskcard-transcript-independence.md) D1:transcript 物理独立路径(本期删除同步清 transcript)
  - [ADR-0035](0035-board-drag-sort.md) D4 v2 / D6:卡片样式 + ghost 时长(本期沿用)
  - 决策 46(AI 翻车防线) / 决策 47(自动 snapshot) / 决策 100(父子互锁软约束 + override)
- **下游**(本期不立,留 P1+):
  - 批量真删 API + multi-select UI
  - 后端 undo buffer
- **实现位置**:
  - 后端:`apps/agent/src/services/board/TaskCardStore.ts` (`delete()` 方法) + `apps/agent/src/routes/board-cards.ts` (DELETE route)
  - 前端:`apps/web/src/components/board/{Card,BoardSection}.tsx` + `apps/web/src/components/board/detail/{CardDetail,BoardCardDetailPage}.tsx` + `apps/web/src/components/board/delete/{ConfirmDeleteDialog,BlockerModal}.tsx`
  - 领域文档:`CONTEXT.md`(v1.0.10 增量) + 本 ADR