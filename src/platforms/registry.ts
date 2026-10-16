import { PlatformConfig, PlatformRegistry } from '@/types/platform'
import { registerAccountOps } from './accountOps'
import { antigravityConfig } from './antigravity'
import { kiroConfig } from './kiro'
import { claudeConfig } from './claude'
import { codexConfig } from './codex'
import { geminiConfig } from './gemini'
import { externalPlatformConfigs } from './external'

const [
  githubCopilotConfig,
  windsurfConfig,
  cursorConfig,
  codebuddyConfig,
  codebuddyCnConfig,
  qoderConfig,
  traeConfig,
  zedConfig,
  grokConfig,
  zcodeConfig,
  workbuddyConfig,
] = externalPlatformConfigs

export const platforms: PlatformConfig[] = [
  antigravityConfig,
  codexConfig,
  githubCopilotConfig,
  windsurfConfig,
  kiroConfig,
  cursorConfig,
  geminiConfig,
  claudeConfig,
  codebuddyConfig,
  codebuddyCnConfig,
  qoderConfig,
  traeConfig,
  zedConfig,
  workbuddyConfig,
  grokConfig,
  zcodeConfig,
]

// 将各平台声明的账号操作契约登记到叶子注册表，供 usePlatformStore 统一调度。
for (const platform of platforms) {
  if (platform.accountOps) {
    registerAccountOps(platform.id, platform.accountOps)
  }
}

export const platformRegistry: PlatformRegistry = new Map(
  platforms.map((platform) => [platform.id, platform]),
)

export function getPlatform(id: string): PlatformConfig | undefined {
  return platformRegistry.get(id)
}

export function getAllPlatforms(): PlatformConfig[] {
  return platforms
}
