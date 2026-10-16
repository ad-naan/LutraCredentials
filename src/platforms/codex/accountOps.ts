/**
 * Codex 平台账号操作契约实现
 *
 * 让 Codex 账号与其它平台共用 store 的统一调度：一键切号与刷新凭据。
 *
 * 注意：Codex OAuth 凭据不携带过期时间，因此这里**不实现** `isExpiring`，
 * 即 Codex 账号不参与后台自动刷新（无法判断何时需要续期）。
 */
import type { AccountOpResult, PlatformAccountOps } from '@/types/platform'
import type { CodexAccount } from '@/types/account'
import { CodexAccountService } from './services/CodexAccountService'

export const codexAccountOps: PlatformAccountOps = {
  async switchAccount(account) {
    return CodexAccountService.switchAccount(account as CodexAccount)
  },

  async refresh(account): Promise<AccountOpResult> {
    const codex = account as CodexAccount

    // API Key / 第三方中转账号没有可续期的凭据
    if (!codex.oauth) {
      return {
        success: false,
        error: '当前账号为 API Key 模式，无凭据可刷新',
      }
    }

    try {
      const patch = await CodexAccountService.refreshAccount(codex)
      return { success: true, patch: (patch ?? {}) as Partial<CodexAccount> }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  },
}