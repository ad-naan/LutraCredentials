import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  HeartPulse,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAccountOps } from '@/platforms/accountOps'
import { getAllPlatforms } from '@/platforms/registry'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { Account, AntigravityAccount, ClaudeAccount, KiroAccount } from '@/types/account'

/** 即将过期阈值：1 小时内视为 warning */
const EXPIRING_SOON_MS = 60 * 60 * 1000

type HealthLevel = 'ok' | 'warning' | 'danger' | 'error'

interface AccountHealth {
  account: Account
  level: HealthLevel
  /** 凭据过期时间（毫秒时间戳）；静态凭据（API Key 等）为 null */
  expiryMs: number | null
  lastError?: string
  /** 平台是否支持状态检测（一键体检） */
  checkable: boolean
}

/** 提取账号凭据的过期时间；不同平台字段不同，静态凭据返回 null */
function getExpiryMs(account: Account): number | null {
  if (account.platform === 'kiro') {
    return (account as KiroAccount).credentials?.expiresAt ?? null
  }
  if (account.platform === 'claude') {
    return (account as ClaudeAccount).oauth?.expires_at ?? null
  }
  if (account.platform === 'antigravity') {
    return (account as AntigravityAccount).token?.expiry_timestamp ?? null
  }
  return null
}

/** 用 Intl.RelativeTimeFormat 生成 "3 天后 / 2 小时前" 之类的本地化剩余时间 */
function formatRemaining(expiryMs: number, language: string): string {
  const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const diff = expiryMs - Date.now()
  const absMinutes = Math.abs(diff) / 60_000
  if (absMinutes < 60) return rtf.format(Math.round(diff / 60_000), 'minute')
  if (absMinutes < 60 * 48) return rtf.format(Math.round(diff / 3_600_000), 'hour')
  return rtf.format(Math.round(diff / 86_400_000), 'day')
}

export function HealthWidget() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const accounts = usePlatformStore((state) => state.accounts)
  const batchCheckAccountStatus = usePlatformStore((state) => state.batchCheckAccountStatus)
  const checkAndRefreshExpiringTokens = usePlatformStore(
    (state) => state.checkAndRefreshExpiringTokens,
  )
  const [checking, setChecking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const platforms = getAllPlatforms()

  const healthList = useMemo<AccountHealth[]>(() => {
    return accounts.map((account) => {
      const status = (account as { status?: string }).status
      const lastError = (account as { lastError?: string }).lastError
      const expiryMs = getExpiryMs(account)
      const checkable = Boolean(getAccountOps(account.platform)?.checkStatus)

      let level: HealthLevel = 'ok'
      if (status === 'error' || lastError) {
        level = 'error'
      } else if (expiryMs !== null && expiryMs <= Date.now()) {
        level = 'danger'
      } else if (expiryMs !== null && expiryMs - Date.now() < EXPIRING_SOON_MS) {
        level = 'warning'
      }

      return { account, level, expiryMs, lastError, checkable }
    })
  }, [accounts])

  const summary = useMemo(() => {
    const count = (level: HealthLevel) => healthList.filter((item) => item.level === level).length
    return {
      ok: count('ok'),
      warning: count('warning'),
      danger: count('danger'),
      error: count('error'),
    }
  }, [healthList])

  const problems = useMemo(
    () =>
      healthList
        .filter((item) => item.level !== 'ok')
        .sort((a, b) => {
          const order: Record<HealthLevel, number> = { error: 0, danger: 1, warning: 2, ok: 3 }
          return order[a.level] - order[b.level]
        }),
    [healthList],
  )

  const checkableIds = useMemo(
    () => healthList.filter((item) => item.checkable).map((item) => item.account.id),
    [healthList],
  )

  const handleCheckAll = async () => {
    if (checkableIds.length === 0) return
    setChecking(true)
    try {
      await batchCheckAccountStatus(checkableIds)
    } finally {
      setChecking(false)
    }
  }

  const handleRefreshExpiring = async () => {
    setRefreshing(true)
    try {
      await checkAndRefreshExpiringTokens()
    } finally {
      setRefreshing(false)
    }
  }

  if (accounts.length === 0) return null

  const language = i18n.resolvedLanguage || i18n.language || 'en'
  const chips: Array<{ key: keyof typeof summary; level: HealthLevel; icon: typeof CheckCircle2 }> = [
    { key: 'ok', level: 'ok', icon: CheckCircle2 },
    { key: 'warning', level: 'warning', icon: Clock3 },
    { key: 'danger', level: 'danger', icon: ShieldAlert },
    { key: 'error', level: 'error', icon: ShieldX },
  ]

  return (
    <section className="surface">
      <div className="surface-heading">
        <h2 className="surface-title">{t('health.title')}</h2>
        <div className="health-actions">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshExpiring}
            disabled={refreshing}
            title={t('health.refreshExpiringHint')}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {t('health.refreshExpiring')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCheckAll}
            disabled={checking || checkableIds.length === 0}
            title={
              checkableIds.length === 0
                ? t('health.checkUnsupported')
                : t('health.checkHint', { count: checkableIds.length })
            }
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <HeartPulse className="h-3.5 w-3.5" />
            )}
            {t('health.checkAll')}
          </Button>
        </div>
      </div>

      <div className="health-body">
        <div className="health-chips">
          {chips.map(({ key, level, icon: Icon }) => (
            <div key={key} className={`health-chip health-chip-${level}`}>
              <span className="health-chip-label">
                <Icon aria-hidden="true" />
                {t(`health.level.${key}`)}
              </span>
              <span className="health-chip-value">{summary[key]}</span>
            </div>
          ))}
        </div>

        {problems.length > 0 && (
          <div className="health-problems">
            {problems.map(({ account, level, expiryMs, lastError }) => {
              const platform = platforms.find((item) => item.id === account.platform)
              const Icon = platform?.icon || HeartPulse
              return (
                <div key={account.id} className={`health-row health-row-${level}`}>
                  <span className="platform-mark">
                    <Icon />
                  </span>
                  <div className="platform-directory-info">
                    <p className="recent-account" title={account.email}>
                      {account.email}
                    </p>
                    <p className="platform-directory-detail">
                      {platform?.name || account.platform}
                      {expiryMs !== null && (
                        <>
                          {' · '}
                          {level === 'danger'
                            ? t('health.expiredAgo', { time: formatRemaining(expiryMs, language) })
                            : t('health.expiresIn', { time: formatRemaining(expiryMs, language) })}
                        </>
                      )}
                    </p>
                    {lastError && (
                      <p className="health-row-error" title={lastError}>
                        {lastError}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/accounts?platform=${account.platform}`)}
                  >
                    {t('health.manage')}
                    <ArrowRight aria-hidden="true" />
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
