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
