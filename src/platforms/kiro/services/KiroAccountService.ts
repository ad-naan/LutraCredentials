/**
 * Kiro Account Service
 *
 * Handles Kiro account operations including:
 * - Token refresh
 * - Quota checking
 * - Account status management
 * - Batch operations
 * - Machine ID binding (device fingerprint isolation)
 */

import { logError, logInfo, logWarn } from '@/lib/logger'
import { invoke } from '@tauri-apps/api/core'
import { MachineIdService } from '@/services/MachineIdService'
import type { KiroAccount, KiroAccountStatus } from '@/types/account'

export interface RefreshTokenResult {
    success: boolean
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    updatedAccount?: Partial<KiroAccount>
    error?: string
}

export interface SwitchAccountResult {
    credentials: KiroAccount['credentials']
    lastUsedAt: number
}

export interface CheckStatusResult {
    success: boolean
    status?: KiroAccountStatus
    usage?: KiroAccount['usage']
    subscription?: KiroAccount['subscription']
    email?: string
    userId?: string
    idp?: string
    newCredentials?: {
        accessToken: string
        refreshToken?: string
        expiresAt: number
    }
    error?: string
    isBanned?: boolean
}

export interface BatchRefreshResult {
    successCount: number
    failedCount: number
    results: Array<{
        id: string
        success: boolean
        data?: RefreshTokenResult
        error?: string
    }>
}

export interface BatchCheckResult {
    successCount: number
    failedCount: number
    results: Array<{
        id: string
        success: boolean
        data?: CheckStatusResult
        error?: string
    }>
}

export class KiroAccountService {
    /**
     * Switch to a Kiro account.
     * Writes credentials to the local AWS SSO cache so VS Code AWS Toolkit can use them.
     */
    static async switchAccount(account: KiroAccount): Promise<SwitchAccountResult> {
        logInfo(`[Kiro Switch] Starting switch to: ${account.email}`)

        const machineService = MachineIdService.getInstance()
        let machineId = await machineService.getMachineIdForAccount(account.id)
        const credentials = { ...account.credentials }

        if (!machineId) {
            machineId = await machineService.generateMachineId()
            await machineService.bindMachineId(account.id, machineId)
            logInfo(`[Kiro Switch] Generated and bound new machine ID for account: ${account.email}`)
        }

        if (credentials.refreshToken) {
            try {
                const tokenResult = await invoke<{
                    accessToken: string
                    refreshToken?: string
                    expiresIn: number
                }>('kiro_refresh_token', {
                    refreshToken: credentials.refreshToken,
                    clientId: credentials.clientId || '',
                    clientSecret: credentials.clientSecret || ''
                })

                credentials.accessToken = tokenResult.accessToken
                if (tokenResult.refreshToken) {
                    credentials.refreshToken = tokenResult.refreshToken
                }
                credentials.expiresAt = Date.now() + (tokenResult.expiresIn * 1000)

                logInfo('[Kiro Switch] Token refreshed successfully')
            } catch (error) {
                logWarn('[Kiro Switch] Token refresh failed, continuing with existing token:', error)
            }
        }

        try {
            await invoke('switch_kiro_account', {
                accessToken: credentials.accessToken,
                refreshToken: credentials.refreshToken || '',
                clientId: credentials.clientId || '',
                clientSecret: credentials.clientSecret || '',
                region: credentials.region,
                startUrl: undefined,
                authMethod: account.idp === 'BuilderId' ? 'IdC' : 'social',
                provider: account.idp
            })
            logInfo('[Kiro Switch] Credentials written to AWS SSO cache')
        } catch (error) {
            logError('[Kiro Switch] Failed to write SSO cache:', error)
            throw new Error(`Failed to switch Kiro account: ${error}`)
        }

        logInfo('[Kiro Switch] Switch completed successfully')

        return {
            credentials,
            lastUsedAt: Date.now()
        }
    }

    /**
     * Refresh account token and quota.
     * Returns the patch payload and lets the store decide how to persist it.
     */
    static async refreshToken(account: KiroAccount): Promise<RefreshTokenResult> {
        try {
            if (!account.credentials.refreshToken) {
                return {
                    success: false,
                    error: 'No refresh token available'
                }
            }

            const machineService = MachineIdService.getInstance()
            let machineId = await machineService.getMachineIdForAccount(account.id)

            if (!machineId) {
                machineId = await machineService.generateMachineId()
                await machineService.bindMachineId(account.id, machineId)
                logInfo(`[Kiro Refresh] Generated and bound new machine ID for account: ${account.email}`)
            }

            const tokenResult = await invoke<{
                accessToken: string
                refreshToken?: string
                expiresIn: number
            }>('kiro_refresh_token', {
                refreshToken: account.credentials.refreshToken,
                clientId: account.credentials.clientId || '',
                clientSecret: account.credentials.clientSecret || ''
            })

            const quotaResult = await invoke<any>('kiro_check_quota', {
                accessToken: tokenResult.accessToken
            })

            const now = Date.now()

            return {
                success: true,
                accessToken: tokenResult.accessToken,
                refreshToken: tokenResult.refreshToken,
                expiresIn: tokenResult.expiresIn,
                updatedAccount: {
                    credentials: {
                        ...account.credentials,
                        accessToken: tokenResult.accessToken,
                        refreshToken: tokenResult.refreshToken || account.credentials.refreshToken,
                        expiresAt: now + (tokenResult.expiresIn * 1000)
                    },
                    usage: {
                        current: quotaResult.currentUsage || 0,
                        limit: quotaResult.totalLimit || 25,
                        percentUsed: quotaResult.percentUsed || 0,
                        lastUpdated: now,
                        baseLimit: quotaResult.baseLimit,
                        baseCurrent: quotaResult.baseCurrent,
                        freeTrialLimit: quotaResult.freeTrialLimit,
                        freeTrialCurrent: quotaResult.freeTrialCurrent,
                        freeTrialExpiry: quotaResult.freeTrialExpiry,
                        bonuses: quotaResult.bonuses,
                        nextResetDate: quotaResult.nextResetDate,
                        resourceDetail: quotaResult.resourceDetail
                    },
                    subscription: {
                        type: quotaResult.subscriptionType || 'Free',
                        title: quotaResult.subscriptionTitle,
                        expiresAt: quotaResult.subscriptionExpiresAt,
                        daysRemaining: quotaResult.daysRemaining,
                        autoRenew: quotaResult.subscriptionAutoRenew
                    },
                    email: quotaResult.email || account.email,
                    userId: quotaResult.userId,
                    lastUsedAt: now
                }
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }
        }
    }

    /**
     * Check account status and quota.
     */
    static async checkStatus(account: KiroAccount): Promise<CheckStatusResult> {
        try {
            const result = await invoke<any>('kiro_check_quota', {
                accessToken: account.credentials.accessToken
            })

            const isBanned = result.error?.includes('UnauthorizedException') ||
                result.error?.includes('AccountSuspendedException')

            if (isBanned) {
                return {
                    success: false,
                    status: 'banned',
                    error: result.error,
                    isBanned: true
                }
            }

            const usage: KiroAccount['usage'] = {
                current: result.current || 0,
                limit: result.limit || 25,
                percentUsed: result.limit > 0 ? result.current / result.limit : 0,
                lastUpdated: Date.now(),
                baseLimit: result.baseLimit,
                baseCurrent: result.baseCurrent,
                freeTrialLimit: result.freeTrialLimit,
                freeTrialCurrent: result.freeTrialCurrent,
                freeTrialExpiry: result.freeTrialExpiry,
                bonuses: result.bonuses,
                nextResetDate: result.nextResetDate,
                resourceDetail: result.resourceDetail
            }

            const subscription: KiroAccount['subscription'] = {
                type: result.subscriptionType || 'Free',
                title: result.subscriptionTitle,
                expiresAt: result.subscriptionExpiresAt,
                daysRemaining: result.subscriptionDaysRemaining,
                autoRenew: result.subscriptionAutoRenew
            }

            return {
                success: true,
                status: 'active',
                usage,
                subscription,
                email: result.email,
                userId: result.userId,
                idp: result.idp
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            const isBanned = errorMessage.includes('UnauthorizedException') ||
                errorMessage.includes('AccountSuspendedException')

            return {
                success: false,
                status: isBanned ? 'banned' : 'error',
                error: errorMessage,
                isBanned
            }
        }
    }

    /**
     * Batch refresh tokens (background operation).
     */
    static async batchRefresh(
        accounts: Array<{
            id: string
            email: string
            credentials: KiroAccount['credentials']
        }>,
        concurrency: number = 10
    ): Promise<BatchRefreshResult> {
        try {
            return await invoke<BatchRefreshResult>('kiro_batch_refresh', {
                accounts,
                concurrency
            })
        } catch (error) {
            return {
                successCount: 0,
                failedCount: accounts.length,
                results: accounts.map(acc => ({
                    id: acc.id,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }))
            }
        }
    }

    /**
     * Batch check account status (background operation).
     */
    static async batchCheck(
        accounts: Array<{
            id: string
            email: string
            credentials: KiroAccount['credentials']
            idp?: string
        }>,
        concurrency: number = 10
    ): Promise<BatchCheckResult> {
        try {
            return await invoke<BatchCheckResult>('kiro_batch_check', {
                accounts,
                concurrency
            })
        } catch (error) {
            return {
                successCount: 0,
                failedCount: accounts.length,
                results: accounts.map(acc => ({
                    id: acc.id,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                }))
            }
        }
    }

    /**
     * 判断凭据是否即将过期。
     *
     * @param leadMs 提前量（毫秒）。自动刷新调度会传入当前刷新间隔，
     *   确保「下一次检查前会过期」的令牌被提前刷新；默认 5 分钟。
     */
    static isTokenExpiring(account: KiroAccount, leadMs = 5 * 60 * 1000): boolean {
        if (!account.credentials.expiresAt) return false
        return account.credentials.expiresAt - Date.now() <= leadMs
    }

    /**
     * Check if token is expired.
     */
    static isTokenExpired(account: KiroAccount): boolean {
        if (!account.credentials.expiresAt) return false
        return Date.now() >= account.credentials.expiresAt
    }
}
