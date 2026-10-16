import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from '@/components/ui/card'
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
    () =>
      platforms.map((platform) => ({
        platform,
        count: accounts.filter((account) => account.platform === platform.id).length,
      })),
    [accounts, platforms],
  )

  if (!selectedPlatform) {
    return <div>{t('accounts.platformNotFound')}</div>
  }

  const AccountListComponent = selectedPlatform.AccountList

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card/60 shadow-sm">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">{t('accounts.platformWorkspace')}</p>
              <h1 className="text-2xl font-bold tracking-tight">{selectedPlatform.name}</h1>
              <p className="max-w-3xl text-sm text-muted-foreground">{selectedPlatform.description}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
              {t('accounts.accountsAcross', {
                count: platformStats.reduce((sum, item) => sum + item.count, 0),
                total: platforms.length,
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {platformStats.map(({ platform, count }) => {
              const Icon = platform.icon
              const isActive = platform.id === selectedPlatformId

              return (
                <button
                  key={platform.id}
                  type="button"
                  onClick={() => setSearchParams({ platform: platform.id })}
                  className={cn(
                    'group rounded-2xl border p-4 text-left transition-all',
                    'hover:border-primary/40 hover:shadow-md',
                    isActive
                      ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/30'
                      : 'border-border/60 bg-background/50',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={cn(
                        'rounded-xl p-3 transition-colors',
                        isActive ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground',
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <span
                      className={cn(
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {count}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1">
                    <h2 className="font-semibold leading-tight text-foreground">{platform.name}</h2>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{platform.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <AccountListComponent />
    </div>
  )
}
