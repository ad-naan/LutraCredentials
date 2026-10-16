/**
 * Kiro 平台 - Token 导入方式
 * 
 * 支持 SSO Token 和 OIDC 凭证批量导入
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import type { AddMethodProps } from '@/types/platform'
import type { KiroAccount } from '@/types/account'
import { cn } from '@/lib/utils'

type Status = 'idle' | 'processing' | 'success' | 'error'
type ImportType = 'sso' | 'oidc'

export function TokenImportMethod({ onSuccess, onError, onClose }: AddMethodProps) {
    const { t } = useTranslation()
    const isEn = t('app.name') !== 'Lutra 账号管理器'

    const [importType, setImportType] = useState<ImportType>('sso')
    const [status, setStatus] = useState<Status>('idle')
    const [message, setMessage] = useState('')
    const [tokenInput, setTokenInput] = useState('')
    const [progress, setProgress] = useState({ current: 0, total: 0 })

    const handleSubmit = async () => {
        const trimmed = tokenInput.trim()
        if (!trimmed) {
            setMessage(t('platforms.kiro.auth.tokenImport.enterToken'))
            return
        }

        setStatus('processing')

        if (importType === 'sso') {
            await handleSsoImport(trimmed)
        } else {
            await handleOidcImport(trimmed)
        }
    }

    const handleSsoImport = async (input: string) => {
        // 按行分割
        const tokens = input.split('\n').map(t => t.trim()).filter(t => t.length > 0)
        setProgress({ current: 0, total: tokens.length })
        setMessage(t('platforms.kiro.auth.tokenImport.processing', { count: tokens.length }))

        let successCount = 0
        const errors: string[] = []

        for (let i = 0; i < tokens.length; i++) {
            setProgress({ current: i + 1, total: tokens.length })

            try {
                const result = await invoke<any>('kiro_import_sso_token', {
                    token: tokens[i]
                })
                
                // Transform backend account to frontend KiroAccount
                const kiroAccount: KiroAccount = {
                    id: result.id,
                    platform: 'kiro',
                    email: result.email,
                    name: result.name,
                    isActive: false,
                    lastUsedAt: Date.now(),
                    createdAt: Date.now(),
                    idp: 'Enterprise', // SSO tokens are typically enterprise
                    credentials: {
                        accessToken: result.accessToken,
                        authMethod: 'sso'
                    },
                    subscription: {
                        type: result.quota?.subscriptionType || 'Free',
                        title: result.quota?.subscriptionTitle
                    },
                    usage: {
                        current: result.quota?.currentUsage || 0,
                        limit: result.quota?.totalLimit || 25,
                        percentUsed: result.quota?.totalLimit > 0
                            ? (result.quota.currentUsage || 0) / result.quota.totalLimit
                            : 0,
                        lastUpdated: Date.now()
                    },
                    status: 'active',
                    lastCheckedAt: Date.now()
                }
                
                onSuccess(kiroAccount)
                successCount++
            } catch (e: any) {
                errors.push(`#${i + 1}: ${e.message || 'Failed'}`)
            }
        }

        finishImport(successCount, tokens.length, errors)
    }

    const handleOidcImport = async (input: string) => {
        // 解析 JSON
        let credentials: any[]
        try {
            const parsed = JSON.parse(input)
            credentials = Array.isArray(parsed) ? parsed : [parsed]
        } catch {
            setStatus('error')
            setMessage(t('platforms.kiro.auth.tokenImport.invalidJson'))
            return
        }

        setProgress({ current: 0, total: credentials.length })
        setMessage(t('platforms.kiro.auth.tokenImport.processingCredentials', { count: credentials.length }))

        let successCount = 0
        const errors: string[] = []

        for (let i = 0; i < credentials.length; i++) {
            setProgress({ current: i + 1, total: credentials.length })

            try {
                const result = await invoke<any>('kiro_verify_credentials', {
                    credentials: credentials[i]
                })
                
                // Transform backend account to frontend KiroAccount
                const kiroAccount: KiroAccount = {
                    id: result.id,
                    platform: 'kiro',
                    email: result.email,
                    name: result.name,
                    isActive: false,
                    lastUsedAt: Date.now(),
                    createdAt: Date.now(),
                    idp: 'BuilderId', // OIDC credentials are typically BuilderId
                    credentials: {
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken,
                        clientId: result.clientId,
                        clientSecret: result.clientSecret,
                        expiresAt: result.expiresIn ? Date.now() + result.expiresIn * 1000 : undefined,
                        authMethod: 'oidc',
                        region: credentials[i].region || 'us-east-1'
                    },
                    subscription: {
                        type: result.quota?.subscriptionType || 'Free',
                        title: result.quota?.subscriptionTitle
                    },
                    usage: {
                        current: result.quota?.currentUsage || 0,
                        limit: result.quota?.totalLimit || 25,
                        percentUsed: result.quota?.totalLimit > 0
                            ? (result.quota?.currentUsage || 0) / result.quota.totalLimit
                            : 0,
                        lastUpdated: Date.now()
                    },
                    status: 'active',
                    lastCheckedAt: Date.now()
                }
                
                onSuccess(kiroAccount)
                successCount++
            } catch (e: any) {
                const errorMsg = e.message || e || 'Failed'
                // 提供更友好的错误提示
                let friendlyError = errorMsg
                if (errorMsg.includes('Token 刷新失败')) {
                    friendlyError = t('platforms.kiro.auth.tokenImport.tokenRefreshFailed')
                } else if (errorMsg.includes('缺少')) {
                    friendlyError = t('platforms.kiro.auth.tokenImport.missingField')
                }
                errors.push(`#${i + 1}: ${friendlyError}`)
            }
        }

        finishImport(successCount, credentials.length, errors)
    }

    const finishImport = (success: number, total: number, errors: string[]) => {
        if (success === total) {
            setStatus('success')
            setMessage(t('platforms.kiro.auth.tokenImport.addedSuccess', { count: success }))
            setTimeout(onClose, 1500)
        } else if (success > 0) {
            setStatus('success')
            setMessage(t('platforms.kiro.auth.tokenImport.addedPartial', { success, total }))
        } else {
            setStatus('error')
            setMessage(errors[0] || t('platforms.kiro.auth.tokenImport.allFailed'))
            onError(errors.join('\n'))
        }
    }

    return (
        <div className="space-y-4">
            <Tabs value={importType} onValueChange={(v) => setImportType(v as ImportType)}>
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="sso">{t('platforms.kiro.auth.tokenImport.ssoToken')}</TabsTrigger>
                    <TabsTrigger value="oidc">{t('platforms.kiro.auth.tokenImport.oidcCredentials')}</TabsTrigger>
                </TabsList>
            </Tabs>

            <div className="space-y-2">
                <Label>
                    {importType === 'sso'
                        ? t('platforms.kiro.auth.tokenImport.ssoTokensLabel')
                        : t('platforms.kiro.auth.tokenImport.oidcCredentialsLabel')}
                </Label>
                <textarea
                    className="w-full h-32 rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    placeholder={importType === 'sso'
                        ? 'eyJhbGciOiJSUz...\neyJhbGciOiJSUz...'
                        : isEn 
                            ? '{\n  "clientId": "amzn1.application...",\n  "clientSecret": "amzn1.oa2-cs...",\n  "refreshToken": "Atzr|..."\n}'
                            : '{\n  "clientId": "amzn1.application...",\n  "clientSecret": "amzn1.oa2-cs...",\n  "refreshToken": "Atzr|..."\n}'}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    disabled={status === 'processing'}
                />
                {importType === 'oidc' && (
                    <p className="text-xs text-muted-foreground">
                        {t('platforms.kiro.auth.tokenImport.requiredFields')}
                    </p>
                )}
            </div>

            <Button
                className="w-full"
                onClick={handleSubmit}
                disabled={status === 'processing' || !tokenInput.trim()}
            >
                {status === 'processing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {status === 'processing'
                    ? `${progress.current}/${progress.total}`
                    : t('platforms.kiro.auth.tokenImport.import')}
            </Button>

            {/* Status Message */}
            {message && (
                <div className={cn(
                    "flex items-center gap-2 p-3 rounded-lg text-sm",
                    status === 'success' && "bg-green-500/10 text-green-600",
                    status === 'error' && "bg-red-500/10 text-red-600",
                    status === 'processing' && "bg-blue-500/10 text-blue-600"
                )}>
                    {status === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
                    {status === 'error' && <AlertCircle className="h-4 w-4 shrink-0" />}
                    {status === 'processing' && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                    <span>{message}</span>
                </div>
            )}
        </div>
    )
}
