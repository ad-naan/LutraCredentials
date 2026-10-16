/**
 * Codex 平台账号服务
 *
 * 保持**无副作用**：只调用后端命令并返回需要合并回账号的补丁，
 * 具体持久化由 usePlatformStore 的通用账号操作统一完成。
 */

import { logError, logInfo } from '@/lib/logger'
import { invoke } from '@tauri-apps/api/core'
import type { CodexAccount, CodexOAuthData, CodexUsage } from '@/types/account'

export class CodexAccountService {
  /**
   * 用 refresh_token 换取新的 access_token。
   * 失败时抛出，由调用方决定是否沿用旧凭据。
   */
  static async refreshOAuth(oauth: CodexOAuthData): Promise<CodexOAuthData> {
    const refreshed = await invoke<CodexOAuthData>('codex_oauth_refresh', {
      refreshToken: oauth.refresh_token,
      idToken: oauth.id_token,
    })
    return refreshed?.access_token ? { ...oauth, ...refreshed } : oauth
  }

  /**
   * 切换账号（返回补丁）：
   * - ChatGPT OAuth 账号：先刷新凭据，再以托管格式写 auth.json
   * - API Key / 第三方中转账号：写 auth.json + config.toml
   */
  static async switchAccount(account: CodexAccount): Promise<Partial<CodexAccount>> {
    if (account.oauth) {
      let oauth = account.oauth
      try {
        oauth = await CodexAccountService.refreshOAuth(oauth)
      } catch (error) {
        // 刷新失败时沿用现有凭据继续切换
        logError('[Codex Switch] Failed to refresh OAuth token:', error)
      }

      await invoke('codex_oauth_switch', { credentials: JSON.stringify(oauth) })
      logInfo(`[Codex Switch] auth.json written for ${account.email}`)
      return { oauth }
    }

    if (!account.config) {
      throw new Error('Configuration not found in account')
    }

    await invoke('switch_codex_account', { settings: JSON.stringify(account.config) })
    logInfo(`[Codex Switch] auth.json + config.toml updated for ${account.email}`)
    return {}
  }

  /**
   * 刷新账号：OAuth 账号刷新凭据并查询订阅状态。
   * 非 OAuth 账号无可刷新内容，返回 `null`。
   */
  static async refreshAccount(account: CodexAccount): Promise<Partial<CodexAccount> | null> {
    if (!account.oauth) return null

    const oauth = await CodexAccountService.refreshOAuth(account.oauth)
    const usage = await invoke<CodexUsage>('codex_check_quota', {
      accessToken: oauth.access_token,
      accountId: oauth.account_id || null,
    })

    return { oauth, usage }
  }
}
