import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowRight, Clock3, Layers, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'
import { getAllPlatforms } from '@/platforms/registry'
import { usePlatformStore } from '@/stores/usePlatformStore'

export function Dashboard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const accounts = usePlatformStore((state) => state.accounts)
  const platforms = getAllPlatforms()
  const { versions, loading: versionsLoading } = usePlatformVersions()

  const activeAccounts = accounts.filter((account) => account.isActive).length
  const platformSummaries = useMemo(
    () => platforms.map((platform) => ({
      platform,
      count: accounts.filter((account) => account.platform === platform.id).length,
    })),
    [accounts, platforms],
  )
  const distribution = [...platformSummaries]
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count)
  const recentAccounts = useMemo(
    () => [...accounts]
      .sort((left, right) => (right.lastUsedAt || 0) - (left.lastUsedAt || 0))
      .slice(0, 6),
    [accounts],
  )
  const versionMap = new Map(versions.map((version) => [version.platform, version]))
  const stats = [
    { title: 'dashboard.totalAccounts', value: accounts.length, icon: Users, description: 'dashboard.totalAccountsDesc' },
    { title: 'dashboard.activeAccount', value: activeAccounts, icon: Activity, description: 'dashboard.activeAccountsDesc' },
    { title: 'dashboard.supportedPlatforms', value: platforms.length, icon: Layers, description: 'dashboard.supportedPlatformsDesc' },
    { title: 'dashboard.platformsInUse', value: distribution.length, icon: Layers, description: 'dashboard.platformsInUseDesc' },
  ]

  return (
    <div className="page-stack">
      <header className="page-header">
        <div className="page-heading">
          <h1 className="page-title">{t('dashboard.title')}</h1>
          <p className="page-description">{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/accounts')}>
          {t('dashboard.manageAccounts')}
          <ArrowRight aria-hidden="true" />
        </Button>
      </header>

      <div className="stat-grid">
        {stats.map(({ title, value, icon: Icon, description }) => (
          <section key={title} className="surface stat-tile">
            <div className="stat-tile-heading"><span>{t(title)}</span><Icon aria-hidden="true" /></div>
            <div className="stat-value">{value}</div>
            <p className="stat-description">{t(description)}</p>
          </section>
        ))}
      </div>

      <section className="surface">
        <div className="surface-heading">
          <h2 className="surface-title">{t('dashboard.platformsTitle')}</h2>
          <span className="surface-caption">{t('workbench.platformCount', { count: platforms.length })}</span>
        </div>
        <div className="platform-directory">
          {platformSummaries.map(({ platform, count }) => {
            const Icon = platform.icon
            const version = versionMap.get(platform.id)
            return (
              <button
                key={platform.id}
                type="button"
                className="platform-directory-row"
                onClick={() => navigate(`/accounts?platform=${platform.id}`)}
              >
                <span className="platform-mark"><Icon /></span>
                <div className="platform-directory-info">
                  <p className="platform-directory-name">{platform.name}</p>
                  <p className="platform-directory-detail">
                    {versionsLoading ? t('common.loading') : version ? (
                      version.installed
                        ? version.version ? `v${version.version}` : t('common.installed')
                        : t('common.notInstalled')
                    ) : t('workbench.configuration')}
                  </p>
                </div>
                <span className="platform-directory-count" aria-label={t('dashboard.accountCount', { count })}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="dashboard-columns">
        <section className="surface">
          <div className="surface-heading">
            <h2 className="surface-title">{t('dashboard.recentActivity')}</h2>
            <Clock3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </div>
          {recentAccounts.length ? (
            <div className="recent-list">
              {recentAccounts.map((account) => {
                const platform = platforms.find((item) => item.id === account.platform)
                const Icon = platform?.icon || Users
                return (
                  <button
                    key={account.id}
                    type="button"
                    className="recent-row"
                    onClick={() => navigate(`/accounts?platform=${account.platform}`)}
                  >
                    <span className="platform-mark"><Icon /></span>
                    <div className="platform-directory-info">
                      <p className="recent-account" title={account.email}>{account.email}</p>
                      <p className="platform-directory-detail">{platform?.name || account.platform}</p>
                    </div>
                    <time className="recent-date">
                      {account.lastUsedAt ? new Date(account.lastUsedAt).toLocaleDateString(i18n.resolvedLanguage || i18n.language) : '—'}
                    </time>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="recent-empty">
              <Users aria-hidden="true" />
              <p>{t('accounts.noAccounts')}</p>
              <Button variant="outline" size="sm" onClick={() => navigate('/accounts')}>
                {t('dashboard.manageAccounts')}<ArrowRight aria-hidden="true" />
              </Button>
            </div>
          )}
        </section>

        <section className="surface">
          <div className="surface-heading"><h2 className="surface-title">{t('dashboard.platformDistribution')}</h2></div>
          <div className="distribution-list">
            {distribution.length ? distribution.map(({ platform, count }) => (
              <button
                type="button"
                key={platform.id}
                className="distribution-row"
                onClick={() => navigate(`/accounts?platform=${platform.id}`)}
              >
                <span className="truncate">{platform.name}</span>
                <span className="distribution-bar"><span style={{ width: `${(count / accounts.length) * 100}%` }} /></span>
                <span className="text-right tabular-nums text-muted-foreground">{count}</span>
              </button>
            )) : <p className="surface-caption">{t('workbench.noDistribution')}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

