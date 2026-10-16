/**
 * Kiro 平台账号操作契约实现
 *
 * 把原先硬编码在 usePlatformStore 中的 Kiro 专属逻辑（切号 / 刷新 / 状态检测）
 * 下沉到平台层，通过统一的 PlatformAccountOps 契约暴露给 store。
 */
import type { AccountOpResult, PlatformAccountOps } from '@/types/platform'
import type { KiroAccount } from '@/types/account'
import { KiroAccountService } from './services/KiroAccountService'

export const kiroAccountOps: PlatformAccountOps = {
  async switchAccount(account) {
    const result = await KiroAccountService.switchAccount(account as KiroAccount)
    const patch: Partial<KiroAccount> = {
      credentials: result.credentials,
      lastUsedAt: result.lastUsedAt,
    }
    return patch
  },

  async refresh(account): Promise<AccountOpResult> {
    const kiro = account as KiroAccount
    const result = await KiroAccountService.refreshToken(kiro)
    const checkedAt = Date.now()

    if (result.success && result.updatedAccount) {
      return {
        success: true,
        patch: {
          ...result.updatedAccount,
          status: 'active',
          lastError: undefined,
          lastCheckedAt: checkedAt,
        } as Partial<KiroAccount>,
      }
    }

    return {
      success: false,
      error: result.error,
      patch: {
        status: 'error',
        lastError: result.error,
        lastCheckedAt: checkedAt,
      } as Partial<KiroAccount>,
    }
  },

  async checkStatus(account): Promise<AccountOpResult> {
    const kiro = account as KiroAccount
    const result = await KiroAccountService.checkStatus(kiro)

    if (result.success) {
      const patch: Partial<KiroAccount> = {
        status: result.status || 'active',
        usage: result.usage || kiro.usage,
        subscription: result.subscription || kiro.subscription,
        email: result.email || kiro.email,
        userId: result.userId || kiro.userId,
        lastCheckedAt: Date.now(),
        lastError: undefined,
      }

      if (result.newCredentials) {
        patch.credentials = {
          ...kiro.credentials,
          accessToken: result.newCredentials.accessToken,
          refreshToken: result.newCredentials.refreshToken || kiro.credentials.refreshToken,
          expiresAt: result.newCredentials.expiresAt,
        }
      }

      return { success: true, patch }
    }

    return {
      success: false,
      error: result.error,
      patch: {
        status: result.isBanned ? 'banned' : 'error',
        lastError: result.error,
        lastCheckedAt: Date.now(),
      } as Partial<KiroAccount>,
    }
  },

  isExpiring(account, leadMs) {
    const kiro = account as KiroAccount
    return KiroAccountService.isTokenExpiring(kiro, leadMs) || KiroAccountService.isTokenExpired(kiro)
  },
}
