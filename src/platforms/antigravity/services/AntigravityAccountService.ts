/**
 * Antigravity 平台账号服务
 *
 * 该服务保持**无副作用**：只调用后端命令并返回需要合并回账号的补丁（patch），
 * 具体持久化由 usePlatformStore 的通用账号操作统一完成。
 * 这样既能被 accountOps 契约复用，也避免了服务层反向依赖 store。
 */

import { logInfo } from '@/lib/logger'
import { invoke } from '@tauri-apps/api/core'
import type { AntigravityAccount, AntigravityQuotaData } from '@/types/account'
import { MachineIdService } from '@/services/MachineIdService'

export class AntigravityAccountService {
  /**
   * 切换账号（返回补丁）：
   * 1. 调用后端切换命令（关闭 IDE / 注入 Token 到数据库 / 重启 IDE）
   * 2. 确保账号有绑定的机器码（设备指纹隔离）
   * 3. 返回刷新后的 token 补丁
   */
  static async switchAccount(account: AntigravityAccount): Promise<Partial<AntigravityAccount>> {
    logInfo(`[Switch] Starting switch to: ${account.email}`)

    const tokenResponse = await invoke<{
      access_token: string
      expires_in: number
      token_type: string
    }>('antigravity_switch_account', {
      accountId: account.id,
      refreshToken: account.token.refresh_token,
      email: account.email,
    })

    logInfo('[Switch] Backend switch completed successfully')

    const machineService = MachineIdService.getInstance()
    const machineId = await machineService.getMachineIdForAccount(account.id)
    if (!machineId) {
      await machineService.bindMachineId(account.id, await machineService.generateMachineId())
      logInfo(`[Switch] Bound new machine ID for account: ${account.email}`)
    }

    const now = Date.now()
    return {
      token: {
        ...account.token,
        access_token: tokenResponse.access_token,
        expires_in: tokenResponse.expires_in,
        expiry_timestamp: now + tokenResponse.expires_in * 1000,
      },
    }
  }

  /**
   * 刷新账号配额（返回补丁）：
   * 1. 刷新 access token
   * 2. 获取最新配额信息
   */
  static async refreshAccount(account: AntigravityAccount): Promise<Partial<AntigravityAccount>> {
    const tokenResponse = await invoke<{
      access_token: string
      expires_in: number
      token_type: string
    }>('antigravity_refresh_token', {
      refreshToken: account.token.refresh_token,
    })

    const quotaData = await invoke<AntigravityQuotaData>('antigravity_get_quota', {
      accessToken: tokenResponse.access_token,
    })

    const now = Date.now()
    return {
      token: {
        ...account.token,
        access_token: tokenResponse.access_token,
        expires_in: tokenResponse.expires_in,
        expiry_timestamp: now + tokenResponse.expires_in * 1000,
      },
      quota: quotaData,
      is_forbidden: quotaData?.is_forbidden || false,
      lastUsedAt: now,
    }
  }

  /**
   * 判断 access token 是否即将过期。
   *
   * 用于自动刷新调度：`leadMs` 由调度器按当前刷新间隔传入，
   * 保证在下一次检查前会失效的令牌被提前刷新；默认 5 分钟。
   */
  static isTokenExpiring(account: AntigravityAccount, leadMs = 5 * 60 * 1000): boolean {
    const expiry = account.token?.expiry_timestamp
    if (!expiry) return false
    return expiry - Date.now() <= leadMs
  }
}
