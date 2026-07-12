import { z } from 'zod'

export const ApiErrorCode = {
  unauthorized: 'unauthorized',
  origin_not_allowed: 'origin_not_allowed',
  not_implemented: 'not_implemented',
  not_found: 'not_found',
  invalid_patch: 'invalid_patch',
  internal: 'internal',
} as const
export type ApiErrorCodeT = (typeof ApiErrorCode)[keyof typeof ApiErrorCode]

export const ApiError = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
})
export type ApiErrorT = z.infer<typeof ApiError>

export const NotImplementedError = z.object({
  error: z.literal('not_implemented'),
  feature: z.string(),
  message: z.string(),
  issue: z.string(),
})
export type NotImplementedErrorT = z.infer<typeof NotImplementedError>

export const CookieAttributesSchema = z.object({
  SameSite: z.enum(['Strict', 'Lax', 'None']),
  Path: z.string(),
  MaxAge: z.number().int().nonnegative(),
})

export const BootstrapResponse = z.object({
  ok: z.literal(true),
  token: z.string().min(40).max(64),
  cookieName: z.literal('aidevspace_token'),
  cookieAttributes: CookieAttributesSchema,
  apiBase: z.string().url(),
  agentVersion: z.string(),
  sseNote: z.string(),
})
export type BootstrapResponseT = z.infer<typeof BootstrapResponse>
