/**
 * Codex 平台 - ChatGPT 官方 OAuth 登录
 *
 * Device Code 流程（与官方 Codex CLI 一致）：
 * 1. 获取用户码，在 auth.openai.com/codex/device 输入并授权
 * 2. 前端按 interval 自动轮询，授权完成后自动换取 token
 */

import { logError, logInfo } from '@/lib/logger'
import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AddMethodProps } from '@/types/platform'
import type { CodexAccount, CodexOAuthData, CodexUsage } from '@/types/account'

type Status = 'idle' | 'polling' | 'processing' | 'success' | 'error'

interface DeviceSession {
  deviceAuthId: string
  userCode: string
  verificationUrl: string
  interval: number
}

type PollResult = { status: 'pending' } | { status: 'authorized'; authorizationCode: string; codeVerifier: string }

export function OAuthMethod({ onSuccess, onError, onClose }: AddMethodProps) {
  const { t, i18n } = useTranslation()
  const isEn = i18n.language === 'en'

  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [session, setSession] = useState<DeviceSession | null>(null)
  const sessionRef = useRef<DeviceSession | null>(null)

  // 防止对话框关闭后继续轮询
  useEffect(() => {
    return () => {
      sessionRef.current = null
    }
  }, [])

  const completeLogin = async (authorizationCode: string, codeVerifier: string) => {
    setStatus('processing')
    sessionRef.current = null

    try {
      const tokens = await invoke<CodexOAuthData & { email?: string }>('codex_oauth_complete', {
        authorizationCode,
        codeVerifier,
      })

      let usage: CodexUsage | undefined
      try {
        usage = await invoke<CodexUsage>('codex_check_quota', {
          accessToken: tokens.access_token,
          accountId: tokens.account_id || null,
        })
      } catch (e) {
        logError('[Codex OAuth] Failed to fetch account check:', e)
      }

      const account: CodexAccount = {
        id: crypto.randomUUID(),
        platform: 'codex',
        email: tokens.email || 'unknown@chatgpt.com',
        name: 'ChatGPT',
        isActive: false,
        lastUsedAt: Date.now(),
        createdAt: Date.now(),
        oauth: {
          id_token: tokens.id_token,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          account_id: tokens.account_id,
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

  const pollOnce = async (session: DeviceSession) => {
    try {
      const result = await invoke<PollResult>('codex_oauth_poll', {
        deviceAuthId: session.deviceAuthId,
        userCode: session.userCode,
      })

      if (sessionRef.current?.deviceAuthId !== session.deviceAuthId) return
      if (result.status === 'authorized') {
        logInfo('[Codex OAuth] Authorization confirmed')
        await completeLogin(result.authorizationCode, result.codeVerifier)
      }
    } catch (e: any) {
      if (sessionRef.current?.deviceAuthId !== session.deviceAuthId) return
      setStatus('error')
      setMessage(e?.message || String(e))
      onError(e?.message || String(e))
    }
  }

  const handleStart = async () => {
    setStatus('polling')
    setMessage('')

    try {
      const result = await invoke<DeviceSession>('codex_oauth_start')
      setSession(result)
      sessionRef.current = result
      await openUrl(result.verificationUrl)
      logInfo('[Codex OAuth] Device authorization started')

      // 自动轮询直到授权完成/过期/组件卸载
      const poll = async () => {
        while (sessionRef.current?.deviceAuthId === result.deviceAuthId) {
          await pollOnce(result)
          if (sessionRef.current?.deviceAuthId !== result.deviceAuthId) break
          await new Promise((r) => setTimeout(r, result.interval * 1000))
        }
      }
      poll()
    } catch (e: any) {
      setStatus('error')
      setMessage(e?.message || String(e))
      onError(e?.message || String(e))
    }
  }

  const handleCancel = () => {
    sessionRef.current = null
    setSession(null)
    setStatus('idle')
    setMessage('')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {t('platforms.codex.oauth.title', isEn ? 'ChatGPT OAuth Login' : 'ChatGPT OAuth 登录')}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t(
            'codex.oauth.description',
            isEn
              ? 'Log in with your ChatGPT account (Plus/Pro/Team). Enter the code below on the verification page and authorize.'
              : '使用 ChatGPT 账号（Plus/Pro/Team）登录。在验证页面输入下方代码并完成授权，登录将自动完成。'
          )}
        </p>
      </div>

      {session ? (
        <div className="space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
          <p className="text-xs text-muted-foreground">
            {t('platforms.codex.oauth.userCode', isEn ? 'Verification code' : '验证代码')}
          </p>
          <p className="select-all text-center font-mono text-2xl font-bold tracking-widest text-foreground">
            {session.userCode}
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            {status === 'polling' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status === 'polling'
              ? t('platforms.codex.oauth.waiting', isEn ? 'Waiting for authorization...' : '等待授权完成...')
              : status === 'processing'
                ? t('platforms.codex.oauth.exchanging', isEn ? 'Exchanging token...' : '正在换取令牌...')
                : ''}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => openUrl(session.verificationUrl)}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t('platforms.codex.oauth.openPage', isEn ? 'Open Verification Page' : '打开验证页面')}
            </Button>
            <Button variant="ghost" onClick={handleCancel} disabled={status === 'processing'}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={handleStart} disabled={status === 'polling'} className="w-full">
          {status === 'polling' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-2 h-4 w-4" />
          )}
          {t('platforms.codex.oauth.start', isEn ? 'Start Login' : '开始登录')}
        </Button>
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
  )
}
