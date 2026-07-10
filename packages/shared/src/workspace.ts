import { z } from 'zod'

export const ConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])
export type ConfigValue = z.infer<typeof ConfigValueSchema>

export const ConfigSchema = z.record(z.string(), ConfigValueSchema)
export type Config = z.infer<typeof ConfigSchema>

export const ConfigPatchSchema = ConfigSchema
export type ConfigPatch = z.infer<typeof ConfigPatchSchema>

export const WorkspaceInfoSchema = z.object({
  root: z.string(),
  exists: z.boolean(),
  createdAt: z.number().nullable(),
  subdirs: z.record(z.string(), z.boolean()),
  configPath: z.string(),
  config: ConfigSchema,
  gitignorePath: z.string(),
  gitignoreExists: z.boolean(),
  diskUsageBytes: z.number().int().nonnegative(),
})
export type WorkspaceInfo = z.infer<typeof WorkspaceInfoSchema>
