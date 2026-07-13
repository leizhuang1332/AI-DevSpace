'use server'

/**
 * ANALYZING 工位 · 技术概要生成 server action(issue 19e · VS5)
 *
 * 数据流:
 *   [Client] TechBriefPanel 按钮 → onGenerate
 *   [Client → Server Action] generateTechBrief(requirementId, sessionId)
 *   [Server] POST /api/requirements/<id>/analysis/generate-brief → Agent mock Skill
 *   [Server] reload analysis/ 目录产物 → 返回 preview
 *   [Server] revalidatePath 触发 RSC 刷新
 *
 * 设计要点:
 * - 失败 → { ok: false, error } 不抛(避免污染 Error 边界;UI 层 toast 提示)
 * - 失败回滚由 Agent 端 snapshot 机制保证(决策 47)
 */

import { revalidatePath } from 'next/cache'
import { loadTechBrief, loadModules, resolveAnalysisDir } from './tech-brief.server'
import type { TechBriefModulesFile } from './tech-brief'

export interface GenerateBriefSuccess {
  ok: true
  brief: string
  modules: TechBriefModulesFile
  generatedAt: string
}

export interface GenerateBriefFailure {
  ok: false
  error: string
}

export type GenerateBriefResult = GenerateBriefSuccess | GenerateBriefFailure

export async function generateTechBrief(
  requirementId: string,
  sessionId: string,
): Promise<GenerateBriefResult> {
  try {
    const base = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:7777'
    const res = await fetch(
      `${base}/api/requirements/${encodeURIComponent(requirementId)}/analysis/generate-brief`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      },
    )
    if (!res.ok) {
      const errBody = (await res
        .json()
        .catch(() => null)) as { error?: string; reason?: string } | null
      return {
        ok: false,
        error: errBody?.reason ?? errBody?.error ?? `HTTP ${res.status}`,
      }
    }
    const body = (await res.json()) as { generated_at: string }

    // reload 本地缓存的产物(因 Agent 端写的是 AIDEVSPACE_ROOT,而本 RSC 看的是同一个 root)
    const dir = resolveAnalysisDir(requirementId)
    const brief = loadTechBrief(dir)
    const modules = loadModules(dir)

    revalidatePath(`/requirements/${requirementId}/analyzing`)

    return {
      ok: true,
      brief: brief ?? '',
      modules,
      generatedAt: body.generated_at,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}