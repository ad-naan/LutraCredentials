/**
 * Gemini 平台账号服务
 *
 * 保持**无副作用**：只调用后端命令并返回需要合并回账号的补丁，
 * 具体持久化由 usePlatformStore 的通用账号操作统一完成。
 *
 * Gemini 是纯配置型平台（env / config.json / settings.json），
 * 没有可续期的凭据，因此不支持刷新，也不参与后台自动刷新。
 */

import { logInfo } from '@/lib/logger'
import { invoke } from '@tauri-apps/api/core'
import type { GeminiAccount } from '@/types/account'

export class GeminiAccountService {
  /**
   * 切换账号（返回补丁）：
   * 把 provider 配置写入本地 env / config.json / settings.json。
   */
  static async switchAccount(account: GeminiAccount): Promise<Partial<GeminiAccount>> {
    const config = account.config
    if (!config) {
      throw new Error('Configuration not found in account')
    }

    await invoke('switch_gemini_account', { settings: JSON.stringify(config) })
    logInfo(`[Gemini Switch] Configuration written for ${account.email}`)
    return {}
  }
}
