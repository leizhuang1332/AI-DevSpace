import type { FastifyInstance } from 'fastify'
import { ConfigPatchSchema, type Config } from '@ai-devspace/shared'
import type { WorkspaceService } from '../services/WorkspaceService.js'

export interface WorkspaceRouteDeps {
  workspace: WorkspaceService
}

export async function workspaceRoutes(
  app: FastifyInstance,
  deps: WorkspaceRouteDeps,
): Promise<void> {
  app.get('/api/workspace', async () => {
    return deps.workspace.getWorkspaceInfo()
  })

  app.patch('/api/workspace/config', async (req, reply) => {
    const parsed = ConfigPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_patch',
        details: parsed.error.issues,
      })
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
