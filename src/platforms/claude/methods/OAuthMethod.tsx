/**
 * Claude 平台 - 官方 OAuth 登录
 *
 * 授权码手动复制流程（与 Claude Code CLI 一致）：
 * 1. 打开授权页面并完成登录授权
 * 2. 将回调页面展示的授权码粘贴回来，完成登录
 */

import { logError, logInfo } from '@/lib/logger'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ExternalLink, Loader2, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AddMethodProps } from '@/types/platform'
import type { ClaudeAccount, ClaudeOAuthData, ClaudeUsage } from '@/types/account'

type Status = 'idle' | 'authorizing' | 'processing' | 'success' | 'error'

interface OAuthSession {
  state: string
  codeVerifier: string
  url: string
}

interface ExchangeResult {
  tokens: ClaudeOAuthData & { scopes?: string[] }
  profile: { email?: string; name?: string; accountUuid?: string }
}

export function OAuthMethod({ onSuccess, onError, onClose }: AddMethodProps) {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language === 'en'

  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [session, setSession] = useState<OAuthSession | null>(null)
  const [authCode, setAuthCode] = useState('')

  const handleStart = async () => {
    setStatus('authorizing')
    setMessage('')

    try {
      const result = await invoke<OAuthSession>('claude_oauth_start')
      setSession(result)
      await openUrl(result.url)
      setStatus('idle')
      logInfo('[Claude OAuth] Authorization page opened')
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message || String(e))
      onError(e?.message || String(e))
    }
  }

  const handleComplete = async () => {
    const code = authCode.trim()
    if (!session || !code) {
      setStatus('error')
      setMessage(isEn ? 'Please paste the authorization code' : '请粘贴授权码')
      return
    }

    setStatus('processing')
    setMessage('')

    try {
      const { tokens, profile } = await invoke<ExchangeResult>('claude_oauth_exchange', {
        code,
        state: session.state,
        codeVerifier: session.codeVerifier,
      })

      // 尽力获取订阅用量，失败不影响登录
      let usage: ClaudeUsage | undefined
      try {
        usage = await invoke<ClaudeUsage>('claude_oauth_usage', {
          accessToken: tokens.access_token,
        })
      } catch (e) {
        logError('[Claude OAuth] Failed to fetch usage:', e)
      }

      const account: ClaudeAccount = {
        id: crypto.randomUUID(),
        platform: 'claude',
        email: profile.email || 'unknown@claude.ai',
        name: profile.name || 'Claude Subscription',
        isActive: false,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
        oauth: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_at,
          scopes: tokens.scopes,
        },
        usage,
      }

      onSuccess(account)
      setStatus('success')
      setMessage(isEn ? 'Account added successfully!' : '账号添加成功！')
      setTimeout(onClose, 1200)
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message || String(e))
      onError(e?.message || String(e))
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t('platforms.claude.oauth.title', isEn ? 'Official OAuth Login' : '官方 OAuth 登录')}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            'claude.oauth.description',
            isEn
              ? 'Log in with your Claude subscription account (Pro/Max). After authorizing, paste the code shown on the redirect page.'
              : '使用 Claude 订阅账号（Pro/Max）登录。授权完成后，将跳转页面展示的授权码粘贴回来。'
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Button
          onClick={handleStart}
          disabled={status === 'authorizing' || status === 'processing'}
          className="w-full"
        >
          {status === 'authorizing' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          {t('platforms.claude.oauth.openPage', isEn ? 'Open Authorization Page' : '打开授权页面')}
        </Button>

        {session && (
          <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
            <Label htmlFor="claude-auth-code" className="text-xs text-muted-foreground">
              {t('platforms.claude.oauth.codeLabel', isEn ? 'Authorization Code' : '授权码')}
            </Label>
            <Input
              id="claude-auth-code"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
              placeholder={isEn ? 'Paste the code here' : '在此粘贴授权码'}
              disabled={status === 'processing'}
            />
            <Button
              onClick={handleComplete}
              disabled={status === 'processing' || !authCode.trim()}
              className="w-full"
            >
              {status === 'processing' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              {t('platforms.claude.oauth.complete', isEn ? 'Complete Login' : '完成登录')}
            </Button>
          </div>
        )}

        {message && (
          <div
            className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
              status === 'error'
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : status === 'success'
                  ? 'border-green-500/30 bg-green-500/5 text-green-600'
                  : 'border-border bg-muted/40 text-muted-foreground'
            }`}
          >
            {status === 'error' ? (
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : status === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : null}
            <span className="break-all">{message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
