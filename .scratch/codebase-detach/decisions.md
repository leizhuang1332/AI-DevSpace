# Codebase Detach · 决策账本

> 本文档记录 ADR-0034 实施前的 10 条 grill-with-docs 共识。
> ADR-0034 是 SSoT,本文是「为什么这样决定」的来龙去脉账本。

## 决策 1:删除范围(2026-08-16)

**问题**:删除范围到底多大?仅 rm 目录?还是也清 meta.yaml 引用 / repos.yaml 全局条目 / UI selectedRepoNames?

**选项**:
- (a) 仅 rm 目录 → meta.yaml 还引用旧 codebasePath、branchName 字段、selectedRepoNames 全部留下脏数据
- (b) (a) + 清 meta.yaml 里该 repo 的字段 → 没有悬空引用
- (c) (b) + 联动清 KB / 向量索引 → 范围过大
- (d) (b) + repos.yaml 全局条目 → 错杀(其他 req 可能用同一个 repo)

**共识**:**(b) + 顺手清 `.pending-<repoName>` 标记**(已在 `CodebaseManager.remove` 内)。

**关键修正**:调研发现 `meta.yaml` 里**没有任何 per-repo 字段**(只有 per-requirement 的 `branchName`,所有 repo 共享),所以 Q1 (b) 实际 = 仅 rm 目录 + (N=1→0 时清 branchName)。

## 决策 2:状态门禁(2026-08-16)

**问题**:哪些状态下允许点 ✕?

**选项**:
- (a) 仅 DRAFTING → API 校验 `status === 'drafting'`
- (b) DRAFTING + ANALYZING → 都允许,但 ANALYZING 时校验「没在跑这个 repo 的分析任务」
- (c) 任意状态都允许

**共识**:**(a) 仅 DRAFTING**。

**理由**:UI 现在的 ✕ 只在 DRAFTING 暴露,API 跟着收紧是单一真相源;ANALYZING 期间 codebase 正在被分析任务读,真要 detach 应走「停止分析 → 再 detach」明确流程,不该静默切库。

## 决策 3:二次确认(2026-08-16)

**问题**:✕ 点了就立刻 rm 目录,还是先弹确认?

**选项**:
- (a) 即时删除(无确认)→ 保持旧 UX,误点即数据丢失
- (b) 弹确认框 → 数据丢失前最后一道闸
- (c) 智能确认 → 探 git status,干净就即时删,脏就弹确认
- (d) 软删除 + 撤销 toast → 实现复杂,大 codebase 不现实

**共识**:**(b) 弹确认框**。

**关键修正**:原 repo-bar.tsx:39 注释「× 一键取消关联 ... 可逆(重新 attach 即可)」—— 加 rm 后**不再可逆**(重 attach = 重 clone)。沿用旧 UX 等于把数据丢失风险悄悄塞进产品,确认文案写「未推送到远端的本地改动将丢失」给最后一道闸。

## 决策 4:联动清理 branchName(2026-08-16)

**问题**:N=1→0 时 `meta.yaml::branchName` 怎么办?

**选项**:
- (a) 永远不动 → 留脏数据
- (b) 仅当 N 从 1 → 0 时清掉 → meta.yaml 干净
- (c) 永远清掉 → 错杀(多 repo 时影响其他 chip 显示)

**共识**:**(b) 仅当 N 从 1 → 0 时清**。

**理由**:meta.yaml 可读性 + 「已 attach repo 数」与 `branchName` 共生;派生判断走 `RequirementService.deriveRepos(reqDir)` 已有逻辑,不引入新扫描;race 防护走 `CodebaseManager.remove` 已有进程内 mutex。

## 决策 5:并发保护(2026-08-16)

**问题**:detach 时要不要加锁?

**选项**:
- (a) 不加锁 → 靠 safeRm 重试 + fs 原生原子性
- (b) Per-requirement mutex → RequirementService 内新增 `requirementLock: Map<reqId, Promise>`
- (c) Per-(reqId, repoName) 锁 → 更细粒度
- (d) 仅状态再校验 → TOCTOU 窗口仍存在

**共识**:**(b) Per-requirement mutex**。

**关键洞察(Plan agent §7.1)**:detach + attach 同 req 并发会引发 fs 状态机错位。锁必须覆盖 `attachRepo` / `attachRepos` / `detachRepo` 三个入口(都改 `requirements/<reqId>/codebase/` 与 meta.yaml)。**实现细节**:`attachRepos` 内部循环调用 `_attachRepoInner`(无锁),公共 `attachRepo` 才包锁,避免双重 acquire 死锁。

## 决策 6:端点形态(2026-08-16)

**问题**:HTTP 端点长什么样?

**选项**:
- (a) `DELETE /api/requirement/:id/repos/:name` → 与 `DELETE /api/repos/:name` 同构
- (b) `POST /api/requirement/:id/detach-repo` body `{repoName}` → RPC 风格
- (c) `POST /api/requirement/:id/repos/detach` body `{repoName}` → 混合
- (d) `POST /api/requirement/:id/repos?detach=true` → 复用 attach 端点

**共识**:**(a) 但改为 `codebase/`**(用户修正)。

**理由**:与 `DELETE /api/repos/:name` 一对平行端点(全局仓库池 vs 需求级 detach 语义对称);DELETE 动词暗示破坏性;`codebase/` 命名直接对应文件系统路径,避免 `repos/` 与 repos.yaml 命名混淆。

## 决策 7:写盘顺序(2026-08-16)

**问题**:rm 目录先,还是 meta.yaml 先?

**选项**:
- meta.yaml 先 → rm 失败时 branchName 已清,dir 还在 → UI 还显示这个 repo,无绿点 + 元数据丢失;下次 attach 遇 `E_REPO_ALREADY_ATTACHED` 但用户困惑
- rm 先 → rm 失败时不动 meta.yaml,用户重试可幂等;rm 成功 + meta.yaml 写失败 → 纯字段脏,不影响下次 attach

**共识**:**rm 先,再 meta.yaml**。

**理由**:与 `CodebaseManager.remove` 现有调用语义一致(先 safeRm,失败 throw,调用方按需 try/catch)。

## 决策 8:UI loading & 错误回滚(2026-08-16)

**问题**:点了 ✕ → 确认框 → 确认 → HTTP DELETE 期间,chip 怎么处理?

**选项**:
- (a) 乐观更新 → 确认后 chip 立即消失,summary 数字立即 -1;HTTP 失败则 toast 报错 + 重新插入 chip
- (b) 悲观更新 → 确认后 chip 显示 spinner/灰态,HTTP 成功才消失,失败 toast + 恢复 chip
- (c) 乐观 + 显式刷新 → 失败时调一次 `getDraftingData` 重新拉整个 DRAFTING 数据兜底

**共识**:**(b) 悲观更新**。

**理由**:DRAFTING 不是实时协作场景,用户对「点 ✕ 等 200ms」无感;(a) rollback 需要本地维护 selectedRepoNames 的 source of truth 副本,复杂且容易和 SSR 后续刷新的状态冲突;(c) 引入 SSR 数据重新拉取的成本不优雅;(b) 失败时 chip 仍在原位,用户可以无脑再点一次 ✕ 重试。

## 决策 9:测试门禁(2026-08-16)

**问题**:是否走 ADR-0023 风格的强制 e2e?

**选项**:
- (a) 不加新测试要求 → 沿用现有模式
- (b) 加 e2e 测试 → 真 clone 真 rm 跑完整路径
- (c) 加集成 + 单测双层 → service 层单元测试 + route 层 fastify.inject 测试,真 fs 但不真 clone

**共识**:**(c) 集成 + 单测双层,真 fs 但不真 clone**。

**理由**:ADR-0023 不直接适用,但破坏性操作的测试覆盖应有底线;真 clone 在 CI 里慢且依赖网络,与项目历史 CI 现状不符;真 fs(真创建 `codebase/<name>/` 测试目录,真调 safeRm)能覆盖大部分边界:fd race、permission denied、目录不存在等;**不走** ADR-0023 守门,但走 ADR-0023 同等精神:破坏性操作有集成测试覆盖。

## 决策 10:ADR + glossary 落档(2026-08-16)

**问题**:文档怎么组织?

**选项**:
- (a) 仅 ADR
- (b) ADR + glossary
- (c) ADR + glossary + flow 图

**共识**:**(c) ADR + glossary + flow 图**。

**理由**:本 feature 触 6 条决策,跨 web/agent/shared 三个包,review 时只看 diff 不易看全 —— ADR 是必备的;「per-requirement codebase」与「全局仓库池条目」(两条独立删除路径)在术语上需要明确区分,glossary 落定避免后人混淆;流程图能直观展示 rm 先 / meta.yaml 后 / N=1→0 触发清 branchName 等关键分支;命名沿用最近 ADR-0032/0033 风格,定为 `0034-detach-requirement-codebase.md`;scratch 任务文档放 `.scratch/codebase-detach/` 与 ADR 配套。

---

## 隐含工作量(Plan agent §7.1 立项)

必须把 `attachRepo` / `attachRepos` 也用同一把 `withRequirementLock(reqId, ...)` 包起来——detach + attach 同 req 并发会引发 fs 状态机错位。这超出原「只加 detach 端点」的最小范围,但属于「detach 的不可分割前置」,已合入 ADR-0034 Consequences 章节显式标注。