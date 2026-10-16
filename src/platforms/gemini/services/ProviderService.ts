import { invoke } from '@tauri-apps/api/core'
import { GeminiProviderPreset } from '@/types/provider'
import { GeminiConfig } from '@/types/account'

export class GeminiProviderService {
  /**
   * 应用供应商预设：
   * 保留用户现有的 config.json / settings.json，整体替换 `.env`
   * （避免残留上一个供应商的 BASE_URL），走原子写路径（switch_gemini_account）。
   */
  async applyProvider(
    preset: GeminiProviderPreset,
    apiKey: string,
    baseUrl?: string
  ): Promise<void> {
    const current = await invoke<GeminiConfig>('get_gemini_config')

    const config: GeminiConfig = {
      ...current,
      env: {
        ...preset.config.env,
        ...(baseUrl ? { GOOGLE_GEMINI_BASE_URL: baseUrl } : {}),
        GEMINI_API_KEY: apiKey,
      },
    }

    await invoke('switch_gemini_account', { settings: JSON.stringify(config) })
  }
}

export const geminiProviderService = new GeminiProviderService()
