export const DEFAULT_CONFIG = {
  theme: 'system',
  typewriterSpeed: 'medium',
  silentWindowSeconds: 30,
  agentEndpoint: 'http://localhost:7777',
  workspaceRoot: '',
  'ai.provider': 'claude-code',
} as const

export const CONFIG_KEYS = [
  'theme',
  'typewriterSpeed',
  'silentWindowSeconds',
  'agentEndpoint',
  'workspaceRoot',
  'ai.provider',
] as const

export type DefaultConfigKey = (typeof CONFIG_KEYS)[number]
