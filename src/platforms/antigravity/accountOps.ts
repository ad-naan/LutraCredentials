/**
 * Antigravity 平台账号操作契约实现
 */
import type { AccountOpResult, PlatformAccountOps } from '@/types/platform'
import type { AntigravityAccount } from '@/types/account'
import { AntigravityAccountService } from './services/AntigravityAccountService'

export const antigravityAccountOps: PlatformAccountOps = {
  async switchAccount(account) {
    return AntigravityAccountService.switchAccount(account as AntigravityAccount)
  },

  async refresh(account): Promise<AccountOpResult> {
    const patch = await AntigravityAccountService.refreshAccount(account as AntigravityAccount)
    return { success: true, patch }
  },

  isExpiring(account, leadMs) {
    return AntigravityAccountService.isTokenExpiring(account as AntigravityAccount, leadMs)
  },
}
