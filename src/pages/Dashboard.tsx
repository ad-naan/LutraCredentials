import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Activity, ArrowRight, Layers, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/StatCard'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'
import { getAllPlatforms } from '@/platforms/registry'
import { usePlatformStore } from '@/stores/usePlatformStore'

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const accounts = usePlatformStore((state) => state.accounts)
  const platforms = getAllPlatforms()
  const { versions, loading: versionsLoading } = usePlatformVersions()

  const activeAccounts = accounts.filter((account) => account.isActive).length
  const nonEmptyPlatforms = platforms.filter((platform) =>
    accounts.some((account) => account.platform === platform.id),
  ).length

  const platformSummaries = useMemo(
    () =>
      platforms
        .map((platform) => ({
          platform,
          count: accounts.filter((account) => account.platform === platform.id).length,
        }))
        .sort((left, right) => right.count - left.count),
    [accounts, platforms],
  )

  const recentAccounts = useMemo(
    () =>
      [...accounts]
        .sort((left, right) => (right.lastUsedAt || 0) - (left.lastUsedAt || 0))
        .slice(0, 6),
    [accounts],
  )

  const versionMap = versions.reduce((result, version) => {
    result[version.platform] = version
    return result
  }, {} as Record<string, { installed: boolean; version: string | null }>)

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {t('dashboard.title')}
          </h1>
          <p className="mt-2 text-base text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/accounts')} size="lg" className="shadow-sm">
          {t('dashboard.manageAccounts', { defaultValue: 'Manage Accounts' })}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.totalAccounts', { defaultValue: 'Total Accounts' })}
          value={accounts.length}
          icon={Users}
          description={t('dashboard.totalAccountsDesc')}
          className="bg-card shadow-sm border-border"
        />
        <StatCard
          title={t('dashboard.activeAccount', { defaultValue: 'Active Accounts' })}
          value={activeAccounts}
          icon={Activity}
          description={t('dashboard.activeAccountsDesc')}
          className="bg-card shadow-sm border-border"
        />
        <StatCard
          title={t('dashboard.supportedPlatforms')}
          value={platforms.length}
          icon={Layers}
          description={t('dashboard.supportedPlatformsDesc')}
          className="bg-card shadow-sm border-border"
        />
        <StatCard
          title={t('dashboard.platformsInUse')}
          value={nonEmptyPlatforms}
          icon={Layers}
          description={t('dashboard.platformsInUseDesc')}
          className="bg-card shadow-sm border-border"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-7">
        <Card className="lg:col-span-4 border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle>{t('dashboard.platformDistribution')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {platformSummaries.map(({ platform, count }) => {
              const ratio = accounts.length > 0 ? (count / accounts.length) * 100 : 0
              return (
                <button
                  key={platform.id}
                  type="button"
                  className="w-full rounded-xl border border-border/60 bg-background/50 p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
                  onClick={() => navigate(`/accounts?platform=${platform.id}`)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-foreground">{platform.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('dashboard.accountCount', { count })}
                      </p>
                    </div>
                    <div className="text-sm font-semibold text-foreground">{ratio.toFixed(0)}%</div>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${ratio}%`,
                        backgroundColor: platform.color,
                      }}
                    />
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3 border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border">
            <CardTitle>{t('dashboard.recentActivity')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {recentAccounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('accounts.noAccounts', { defaultValue: 'No accounts yet' })}
              </p>
            ) : (
              recentAccounts.map((account) => {
                const platform = platforms.find((item) => item.id === account.platform)

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-background/50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{account.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {platform?.name || account.platform}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {new Date(account.lastUsedAt).toLocaleString()}
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-6 text-xl font-semibold text-foreground">
          {t('dashboard.platformsTitle', { defaultValue: 'Platforms' })}
        </h2>
        <div className="grid gap-6 md:grid-cols-2">
          {platforms.map((platform) => {
            const Icon = platform.icon
            const platformAccounts = accounts.filter((account) => account.platform === platform.id)
            const platformVersion = versionMap[platform.id]

            return (
              <div
                key={platform.id}
                className="group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all hover:border-primary/50 hover:shadow-lg"
                onClick={() => navigate(`/accounts?platform=${platform.id}`)}
              >
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-5">
                      <div className="rounded-xl bg-secondary p-4 text-foreground transition-all duration-300 group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-6 w-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-semibold tracking-tight text-foreground">
                            {platform.name}
                          </h3>
                          {versionsLoading ? (
                            <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground animate-pulse">
                              {t('common.loading', { defaultValue: 'Loading...' })}
                            </span>
                          ) : platformVersion?.installed ? (
                            platformVersion.version ? (
                              <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                                v{platformVersion.version}
                              </span>
                            ) : null
                          ) : (
                            <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                              {t('common.notInstalled', { defaultValue: 'Not installed' })}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {platformAccounts.length} {t('common.accounts', { defaultValue: 'accounts' })}
                        </p>
                      </div>
                    </div>
                    <div className="flex h-10 w-10 -translate-x-2 items-center justify-center rounded-full bg-secondary opacity-0 transition-all group-hover:translate-x-0 group-hover:bg-primary/10 group-hover:opacity-100">
                      <ArrowRight className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
