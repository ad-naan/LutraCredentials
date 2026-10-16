import { invoke } from '@tauri-apps/api/core'
import { ClaudeProviderPreset } from '@/types/provider'
import { ClaudeEnvConfig } from '@/types/account'

export class ClaudeProviderService {
  /**
   * 应用供应商预设：
   * 读取当前 ~/.claude/settings.json，保留用户已有的顶层配置（permissions 等），
   * 仅整体替换 `env` 块（避免残留上一个供应商的 BASE_URL）。
   */
  async applyProvider(preset: ClaudeProviderPreset, apiKey: string): Promise<void> {
    const current = await invoke<Record<string, unknown>>('get_claude_config')

    const config: ClaudeEnvConfig & Record<string, unknown> = {
      ...current,
      env: {
        ...preset.config.env,
        ANTHROPIC_AUTH_TOKEN: apiKey,
      },
    }

    await invoke('switch_claude_account', { settings: JSON.stringify(config) })
  }
}

export const claudeProviderService = new ClaudeProviderService()
