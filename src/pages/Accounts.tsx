import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Layers } from 'lucide-react'
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
  const selectedCount = platformStats.find(({ platform }) => platform.id === selectedPlatformId)?.count || 0

  return (
    <div className="accounts-workspace">
      <aside className="platform-sidebar" aria-label={t('workbench.platforms')}>
        <div className="platform-sidebar-heading">
          <span>{t('workbench.platforms')}</span>
          <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </div>
        <p className="platform-sidebar-total">
          {t('workbench.accountSummary', { count: accounts.length, total: platforms.length })}
        </p>
        <div className="platform-nav-list">
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
                className={cn('platform-nav-item', isActive && 'platform-nav-item--active')}
              >
                <Icon aria-hidden="true" />
                <span className="platform-nav-name">{platform.name}</span>
                <span className="platform-nav-count">{count}</span>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="account-workspace" key={selectedPlatformId} aria-label={selectedPlatform?.name}>
        <div className="workspace-context">
          <div className="workspace-context-path">
            <span>{t('nav.accounts')}</span>
            <ChevronRight aria-hidden="true" />
            <span>{selectedPlatform?.name || selectedPlatformId}</span>
          </div>
          <span>{t('dashboard.accountCount', { count: selectedCount })}</span>
        </div>
        {AccountListComponent ? <AccountListComponent /> : (
          <div className="account-empty-state account-empty-content">
            <p className="empty-title">{t('accounts.platformNotFound')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
