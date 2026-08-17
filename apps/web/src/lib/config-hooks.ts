'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Config, ConfigPatch, WorkspaceInfo } from '@ai-devspace/shared'
import * as agentClient from './agent-client'

const WORKSPACE_KEY = ['workspace'] as const

export function useWorkspace() {
  return useQuery({
    queryKey: WORKSPACE_KEY,
    queryFn: () => agentClient.agentFetch<WorkspaceInfo>('/api/workspace'),
    staleTime: 30_000,
  })
}

export interface UpdateConfigResult {
  ok: true
  config: Config
}

export function useUpdateConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ConfigPatch) =>
      agentClient.agentFetch<UpdateConfigResult>('/api/workspace/config', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => {
      qc.setQueryData<WorkspaceInfo | undefined>(WORKSPACE_KEY, (prev) =>
        prev ? { ...prev, config: data.config } : prev,
      )
    },
  })
}

/**
 * ADR-0037 D3 / D5: 实时校验用户输入的 workspaceRoot 路径。
 *
 * 三档反馈(调 `POST /api/workspace/validate-path`):
 *  - 200 {exists, isWorkspace} 无 errorCode → 绿
 *  - 400 E_WS_ROOT_PATH_NOT_EXISTS → 红
 *  - 400 E_WS_ROOT_PATH_NOT_WORKSPACE → 黄
 *
 * 注意:Web 端 mutation.error 是 AgentError;调用方按 status === 400 + body.error
 * 三档提示。
 */
export interface ValidateWorkspaceRootResult {
  exists: boolean
  isWorkspace: boolean
}

export interface ValidateWorkspaceRootError {
  status: 400
  errorCode: 'E_WS_ROOT_PATH_NOT_EXISTS' | 'E_WS_ROOT_PATH_NOT_WORKSPACE'
  message: string
}

export function useValidateWorkspaceRoot() {
  return useMutation<
    ValidateWorkspaceRootResult,
    agentClient.AgentError & { errorCode?: string; message?: string },
    string
  >({
    mutationFn: (path: string) =>
      agentClient.agentFetch<ValidateWorkspaceRootResult>(
        '/api/workspace/validate-path',
        {
          method: 'POST',
          body: JSON.stringify({ path }),
        },
      ),
  })
}

/**
 * ADR-0037 D4: 重启 agent 进程(workspaceRoot 改完必调一次)。
 *
 * POST /api/agent/restart → 202 {ok, reason, ts};失败 → 500 E_AGENT_RESTART_FAILED。
 * 调用方在成功后通常做一次「软重连」(不强 reload —— 1-2 秒内 SSE 自动重连即可)。
 */
export interface RestartAgentResult {
  ok: true
  reason: 'workspaceRoot-changed' | 'manual-restart' | 'config-changed'
  ts: number
  message: string
}

export function useRestartAgent() {
  return useMutation<RestartAgentResult, agentClient.AgentError, string | undefined>({
    mutationFn: (reason?: string) =>
      agentClient.agentFetch<RestartAgentResult>('/api/agent/restart', {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? 'workspaceRoot-changed' }),
      }),
  })
}