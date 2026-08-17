/**
 * TaskCardStore —— board section 的 TaskCard 持久化服务(issue 02 / ADR-0024)
 *
 * 物理路径:`~/.aidevspace/requirements/<reqId>/board/tasks/<ulid>.json`
 *   决策 2「目录即真相」+ ADR-0024 D4 物理存储布局。
 *
 * 设计要点:
 * - 同步 IO(沿用本仓 RequirementService 风格)。
 * - `update()` 自动维护 `updated_at` 与 `completed_at`(`status=done` 时写时间戳;
 *   离开 done → null)。
 * - 错误用 `throw` + `TaskCardStoreError`(code + message),路由层映射 HTTP code;
 *   不在 store 层构造 HTTP 语义(避免与 fastify 耦合)。
 * - ULID 生成走 `shared.generateTaskCardUlid` —— Crockford Base32 26 字符,
 *   时间排序;单测可注入 `ulidFactory` / `nowIso` 控制确定性。
 *
 * 公共 API:
 *   - list(reqId, opts)              —— 列出,默认过滤 archived;可按 status/priority/source/label
 *   - listActive(reqId)              —— 等价 list(reqId),Guard 用的便捷入口
 *   - get(reqId, cardId)             —— 单卡读;不存在 / schema 失败 → null
 *   - create(reqId, input)           —— manual 创建;强制 parent_id=reqId, source='manual'
 *   - update(reqId, cardId, patch)   —— 字段白名单 PATCH
 *   - updateStatus(reqId, cardId, status) —— 仅改 status + 自动维护 completed_at
 *   - archive(reqId, cardId)         —— 软删(is_archived=true)
 *   - exists(reqId)                  —— req 目录是否存在
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  generateTaskCardUlid,
  TASK_CARD_ID_RE,
  TaskCardSchema,
  TaskCardSource,
  TaskCardStatus,
  type TaskCard,
  type TaskCardPriorityT,
  type TaskCardSourceT,
  type TaskCardStatusT,
} from '@ai-devspace/shared'

// ---------------------------------------------------------------------------
// 错误类型
// ---------------------------------------------------------------------------

/** board store 失败时抛错;code 与 HTTP 状态码映射由路由层决定。 */
export class TaskCardStoreError extends Error {
  constructor(
    public readonly code:
      | 'E_CARD_NOT_FOUND'
      | 'E_INVALID_CARD_ID'
      | 'E_INVALID_INPUT'
      | 'E_REQUIREMENT_NOT_FOUND'
      | 'E_IO',
    message: string,
  ) {
    super(message)
    this.name = 'TaskCardStoreError'
  }
}

// ---------------------------------------------------------------------------
// 输入 / 选项
// ---------------------------------------------------------------------------

/**
 * 最小创建入参(manual 卡片);服务端强制 parent_id=reqId, source 默认 manual。
 *
 * `source`:缺省 `manual`(常规 manual 创建);issue 08 PRD 拆候选落地时
 * web 端显式传 `source='prd_split'`,与 manual 卡区分(便于 board 过滤 + 审计)。
 * 测试 / seed 场景允许显式传 `id`;真实生产路径永远不传。
 */
export interface CreateTaskCardInput {
  title: string
  status?: TaskCardStatusT
  content?: string
  priority?: TaskCardPriorityT | null
  assignee?: string | null
  labels?: string[]
  depends_on?: string[]
  order_index?: number | null
  /** 卡片来源(缺省 manual;PRD 拆落地传 prd_split) */
  source?: TaskCardSourceT
  /**
   * 测试 / seed 场景允许显式传 `id`;缺省由 `create` 内部生成 26 位 ULID。
   * 真实生产路径永远不传。
   */
  id?: string
}

/** list 过滤选项。 */
export interface ListTaskCardOptions {
  /** 默认 false —— Guard 不需要看到 archived 卡;web 列表也默认隐藏 */
  includeArchived?: boolean
  status?: TaskCardStatusT
  priority?: TaskCardPriorityT
  source?: TaskCardSourceT
  /** label 包含(数组里任一 === label 即命中) */
  label?: string
}

/**
 * PATCH 入参 —— 字段白名单(对照 ticket 02 验收):
 * id / parent_id / status / title / content / priority / assignee /
 * labels / depends_on / order_index / source / is_archived
 *
 * 不接受 created_at / updated_at / completed_at(由服务层自动维护)。
 * id 也禁止改(避免覆盖原文件;若真要"换 id"需 archive + new create)。
 */
export interface UpdateTaskCardInput {
  parent_id?: string | null
  status?: TaskCardStatusT
  title?: string
  content?: string
  priority?: TaskCardPriorityT | null
  assignee?: string | null
  labels?: string[]
  depends_on?: string[]
  order_index?: number | null
  source?: TaskCardSourceT
  is_archived?: boolean
}

export interface TaskCardStoreDeps {
  /** workspace root,等价 `RequirementService.root` */
  root: string
  /**
   * ULID 工厂:测试可注入确定性 ID 序列;不传则用 shared.generateTaskCardUlid
   * (Crockford Base32 26 字符,时间戳可排序)。
   */
  ulidFactory?: () => string
  /**
   * 时间源:测试可注入固定时间,断言 created_at / updated_at。
   * 不传则用 `new Date().toISOString()`。
   */
  nowIso?: () => string
}

// ---------------------------------------------------------------------------
// 主类
// ---------------------------------------------------------------------------

export class TaskCardStore {
  private readonly root: string
  private readonly ulidFactory: () => string
  private readonly nowIso: () => string
  /**
   * 物理删除用的 per-cardId 串行锁(ADR-0036 D7 决策 106 per-requirement mutex
   * 模式的卡片级细化)。Map<cardId, Promise>;同 cardId 第二次 `delete` 会
   * 等第一次 settle;不同 cardId 之间不阻塞。
   *
   * 注意:仅 `delete` 路径持锁;`archive` 走 `update`,与 delete 不共享锁语义,
   * 避免把 archive 的并发行为绑死。
   */
  private readonly locks: Map<string, Promise<unknown>> = new Map()

  constructor(deps: TaskCardStoreDeps) {
    this.root = deps.root
    this.ulidFactory = deps.ulidFactory ?? (() => generateTaskCardUlid())
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
  }

  // -------------------------------------------------------------------------
  // 路径(单点真相,test + route 共享)
  // -------------------------------------------------------------------------

  /** `<root>/requirements/<reqId>/board/tasks/` 目录路径 */
  tasksDir(reqId: string): string {
    return join(this.root, 'requirements', reqId, 'board', 'tasks')
  }

  /** 单卡绝对路径 */
  cardPath(reqId: string, cardId: string): string {
    return join(this.tasksDir(reqId), `${cardId}.json`)
  }

  /**
   * 单卡的协作目录绝对路径(ADR-0028 D1 物理独立 transcript 路径):
   * `<tasksDir>/<cardId>/transcript.yaml`。`delete()` 路径下需要
   * `rm -rf` 这个目录。
   */
  cardDirFor(reqId: string, cardId: string): string {
    return join(this.tasksDir(reqId), cardId)
  }

  /** `<root>/requirements/<reqId>/board/` 目录(overrides.log 父目录) */
  boardDir(reqId: string): string {
    return join(this.root, 'requirements', reqId, 'board')
  }

  /** `<root>/requirements/<reqId>/` 父目录 */
  requirementDir(reqId: string): string {
    return join(this.root, 'requirements', reqId)
  }

  /** req 目录是否存在(外部 404 映射用) */
  exists(reqId: string): boolean {
    return existsSync(this.requirementDir(reqId))
  }

  // -------------------------------------------------------------------------
  // 读
  // -------------------------------------------------------------------------

  /**
   * 列出指定 req 下所有 TaskCard;按 `updated_at` 倒序。
   *
   * - 默认过滤 `is_archived = true` 的卡 —— ADR-0025 D6「archived 不参与父 status 校验」
   * - 缺 tasks/ 目录 → 返回 []
   * - 单文件解析失败 → 跳过该文件 + console.warn(沿用 listRequirements 容错策略)
   * - `status` / `priority` / `source` / `label` 全部为可选;任意组合 AND
   */
  list(reqId: string, opts: ListTaskCardOptions = {}): TaskCard[] {
    const dir = this.tasksDir(reqId)
    if (!existsSync(dir)) return []
    let names: string[]
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    const out: TaskCard[] = []
    for (const name of names) {
      const abs = join(dir, name)
      let raw: string
      try {
        raw = readFileSync(abs, 'utf8')
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[TaskCardStore] read failed for ${abs}:`, err)
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[TaskCardStore] parse failed for ${abs}:`, err)
        continue
      }
      const result = TaskCardSchema.safeParse(parsed)
      if (!result.success) {
        // eslint-disable-next-line no-console
        console.warn(
          `[TaskCardStore] schema-invalid card ${abs}:`,
          result.error.issues,
        )
        continue
      }
      const card = result.data
      if (!opts.includeArchived && card.is_archived) continue
      if (opts.status && card.status !== opts.status) continue
      if (opts.priority && card.priority !== opts.priority) continue
      if (opts.source && card.source !== opts.source) continue
      if (opts.label && !card.labels.includes(opts.label)) continue
      out.push(card)
    }
    out.sort((a, b) =>
      a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0,
    )
    return out
  }

  /**
   * 列出**非 archived** 卡 — ADR-0025 D6「约束校验用 TaskCardStore.list(过滤非 archived)」。
   *
   * 这是给 Guard 用的便捷方法,语义等价于 `list(reqId)`(默认过滤)。
   */
  listActive(reqId: string): TaskCard[] {
    return this.list(reqId)
  }

  /**
   * 单卡读;不存在 / ID 不合法 / schema 失败 → null(上层映射 404)。
   *
   * 注:返回 null 不区分"不存在"与"格式错",与 `resolveAssetFile` 风格一致
   * —— 避免给攻击者提供 oracle。
   */
  get(reqId: string, cardId: string): TaskCard | null {
    if (!TASK_CARD_ID_RE.test(cardId)) return null
    const abs = this.cardPath(reqId, cardId)
    if (!existsSync(abs)) return null
    let raw: string
    try {
      raw = readFileSync(abs, 'utf8')
    } catch {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
    const result = TaskCardSchema.safeParse(parsed)
    return result.success ? result.data : null
  }

  // -------------------------------------------------------------------------
  // 写
  // -------------------------------------------------------------------------

  /**
   * 创建一张 TaskCard。
   *
   * 默认 `source='manual'`;`parent_id` 默认 = reqId(根级卡片归属)。
   * issue 08 PRD 拆候选落地时,web 端传 `source='prd_split'`,落盘为 PRD 拆卡片。
   * 测试 / seed 场景允许显式传 `id`。
   *
   * @throws {TaskCardStoreError} E_REQUIREMENT_NOT_FOUND req 目录不存在
   * @throws {TaskCardStoreError} E_INVALID_CARD_ID id 不是 26 位 ULID
   * @throws {TaskCardStoreError} E_INVALID_INPUT 字段通过 schema 失败
   * @throws {TaskCardStoreError} E_IO 写盘失败
   */
  create(reqId: string, input: CreateTaskCardInput): TaskCard {
    if (!this.exists(reqId)) {
      throw new TaskCardStoreError(
        'E_REQUIREMENT_NOT_FOUND',
        `requirement ${reqId} not found`,
      )
    }
    const id = input.id ?? this.ulidFactory()
    if (!TASK_CARD_ID_RE.test(id)) {
      throw new TaskCardStoreError(
        'E_INVALID_CARD_ID',
        `card id "${id}" is not a valid 26-char ULID`,
      )
    }
    const now = this.nowIso()
    const draft: TaskCard = {
      id,
      parent_id: reqId,
      status: input.status ?? TaskCardStatus.BACKLOG,
      title: input.title.trim(),
      content: input.content ?? '',
      priority: input.priority ?? null,
      assignee: input.assignee ?? null,
      labels: input.labels ?? [],
      depends_on: input.depends_on ?? [],
      order_index: input.order_index ?? null,
      source: input.source ?? TaskCardSource.MANUAL,
      is_archived: false,
      created_at: now,
      updated_at: now,
      completed_at: null,
    }
    const parsed = TaskCardSchema.safeParse(draft)
    if (!parsed.success) {
      throw new TaskCardStoreError(
        'E_INVALID_INPUT',
        `task card input invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    const dir = this.tasksDir(reqId)
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch (err) {
      throw new TaskCardStoreError(
        'E_IO',
        `mkdir ${dir} failed: ${(err as Error).message}`,
      )
    }
    try {
      writeFileSync(this.cardPath(reqId, id), JSON.stringify(parsed.data, null, 2), {
        mode: 0o600,
      })
    } catch (err) {
      throw new TaskCardStoreError(
        'E_IO',
        `write ${this.cardPath(reqId, id)} failed: ${(err as Error).message}`,
      )
    }
    return parsed.data
  }

  /**
   * 字段白名单 PATCH(对照 ticket 02 验收):
   * parent_id / status / title / content / priority / assignee /
   * labels / depends_on / order_index / source / is_archived
   *
   * 联动:
   * - `updated_at` 自动改写
   * - `status=done` → `completed_at = now`;其他 status → `completed_at = null`
   *
   * 旧版本 `updateStatus` 作为便捷入口仍保留(Guard 仍会用到);若调用方需要
   * 仅改 status,推荐走 `update(reqId, cardId, { status })`。
   *
   * @throws {TaskCardStoreError} E_CARD_NOT_FOUND 卡不存在
   * @throws {TaskCardStoreError} E_INVALID_INPUT 字段通过 schema 失败
   * @throws {TaskCardStoreError} E_IO 写盘失败
   */
  update(reqId: string, cardId: string, patch: UpdateTaskCardInput): TaskCard {
    const current = this.get(reqId, cardId)
    if (!current) {
      throw new TaskCardStoreError(
        'E_CARD_NOT_FOUND',
        `task card ${cardId} not found in req ${reqId}`,
      )
    }
    const ts = this.nowIso()
    const next: TaskCard = {
      ...current,
      ...(patch.parent_id !== undefined ? { parent_id: patch.parent_id } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
      ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
      ...(patch.depends_on !== undefined ? { depends_on: patch.depends_on } : {}),
      ...(patch.order_index !== undefined ? { order_index: patch.order_index } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.is_archived !== undefined ? { is_archived: patch.is_archived } : {}),
      updated_at: ts,
      completed_at: deriveCompletedAt(
        patch.status !== undefined ? patch.status : current.status,
        patch.status !== undefined ? ts : current.completed_at,
      ),
    }
    const validated = TaskCardSchema.safeParse(next)
    if (!validated.success) {
      throw new TaskCardStoreError(
        'E_INVALID_INPUT',
        `task card patch invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    try {
      writeFileSync(
        this.cardPath(reqId, cardId),
        JSON.stringify(validated.data, null, 2),
        { mode: 0o600 },
      )
    } catch (err) {
      throw new TaskCardStoreError(
        'E_IO',
        `write ${this.cardPath(reqId, cardId)} failed: ${(err as Error).message}`,
      )
    }
    return validated.data
  }

  /**
   * 改 status 字段;自动维护 `updated_at` 与 `completed_at`。
   *
   * - 不存在 / archived → 抛 `E_CARD_NOT_FOUND`
   * - 与 `done` 互转时维护 `completed_at`:
   *     - 非 done → done: 写 `completed_at = updated_at`
   *     - done → 非 done: 清空 `completed_at = null`
   *
   * 旧 API 保留(Guard 用);新代码推荐用 `update(reqId, cardId, { status })`。
   */
  updateStatus(
    reqId: string,
    cardId: string,
    status: TaskCardStatusT,
    updatedAt?: string,
  ): TaskCard {
    const current = this.get(reqId, cardId)
    if (!current || current.is_archived) {
      throw new TaskCardStoreError(
        'E_CARD_NOT_FOUND',
        `task card ${cardId} not found in req ${reqId}`,
      )
    }
    const ts = updatedAt ?? this.nowIso()
    const next: TaskCard = {
      ...current,
      status,
      updated_at: ts,
      // 进入 done:写完成时间;离开 done:清空
      completed_at: status === TaskCardStatus.DONE ? ts : null,
    }
    const validated = TaskCardSchema.safeParse(next)
    if (!validated.success) {
      throw new TaskCardStoreError(
        'E_INVALID_INPUT',
        `updateStatus invalid: ${validated.error.issues.map((i) => i.message).join('; ')}`,
      )
    }
    try {
      writeFileSync(
        this.cardPath(reqId, cardId),
        JSON.stringify(validated.data, null, 2),
        { mode: 0o600 },
      )
    } catch (err) {
      throw new TaskCardStoreError(
        'E_IO',
        `write ${this.cardPath(reqId, cardId)} failed: ${(err as Error).message}`,
      )
    }
    return validated.data
  }

  /**
   * 软删:`is_archived = true`(状态保留);走 `update` 路径,
   * 自动 `updated_at` 改写。文件不删(便于 undo / 审计)。
   *
   * 注:ADR-0036 D7 后,board UI 不再触发 `archive`;后端路径仍保留,
   * 供 snapshot / CLI 工具调用 + `is_archived` 字段在 ADR-0025 D6 仍生效。
   *
   * @throws {TaskCardStoreError} E_CARD_NOT_FOUND 卡不存在
   */
  archive(reqId: string, cardId: string): TaskCard {
    return this.update(reqId, cardId, { is_archived: true })
  }

  /**
   * per-cardId 串行执行:同 cardId 第二次调用会等第一次 settle,
   * 不同 cardId 之间互不阻塞(ADR-0036 D7)。
   *
   * 实现要点:
   * - 链式 Promise:`prev.catch(() => {}).then(fn)`,失败不破坏链,否则一次抛错
   *   永久卡死该 cardId
   * - tracked promise(`next.catch(() => {})`)写回 Map,保证后续等待者拿到完整 settle
   * - finally 中如果当前链是 Map 中最后一个值 → delete entry,避免 Map 无限增长
   *
   * 私有,目前仅 `delete()` 路径使用;`archive` 走 `update`,与本锁解耦。
   */
  private async withCardLock<T>(
    cardId: string,
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const prev = this.locks.get(cardId) ?? Promise.resolve()
    // 失败不破坏链,确保 catch 后下一个调用仍能进入
    const safePrev = prev.catch(() => undefined)
    const next = safePrev.then(() => fn())
    const tracked = next.catch(() => undefined)
    this.locks.set(cardId, tracked)
    try {
      return await next
    } finally {
      // 仅当 Map 中仍是本链时清掉;避免清掉后续等待者插入的链
      if (this.locks.get(cardId) === tracked) {
        this.locks.delete(cardId)
      }
    }
  }

  /**
   * 物理删除一张 TaskCard(ADR-0036 D1):
   * `rm -rf <tasksDir>/<cardId>/` + `unlink <tasksDir>/<cardId>.json`,
   * 一次操作同时清掉 TaskCard 主数据 + transcript(ADR-0028 D1 物理独立)。
   *
   * 删除顺序(陷阱 2):
   *   1. `rm -rf <cardId>/` — 先删目录(含 transcript)
   *      抛错 → `E_IO`,**不动** .json
   *   2. `unlink <cardId>.json` — 删主数据
   *      抛错(罕见,目录已空时)→ console.warn + 仍返回 success
   *        (卡已删,orphan json 可下次清理)
   *
   * 幂等性:cardDir 和 cardPath 都不存在 → `E_CARD_NOT_FOUND`(第二次访问的标准错误)
   *
   * 并发保护:走 `withCardLock(cardId, ...)`,同 cardId 串行;不同 cardId 并行。
   *
   * 注:blocker 检查(子任务 / 依赖方)不在 store 职责内,由 route 层
   * 调 `getBlockers(cards, cardId)` 后再决定是否调本方法。
   *
   * @throws {TaskCardStoreError} E_INVALID_CARD_ID id 不合法
   * @throws {TaskCardStoreError} E_REQUIREMENT_NOT_FOUND req 目录不存在
   * @throws {TaskCardStoreError} E_CARD_NOT_FOUND 卡片不存在(幂等保护)
   * @throws {TaskCardStoreError} E_IO 文件系统错误
   */
  async delete(reqId: string, cardId: string): Promise<void> {
    if (!TASK_CARD_ID_RE.test(cardId)) {
      throw new TaskCardStoreError(
        'E_INVALID_CARD_ID',
        `card id "${cardId}" is not a valid 26-char ULID`,
      )
    }
    if (!this.exists(reqId)) {
      throw new TaskCardStoreError(
        'E_REQUIREMENT_NOT_FOUND',
        `requirement ${reqId} not found`,
      )
    }
    await this.withCardLock(cardId, async () => {
      const cardDir = this.cardDirFor(reqId, cardId)
      const cardFile = this.cardPath(reqId, cardId)
      const dirExists = existsSync(cardDir)
      const fileExists = existsSync(cardFile)
      // 幂等保护:都缺失 → 当作"卡不存在"
      if (!dirExists && !fileExists) {
        throw new TaskCardStoreError(
          'E_CARD_NOT_FOUND',
          `task card ${cardId} not found in req ${reqId}`,
        )
      }
      // 1) 先删目录(含 transcript)—— 抛错时 .json 不动
      if (dirExists) {
        try {
          rmSync(cardDir, { recursive: true, force: true })
        } catch (err) {
          throw new TaskCardStoreError(
            'E_IO',
            `rm ${cardDir} failed: ${(err as Error).message}`,
          )
        }
      }
      // 2) 再删主数据 —— 罕见失败 → warn + 仍 success(orphan 可后续清理)
      if (fileExists) {
        try {
          unlinkSync(cardFile)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[TaskCardStore] unlink ${cardFile} failed after dir rm; orphan json, manual cleanup suggested:`,
            err,
          )
        }
      }
    })
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * 派生 `completed_at`:
 * - status='done' 且尚未填 → 填 now
 * - status='done' 且已有 completed_at → 保留(避免覆盖既有完成时间)
 * - 离开 'done' → 置 null
 */
function deriveCompletedAt(
  status: TaskCardStatusT,
  nowOrCurrent: string | null,
): string | null {
  if (status === TaskCardStatus.DONE) {
    return nowOrCurrent
  }
  return null
}
