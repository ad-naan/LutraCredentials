/**
 * Claude 平台账号服务
 *
 * 保持**无副作用**：只调用后端命令并返回需要合并回账号的补丁，
 * 具体持久化由 usePlatformStore 的通用账号操作统一完成。
 * 这样既能被 accountOps 契约复用，也避免了服务层反向依赖 store。
 */

import { logError, logInfo } from '@/lib/logger'
import { invoke } from '@tauri-apps/api/core'
import type { ClaudeAccount, ClaudeOAuthData, ClaudeUsage } from '@/types/account'

export interface ClaudeVerifyResult {
  valid: boolean
  message: string
}

export class ClaudeAccountService {
  /**
   * 用 refresh_token 换取新的 access_token。
   * 失败时抛出，由调用方决定是否沿用旧凭据。
   */
  static async refreshOAuth(oauth: ClaudeOAuthData): Promise<ClaudeOAuthData> {
    const refreshed = await invoke<ClaudeOAuthData>('claude_oauth_refresh', {
      refreshToken: oauth.refresh_token,
    })
    return refreshed?.access_token ? { ...oauth, ...refreshed } : oauth
  }

  /**
   * 切换账号（返回补丁）：
   * - 官方 OAuth 账号：先刷新凭据，再写入 `.credentials.json`
   * - API Key / 中转站账号：把 env 写入 settings.json
   */
  static async switchAccount(account: ClaudeAccount): Promise<Partial<ClaudeAccount>> {
    if (account.oauth) {
      let oauth = account.oauth
      try {
        oauth = await ClaudeAccountService.refreshOAuth(oauth)
      } catch (error) {
        // 刷新失败时沿用现有凭据继续切换
        logError('[Claude Switch] Failed to refresh OAuth token:', error)
      }

      await invoke('claude_oauth_switch', { credentials: JSON.stringify(oauth) })
      logInfo(`[Claude Switch] OAuth credentials written for ${account.email}`)
      return { oauth }
    }

    if (!account.config) {
      throw new Error('API Key not found in account config')
    }

    await invoke('switch_claude_account', { settings: JSON.stringify(account.config) })
    logInfo(`[Claude Switch] settings.json updated for ${account.email}`)
    return {}
  }

  /**
   * 刷新账号：OAuth 账号刷新凭据并拉取订阅用量。
   * 非 OAuth 账号无可刷新内容，返回 `null`。
   */
  static async refreshAccount(account: ClaudeAccount): Promise<Partial<ClaudeAccount> | null> {
    if (!account.oauth) return null

    const oauth = await ClaudeAccountService.refreshOAuth(account.oauth)
    const usage = await invoke<ClaudeUsage>('claude_oauth_usage', {
      accessToken: oauth.access_token,
    })

    return { oauth, usage, lastUsedAt: Date.now() }
  }

  /** 校验 API Key / 中转站配置是否可用。 */
  static async verifyApiKey(account: ClaudeAccount): Promise<ClaudeVerifyResult> {
    const env = account.config?.env
    const apiKey = env?.ANTHROPIC_API_KEY || env?.ANTHROPIC_AUTH_TOKEN
    if (!apiKey) {
      throw new Error('API Key not found in account config')
    }

    return await invoke<ClaudeVerifyResult>('verify_claude_api_key', {
      apiKey,
      baseUrl: env?.ANTHROPIC_BASE_URL,
    })
  }

  /**
   * OAuth access token 是否会在 leadMs 内过期。
   *
   * @param leadMs 提前量（毫秒）。自动刷新调度会传入当前刷新间隔，
   *   确保「下一次检查前会过期」的令牌被提前刷新；默认 5 分钟。
   */
  static isTokenExpiring(account: ClaudeAccount, leadMs = 5 * 60 * 1000): boolean {
    const expiresAt = account.oauth?.expires_at
    if (!expiresAt) return false
    return expiresAt - Date.now() <= leadMs
  }
}
