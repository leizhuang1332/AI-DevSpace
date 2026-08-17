import type { FastifyInstance } from 'fastify'
import {
  ConfigPatchSchema,
  type Config,
  type WorkspaceValidation,
} from '@ai-devspace/shared'
import type { WorkspaceService } from '../services/WorkspaceService.js'
import { WorkspaceErrorCode } from '../error/WorkspaceErrorCodes.js'

export interface WorkspaceRouteDeps {
  workspace: WorkspaceService
}

const WORKSPACE_ROOT_ERROR_MESSAGES: Record<string, string> = {
  [WorkspaceErrorCode.E_WS_ROOT_PATH_NOT_EXISTS]:
    '该路径在文件系统不存在,请确认输入正确或先创建目录',
  [WorkspaceErrorCode.E_WS_ROOT_PATH_NOT_WORKSPACE]:
    '该路径存在但缺少 AI DevSpace workspace 痕迹(需要至少包含 requirements/、knowledge/、skills/ 或 analysis-skills/ 任一子目录)',
}

export async function workspaceRoutes(
  app: FastifyInstance,
  deps: WorkspaceRouteDeps,
): Promise<void> {
  app.get('/api/workspace', async () => {
    return deps.workspace.getWorkspaceInfo()
  })

  /**
   * ADR-0037 D3 / D5: settings UI 在提交 PATCH 之前调用此端点,
   * 验证新路径是否合法(存在 + 是 workspace)。三档反馈:
   *  - 不存在 → 400 E_WS_ROOT_PATH_NOT_EXISTS
   *  - 存在但无 workspace 痕迹 → 400 E_WS_ROOT_PATH_NOT_WORKSPACE
   *  - 存在有痕迹 → 200 { exists, isWorkspace }(无 errorCode)
   *
   * body: { path: string }
   */
  app.post('/api/workspace/validate-path', async (req, reply) => {
    const body = (req.body ?? {}) as { path?: unknown }
    const path = typeof body.path === 'string' ? body.path : ''
    const result: WorkspaceValidation = deps.workspace.validatePath(path)
    if (result.errorCode) {
      return reply.code(400).send({
        error: result.errorCode,
        message:
          WORKSPACE_ROOT_ERROR_MESSAGES[result.errorCode] ??
          'workspaceRoot 校验失败',
        exists: result.exists,
        isWorkspace: result.isWorkspace,
      })
    }
    return result
  })

  /**
   * ADR-0037 D5: PATCH workspaceRoot 强制校验 —— 路径必须是合法 workspace,
   * 否则返回 400 + 错误码(前端用于精确提示,而不是静默写到 config.yaml)。
   */
  app.patch('/api/workspace/config', async (req, reply) => {
    const parsed = ConfigPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_patch',
        details: parsed.error.issues,
      })
    }

    const patch = parsed.data
    const candidate = patch.workspaceRoot
    if (typeof candidate === 'string') {
      const result = deps.workspace.validatePath(candidate)
      if (result.errorCode) {
        return reply.code(400).send({
          error: result.errorCode,
          message:
            WORKSPACE_ROOT_ERROR_MESSAGES[result.errorCode] ??
            'workspaceRoot 校验失败',
          exists: result.exists,
          isWorkspace: result.isWorkspace,
        })
      }
    }

    const { config } = await deps.workspace.updateConfig(parsed.data)
    const out: Config = config
    return { ok: true, config: out }
  })

  app.post('/api/workspace/open', async (_req, reply) => {
    // 占位：本期不真实打开；后续 issue 用 shell.openPath / xdg-open / explorer 跨平台实现
    return reply
      .code(501)
      .send({ error: 'not_implemented', message: 'workspace open 在后续 issue 实现' })
  })

  app.post('/api/workspace/uninstall', async (_req, reply) => {
    // 占位：本期不真实删除；后续 issue 做真正卸载（需二次确认 + 备份）
    return reply
      .code(501)
      .send({ error: 'not_implemented', message: 'workspace uninstall 在后续 issue 实现' })
  })
}