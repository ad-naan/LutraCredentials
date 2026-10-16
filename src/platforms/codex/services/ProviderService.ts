import { invoke } from '@tauri-apps/api/core'
import { CodexProviderPreset } from '@/types/provider'
import { CodexConfig } from '@/types/account'

export class CodexProviderService {
  /**
   * 应用供应商预设：
   * 预设完整定义 auth.json + config.toml 内容，注入 API Key 后
   * 走与账号切换相同的原子写路径（switch_codex_account）。
   */
  async applyProvider(preset: CodexProviderPreset, apiKey: string): Promise<void> {
    const config: CodexConfig = {
      auth: {
        ...preset.config.auth,
        OPENAI_API_KEY: apiKey,
      },
      config: preset.config.config,
    }

    await invoke('switch_codex_account', { settings: JSON.stringify(config) })
  }
}

export const codexProviderService = new CodexProviderService()
