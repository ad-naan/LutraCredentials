import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Layers } from 'lucide-react'
import { getAllPlatforms, getPlatform } from '@/platforms/registry'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { cn } from '@/lib/utils'

export function Accounts() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const platforms = getAllPlatforms()
  const selectedPlatformId = searchParams.get('platform') || platforms[0]?.id
  const selectedPlatform = getPlatform(selectedPlatformId)

  const platformStats = useMemo(
    () => platforms.map((platform) => ({
      platform,
      count: accounts.filter((account) => account.platform === platform.id).length,
    })),
    [accounts, platforms],
  )

  const AccountListComponent = selectedPlatform?.AccountList

  return (
    <div className="page-stack accounts-page">
      <nav className="platform-strip" aria-label={t('workbench.platforms')}>
        <div className="platform-strip-head">
          <span className="platform-strip-title">
            <Layers aria-hidden="true" />
            {t('workbench.platforms')}
          </span>
          <span className="platform-strip-meta">
            {t('workbench.accountSummary', { count: accounts.length, total: platforms.length })}
          </span>
        </div>
        <div className="platform-strip-list">
          {platformStats.map(({ platform, count }) => {
            const Icon = platform.icon
            const isActive = platform.id === selectedPlatformId

            return (
              <button
                key={platform.id}
                type="button"
                onClick={() => setSearchParams((previous) => {
                  const next = new URLSearchParams(previous)
                  next.set('platform', platform.id)
                  return next
                })}
                aria-pressed={isActive}
                title={platform.name}
                className={cn('platform-tab', isActive && 'platform-tab--active')}
              >
                <Icon />
                <span className="platform-tab-name">{platform.name}</span>
                <span className="platform-tab-count">{count}</span>
              </button>
            )
          })}
        </div>
      </nav>

      <section className="account-workspace" key={selectedPlatformId} aria-label={selectedPlatform?.name}>
        {AccountListComponent ? <AccountListComponent /> : (
          <div className="account-empty-state account-empty-content">
            <p className="empty-title">{t('accounts.platformNotFound')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
