import { invoke } from '@tauri-apps/api/core'
import { CodexProviderPreset } from '@/types/provider'
import { CodexConfig } from '@/types/account'

export class CodexProviderService {
  /**
   * 应用供应商预设：
   * 预设完整定义 auth.json + config.toml 内容，注入 API Key 后
   * 走与账号切换相同的原子写路径（switch_codex_account）。
   */
  async applyProvider(
    preset: CodexProviderPreset,
    apiKey: string,
    baseUrl?: string
  ): Promise<void> {
    // 端点测速选中了更快线路时，替换当前 model_provider 的 base_url
    const presetConfig = preset.config.config
    const config: CodexConfig = {
      auth: {
        ...preset.config.auth,
        OPENAI_API_KEY: apiKey,
      },
      config: baseUrl
        ? {
            ...presetConfig,
            model_providers: Object.fromEntries(
              Object.entries(presetConfig.model_providers ?? {}).map(([key, provider]) => [
                key,
                key === presetConfig.model_provider ? { ...provider, base_url: baseUrl } : provider,
              ])
            ),
          }
        : presetConfig,
    }

    await invoke('switch_codex_account', { settings: JSON.stringify(config) })
  }
}

export const codexProviderService = new CodexProviderService()
