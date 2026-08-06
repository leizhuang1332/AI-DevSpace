/**
 * OverrideLog —— 用户在 Guard 冲突下选择"强制切换"时的审计日志(issue 03 / ADR-0025 D2)
 *
 * 文件位置: `<root>/requirements/<reqId>/board/overrides.log`
 * - JSONL 格式(每行一条),append-only(不读不解析旧条目)
 * - 决策 2「目录即真相」:`board/overrides.log` 与 board 物理结构同处
 * - audit 字段最小集:`ts` / `kind` / `parent_status` / `card_id`(issue 03 ticket 4)
 *
 * 设计要点:
 * - 同步写盘 + `mkdir -p board/`,确保父目录存在(写盘失败抛错)
 * - 不引入 logger 依赖(与本仓 RequirementService 风格一致)
 * - `card_id` 是数组 —— 一次 override 可能涉及多张冲突卡(implementing/done 规则)。
 *   issue 03 ticket 4 写 `card_id` 单数;但 done 规则的 conflicts 是多张,
 *   故实际存数组更贴合 ADR;JSONL 序列化为 JSON 数组保留信息量。
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RequirementStatusT } from '@ai-devspace/shared'
import type { ConstraintConflict } from './StatusConstraintGuard.js'

/**
 * override 触发场景类型。
 *
 * 当前仅 1 种场景:用户切子卡 status 时选"强制切换"。
 * 父 status 切换走别的入口(PATCH /api/requirement/:id 留给后续 ticket);
 * 父 status override 暂不在 issue 03 范围,保持枚举单值,避免误导。
 */
export type OverrideKind = 'child_status_force_apply'

/** 一条 override 记录的最小字段(issue 03 ticket 4)。 */
export interface OverrideEntry {
  /** ISO 8601 timestamp */
  ts: string
  /** 触发场景 */
  kind: OverrideKind
  /** 当时父 Requirement.status(切到的目标值,or 卡改前的父 status) */
  parent_status: RequirementStatusT
  /** 涉及的所有冲突卡 id(单张卡冲突也包成数组) */
  card_id: string[]
  /** 命中规则名(便于 audit 复盘) */
  rules: ConstraintConflict['rule'][]
}

export interface OverrideLogDeps {
  /** workspace root,等价 `RequirementService.root` */
  root: string
}

/** 时间格式化 helper —— 暴露便于测试用 fake clock 注入。 */
export type Clock = () => Date

export class OverrideLog {
  private readonly root: string
  private readonly clock: Clock

  constructor(deps: OverrideLogDeps, clock: Clock = () => new Date()) {
    this.root = deps.root
    this.clock = clock
  }

  /** `<root>/requirements/<reqId>/board/overrides.log` 绝对路径 */
  logPath(reqId: string): string {
    return join(this.root, 'requirements', reqId, 'board', 'overrides.log')
  }

  /**
   * 追加一条 override 记录;JSONL(每行一个 JSON 对象,换行结尾)。
   *
   * - 自动 `mkdir -p <root>/requirements/<reqId>/board/`
   * - 失败抛 Error(路由层映射 500);不静默吞错
   */
  append(reqId: string, entry: Omit<OverrideEntry, 'ts'> & { ts?: string }): void {
    const full: OverrideEntry = { ...entry, ts: entry.ts ?? this.clock().toISOString() }
    const dir = join(this.root, 'requirements', reqId, 'board')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      appendFileSync(this.logPath(reqId), JSON.stringify(full) + '\n', {
        mode: 0o600,
      })
    } catch (err) {
      throw new Error(
        `OverrideLog.append failed for req ${reqId}: ${(err as Error).message}`,
      )
    }
  }

  /**
   * 便捷方法:把 Guard 冲突转成 entry(自动取 ts / rules / card_id 数组)。
   *
   * 路由层调用:
   * ```ts
   * if (guard.ok === false && override) {
   *   overrideLog.appendFromConflict(reqId, {
   *     kind: 'child_status_force_apply',
   *     parentStatus: parent.status,
   *     conflicts: guard.conflicts,
   *   })
   * }
   * ```
   */
  appendFromConflict(
    reqId: string,
    args: {
      kind: OverrideKind
      parentStatus: RequirementStatusT
      conflicts: readonly ConstraintConflict[]
    },
  ): void {
    this.append(reqId, {
      kind: args.kind,
      parent_status: args.parentStatus,
      card_id: args.conflicts.map((c) => c.card_id),
      rules: args.conflicts.map((c) => c.rule),
    })
  }
}