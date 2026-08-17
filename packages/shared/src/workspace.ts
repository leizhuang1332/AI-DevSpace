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
  /**
   * ADR-0037 D1: configDir / dataRoot 二分后, `root` 作为向后兼容别名返回 dataRoot。
   * 新代码请直接用 `configDir` / `dataRoot`。
   * @deprecated use `dataRoot`
   */
  root: z.string(),
  /** ADR-0037 D1: 配置目录(config.yaml 唯一居住地; env 或 ~/.aidevspace) */
  configDir: z.string(),
  /** ADR-0037 D1: 数据目录(requirements / knowledge / skills / repos.yaml / snapshots) */
  dataRoot: z.string(),
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
