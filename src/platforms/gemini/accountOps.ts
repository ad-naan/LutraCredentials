/**
 * Gemini 平台账号操作契约实现
 *
 * Gemini 为纯配置型平台，只提供一键切号；
 * 没有凭据刷新与过期判定，因此不实现 `refresh` / `isExpiring`，
 * 也不参与后台自动刷新。
 */
import type { PlatformAccountOps } from '@/types/platform'
import type { GeminiAccount } from '@/types/account'
import { GeminiAccountService } from './services/GeminiAccountService'

export const geminiAccountOps: PlatformAccountOps = {
  async switchAccount(account) {
    return GeminiAccountService.switchAccount(account as GeminiAccount)
  },
}
