# board 拖拽重排 · 决策账本

> 本文档记录 ADR-0035 实施前的 7 条 grill-with-docs 共识。
> ADR-0035 是 SSoT,本文是「为什么这样决定」的来龙去脉账本。

## 决策 1:拖拽范围(2026-08-16)

**问题**:拖拽功能本期范围 = 什么?

**选项**:
- (a) 仅跨列拖(改 status;列内按 updated_at desc 保持现有顺序)
- (b) 跨列 + 列内重排(改 status + order_index;列内按 order_index asc, updated_at desc)
- (c) 跨列 + 跨列拖到具体位置(同列重排 + 跨列重排 + drag preview 跨列精确插入线)

**共识**:**(b) 跨列 + 列内重排**。

**理由**:字段早就在 schema 待命(`order_index` default null),接进来代码改动小;列内按 `updated_at` vs 按 `order_index`,拖一次后立即可见差异,无用户教育成本;(c) 排期上等同(b)增量加,本期不必一次到位。

## 决策 2:order_index 算法(2026-08-16)

**问题**:`order_index` 取值方法?

**选项**:
- (a) 浮点中位法(Trello 风格):前后卡中点;精度耗尽 < 1e-6 触发批量重排
- (b) 整数连续编号(Jira 风格):新卡 = max+1;插入中间 = 整列重排
- (c) 字符串字典序(Linear LexoRank):字符比大小
- (d) 单调时间戳:`order_index = Date.now()`

**共识**:**(a) 浮点中位法**。

**理由**:拖拽是低频操作,精度耗尽需要 50+ 次拖进同一缝隙才会触发,实际罕见;写入 = 一次 PATCH 单卡,前端不用算「要重排哪几张」;JS Number 精度瓶颈可处理(精度耗尽重排);(b) 的 O(N) IO 放大 + 半分之写难做;(c) 字符串理解门槛高。

## 决策 3:拖拽库(2026-08-16)

**问题**:用哪个拖拽库?

**选项**:
- (a) Native HTML5
- (b) @dnd-kit/core + @dnd-kit/sortable
- (c) react-dnd
- (d) framer-motion Reorder

**共识**:**(b) @dnd-kit/core + @dnd-kit/sortable + @dnd-kit/utilities**。

**理由**:Linear / Notion / Atlassian 内部都在用;Apache 2.0;a11y 一等公民(键盘拖移 + aria-roledescription);touch 自带;Sortable + Multi-container 直拼 5 列跨列;(a) 触摸差、a11y 需手写;(c) 社区在迁出;(d) 跨列弱 + 250 KB 包体违 Linear 紧凑。

## 决策 4:触发器(2026-08-16)

**问题**:拖拽触发器 = 哪一类?

**选项**:
- (a) 整张卡片可拖(无手柄,卡整体 draggable;移动阈值 5px,否则认点击)
- (b) 左侧 hover 才显手柄(`⋮⋮` 6 点 sprite,默认 opacity:0,group-hover:opacity:1)
- (c) 左侧始终显示手柄
- (d) 整张可拖 + 始终显左侧手柄(双信号)

**共识**:**(b) 左侧 hover 才显手柄**。

**理由**:决策 17「Linear 风格」 + 决策 24「克制,在场」是硬约束;点击进详情 = 决策 102 核心 UX,优先级高于拖拽;hover 才显 = 0 视觉噪声;Linear / Jira / 飞书任务全部默认这个,用户零成本。

## 决策 5:落盘策略(2026-08-16)

**问题**:乐观 / 悲观 / 分级?

**选项**:
- (a) 纯乐观(跨列拖也乐观 → 失败回滚 + Toast)
- (b) 纯悲观(等所有服务端回包 + saving spinner)
- (c) 分级:跨列拖悲观(等 Guard);列内重排乐观
- (d) 乐观 + 失败弹 Modal(冲突 + 落盘失败都 Modal)

**共识**:**(c) 分级**。

**理由**:跨列拖 = 改 status = 走 Guard = 可能冲突 → 欺骗用户「已成功」是 UX 反模式;列内重排 = 改 order_index = 不走 Guard = 失败 ≤ 磁盘满,概率极低,乐观无成本;现有数据流允许 split:useUpdateStatus(走 Guard) + usePatchCard(普通 PATCH)两套 hook,无需重构。

## 决策 6:父子互锁冲突 UI(2026-08-16)

**问题**:跨列拖命中冲突时,UI 反馈?

**选项**:
- (a) 弹 StatusConstraintModal(沿用 detail 页三选项 A/B/C)
- (b) 拖拽中目标列标红 + 简化二选 Modal(override / 取消)
- (c) 拖拽中目标列标红 + 自动回滚 + toast
- (d) 拖拽中始终预提示 + 自动 override + toast

**共识**:**(a) 复用 StatusConstraintModal**。

**理由**:决策 100(ADR-0025 D2)锁定 v1.0.6,P1+ 不能反悔;StatusConstraintModal 已实现,代码复用 = 决策 36「单一真相源」;决策 24「克制,在场」= 拖拽中预提示视觉脏;视觉一致 = 详情页 + 看板拖,用户认知一致。

## 决策 7:详情页 order_index 展示(2026-08-16)

**问题**:详情页是否展示 order_index?

**选项**:
- (a) 详情页不展示(看板专属)
- (b) 详情页只读展示「列内位置 #N / M」
- (c) 详情页可手动改 order_index

**共识**:**(b) 只读展示「列内位置 #N / M」**。

**理由**:ADR-0024 D1 字段表 13 字段已锁定,(a) 失约;只读 = 不破坏「看板是拖拽唯一入口」心智;浮点中位值对用户无意义,格式化「列内位置 #N / M」友好;Linear / 飞书任务详情页都只读展示。
