/**
 * workspaceRoot 路径校验(纯逻辑层)
 *
 * ADR-0037 D3 三档反馈:
 * - 路径不存在 → errorCode 'E_WS_ROOT_PATH_NOT_EXISTS'
 * - 路径存在但**无 workspace 痕迹** → errorCode 'E_WS_ROOT_PATH_NOT_WORKSPACE'
 * - 路径存在**有 workspace 痕迹** → 无 errorCode (UI 显绿)
 *
 * 「workspace 痕迹」超集定义(ADR-0037 D3):
 * - `requirements/` / `knowledge/` / `skills/` / `analysis-skills/` 四目录任一存在即视为有痕迹
 * - 不要求 `config.yaml` (settings 接管后 config.yaml 被新写,不依赖旧文件)
 *
 * 本文件**不**直接 `import 'node:fs'`——shared 包需在 web bundle 中可解析。
 * fs 调用由调用方(agent `services/workspaceValidation.ts`)通过 `validateWorkspaceRootPure`
 * 注入 `{ exists, hasAnyTrace }` 两个布尔派生值实现。
 */

import { z } from 'zod'

/** Workspace 痕迹判定要扫的子目录(超集定义) */
export const WORKSPACE_TRACE_DIRS = [
  'requirements',
  'knowledge',
  'skills',
  'analysis-skills',
] as const

/** WorkspaceValidation 响应 schema(被 agent route 与前端 consume) */
export const WorkspaceValidationSchema = z.object({
  exists: z.boolean(),
  isWorkspace: z.boolean(),
  errorCode: z
    .enum(['E_WS_ROOT_PATH_NOT_EXISTS', 'E_WS_ROOT_PATH_NOT_WORKSPACE'])
    .optional(),
})

export type WorkspaceValidation = z.infer<typeof WorkspaceValidationSchema>

/**
 * 纯函数:把 fs 派生的 `exists` / `hasAnyTrace` 两个布尔值映射到三档判定。
 *
 * 设计动机:让 shared 包**不依赖** `node:fs`,web bundle 可安全 import;
 * 调用方(agent)负责 fs 调用并把结果喂进来。
 */
export function validateWorkspaceRootPure(input: {
  /** 用户填写的路径(已被调用方 normalize 过) */
  path: string
  /** fs 检查: 路径是否存在 */
  exists: boolean
  /** fs 检查: 路径下是否含任一 WORKSPACE_TRACE_DIRS 子目录 */
  hasAnyTrace: boolean
}): WorkspaceValidation {
  // 空字符串 / 纯空白 → 当不存在处理(防 null path 漏掉)
  if (!input.path || input.path.trim() === '') {
    return {
      exists: false,
      isWorkspace: false,
      errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS',
    }
  }

  if (!input.exists) {
    return {
      exists: false,
      isWorkspace: false,
      errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS',
    }
  }

  if (!input.hasAnyTrace) {
    return {
      exists: true,
      isWorkspace: false,
      errorCode: 'E_WS_ROOT_PATH_NOT_WORKSPACE',
    }
  }

  return { exists: true, isWorkspace: true }
}