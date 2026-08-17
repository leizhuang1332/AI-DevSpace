/**
 * ADR-0037 D6: workspace root 可编辑场景的稳定错误码。
 *
 * 与前端 `apps/web` 端的 `errorCodeToMessage` 查表约定保持字符串字面量稳定。
 *
 * - E_WS_ROOT_PATH_NOT_EXISTS  PATCH 配置的 workspaceRoot 路径在文件系统不存在
 * - E_WS_ROOT_PATH_NOT_WORKSPACE 路径存在但缺少任一 WORKSPACE_TRACE_DIRS(超集: requirements / knowledge / skills / analysis-skills)
 * - E_AGENT_RESTART_FAILED    POST /api/agent/restart 调度失败(无 supervisor / spawn 异常)
 */
export const WorkspaceErrorCode = {
  E_WS_ROOT_PATH_NOT_EXISTS: 'E_WS_ROOT_PATH_NOT_EXISTS',
  E_WS_ROOT_PATH_NOT_WORKSPACE: 'E_WS_ROOT_PATH_NOT_WORKSPACE',
  E_AGENT_RESTART_FAILED: 'E_AGENT_RESTART_FAILED',
} as const

export type WorkspaceErrorCodeT =
  (typeof WorkspaceErrorCode)[keyof typeof WorkspaceErrorCode]