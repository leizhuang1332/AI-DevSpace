---
status: accepted
---

# 父子 status 互锁:TaskCard 5 态 ↔ Requirement 10 态(ADR-0025)

[ADR-0024](0024-taskcard-card-model.md) 引入了 TaskCard 5 态(backlog / todo / in_progress / in_review / done),但与现有 Requirement 10 态(draft / drafting / analyzing / clarifying / designing / planning / implementing / submitting / done / archived)的关系未定义。本 ADR 确定两套状态机的**互锁语义**:父子状态机联动 + 用户手动 override 权,既不让父 status 因子卡片集体 done 自动推进(否则失去工位/阶段条表达力),也不让父 status 完全无视子卡片状态(否则产生"看板全 done、Requirement 还卡在 clarifying"的脱节脏数据)。

## 背景与现象

### 现有 Requirement 10 态语义

参考 [ADR-0014](0014-status-soft-label-progress-derivation.md)「status 是软标签 + 由文件系统产物目录派生」,10 态的语义层级是**流程阶段**:

```
draft → drafting → analyzing → clarifying → designing
      → planning → implementing → submitting → done → archived
```

每个 status 对应一种用户意图(用户在 PRD 起草 / 跑分析 / 澄清 / 设计 / 计划 / 实现 / 提交 / 完成 / 归档)。但 status **不是状态机**(决策 15「不写状态机」)—— 字段是软标签,后端不做转换约束。

### 痛点:三套候选语义不互斥

12 轮 grilling 对父子 status 互动共提出三套候选(三套都有真实使用场景):

| 候选 | 父子行为 | 风险 |
|---|---|---|
| **a. 完全独立** | 父子各自切,互不感知 | 脱节:看板全 done,Requirement 还卡在 clarifying |
| **b. 全聚合** | Requirement.status = 派生自子卡片 status | 失去工位(6 阶段)信息;工位步骤条消失,产品功能严重退化 |
| **c. 互锁联动** | 子可独立切,但父 status 受约束;用户可手动 override(带警告) | 实现复杂;但保留工位表达力 + 防脱节 |

### 为什么选 c

- `b(全聚合)` 与既有工位 4 步骤条表达相悖 —— 当前需求详情页 Overview 概览里"工位地图"显示当前 stage(based on Requirement.status),若 status 自动聚合,stage 信息丢失
- `a(独立)` 与用户真实心智冲突 —— 用户一边推 TaskCard 到 done,一边手动切 Requirement 到 implementing,中间需要 mental hoop
- `c` 是中间路线 —— **联动是软约束**(UI 提示但允许 override),既不强迫用户接受自动派生,也不允许多数场景出错

## 决策

### D1. 两套状态机由不同物派生

| 字段 | 派生来源 | 触发 |
|---|---|---|
| `Requirement.status` | 用户主动切 or 系统"工位切换事件"(切 zone_route_segment 派生) | UI 层 |
| `TaskCard.status` | 用户在 board 拖拽 / detail 按钮 | UI 层 |

**派生不直接修改对方字段** —— 子卡片切到 done 不会自动写父 status;父 status 切到 implementing 不会自动切所有子到 in_progress。

### D2. 约束规则:父 status 进入关键 stage 前,自动校验子级

当用户将 `Requirement.status` 从旧值切到下列关键值时(任意一种),系统执行**软约束校验**:

| 父 status 目标值 | 软约束校验(可手动 override) |
|---|---|
| `implementing` | 该 Requirement 下**无 backlog 卡片**(可以容忍 in_review / done) |
| `submitting` | 该 Requirement 下**无 in_progress 卡片**(必须全部进入 in_review 或更后) |
| `done` | 该 Requirement 下**所有非 archived 卡片 status = 'done'** |

软约束:

- 当父目标值与子状态冲突时,UI 弹 Modal「父 status 需一致子状态」(图 2 详情页触发):
  - 选项 A:**「强制切换」** —— 接受 override,把父 status 写下去(子卡片不变)
  - 选项 B:**「先调整子卡片」** —— 跳转 board section 让用户手动推子卡片;父 status 不变
  - 选项 C:**「取消」** —— 不切
- 当父目标值与子状态一致时:**静默允许**,无 Modal
- 用户每次选 A(强制切换)时,系统写日志 `~/board/overrides.log`,产品层可见(便于后续 audit)

### D3. 反方向:子 status 不约束父

TaskCard.status 任何切换**不直接**改父 status。父 status 始终是用户意图驱动的软标签。

例外:**当所有非 archived TaskCard 全部 status='done' 时**(且至少有一张卡片存在),UI 在父 Requirement Overview 顶部显示一条**建议提示**「所有任务已 done,建议将 Requirement.status 切到 done」—— 但**不自动切**,只提示。

理由:子 → 父的反向自动,会让"工位"含义扁平化,与决策 15「不写状态机」冲突。

### D4. UI 表现层

**board 列面板(图 1)**:

- 5 列(backlog / todo / in_progress / in_review / done)严格按 `status` 字段值分组
- 列头部显示 N 计数,以及**该列与父 Requirement.status 的对齐信号**:
  - 「一致」:列显示无 badge
  - 「冲突」:列头显示红色 ⚠,hover 显示「该列卡片状态与父 Requirement.status 对齐要求不符,见父级详情」
- 「冲突」时点击列 → 弹出 D2 的 Modal(引导用户决定)

**Requirement Overview / 详情页**:

- 显示当前 Requirement.status(大号徽章)
- 显示「与子级状态的健康度」(若冲突:warning 三角 + N 处冲突)
- 点击健康度 → 列出冲突子卡片,可一键跳转

### D5. 数据建模

`Requirement.status`(10 态)与 `TaskCard.status`(5 态)映射表(运行时不校验,只在健康度显示时用):

| Requirement.status | 期望的子卡片状态分布 |
|---|---|
| `draft` | 不限制(全是 backlog 也 OK) |
| `drafting` | 不限制 |
| `analyzing` | 不限制 |
| `clarifying` | 不限制 |
| `designing` | 不限制 |
| `planning` | 不限制(但建议 backlog → todo 转换) |
| `implementing` | 无 backlog(可 in_progress / in_review / done) |
| `submitting` | 无 in_progress(可 in_review / done / 部分 backlog) |
| `done` | 全部子卡片 done / archived |
| `archived` | 不限制 |

### D6. archived 是另一个轴,与 status 正交

- `is_archived` 字段(D2 ADR-0024)独立于 status;归档 ≠ 完成
- archived 卡片不在 board 可见(列面板显示)
- archived 卡片不参与 D2 父 status 校验(只校验非 archived 卡片)
- 父 Requirement.status 切到 `archived` 后,所有子卡片可保留各自状态;后续若父从 archived 切回(`done` 前),子卡片状态不变

## 不在范围内

- 不自动推进父 status(子 → 父 自动写) → 留给 P1+ 若用户反映多次手工切恼人
- 不实现看板拖拽改 status(本 ADR 只定义 status 字段语义与父校验,UI 拖拽排序在 implementation 阶段)
- 不实现跨 Requirement 的子卡片共享(本 ADR 是单 Requirement 范围内)
- 不在本 ADR 内决定:board section 自己的 UI 形态 → [ADR-0027](0027-board-section-intro.md)

## 主要取舍

- **选择「软约束 + override」而不是「硬约束」**:用户心智模型里 Requirement.status 是软标签;硬约束会让用户感到"系统不让我切"。软约束 + 警告 + override log 是中间路线。
- **选择「派生不写对方字段」而不是「子 → 父自动写」**:后者会让父 status 失去工位表达力,Overview 仪表板退化为「看板进度」摘要;前者保留工位 + Override 权
- **选择「5 态独立 + 校验表」而不是「5 态冗余 10 态」**:前者只需 1 个状态机 + 1 张映射表;后者每张卡片要存完整 10 态,数据冗余
- **选择「D2 软约束 Modal」而不是「行内提示」**:行内提示在 board 5 列里难以呈现「父 → 子」的方向感;Modal 让用户清晰看到即将做的动作影响

## 关联

- 上游:
  - [ADR-0024](0024-taskcard-card-model.md) D1 TaskCard 字段集
  - [ADR-0014](0014-status-soft-label-progress-derivation.md) Requirement 10 态软标签语义
- 下游:
  - [ADR-0027](0027-board-section-intro.md) D2 列头部对齐信号 + D4 冲突 Modal
- 实现位置:
  - 校验逻辑:`apps/agent/src/services/board/StatusConstraintGuard.ts`(新增)
  - Override 日志:`apps/agent/src/services/board/OverrideLog.ts`(新增,落 `~/.aidevspace/requirements/<id>/board/overrides.log`)
  - 类型/Schema:`packages/shared/src/task-card.ts`(已有 ADR-0024 加 `TaskCardStatusSchema`)
