/**
 * Claude 平台账号操作契约实现
 *
 * 让 Claude 账号与其它平台共用 store 的统一调度：
 * 一键切号、刷新凭据，以及后台自动刷新（OAuth 凭据过期前续期）。
 */
import type { AccountOpResult, PlatformAccountOps } from '@/types/platform'
import type { ClaudeAccount } from '@/types/account'
import { ClaudeAccountService } from './services/ClaudeAccountService'

export const claudeAccountOps: PlatformAccountOps = {
  async switchAccount(account) {
    return ClaudeAccountService.switchAccount(account as ClaudeAccount)
  },

  async refresh(account): Promise<AccountOpResult> {
    const claude = account as ClaudeAccount

    // API Key / 中转站账号没有可续期的凭据，不参与自动刷新
    if (!claude.oauth) {
      return {
        success: false,
        error: '当前账号为 API Key 模式，无凭据可刷新',
      }
    }

    try {
      const patch = await ClaudeAccountService.refreshAccount(claude)
      return { success: true, patch: (patch ?? {}) as Partial<ClaudeAccount> }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },

  isExpiring(account, leadMs) {
    return ClaudeAccountService.isTokenExpiring(account as ClaudeAccount, leadMs)
  },
}
