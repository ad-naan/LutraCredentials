import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, Coins, Cpu, Loader2, RefreshCw, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useUsageStats } from '@/hooks/useUsageStats'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`
  if (usd >= 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(4)}`
}

export function UsageWidget() {
  const { t } = useTranslation()
  const { data, loading, scan } = useUsageStats()

  useEffect(() => {
    scan()
  }, [scan])

  const topModels = useMemo(() => {
    if (!data) return []
    return Object.entries(data.by_model)
      .sort((a, b) => b[1].requests - a[1].requests)
      .slice(0, 5)
  }, [data])

  const recentDays = useMemo(() => {
    if (!data) return []
    return Object.entries(data.by_date)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
  }, [data])

  const maxDailyRequests = useMemo(() => {
    return Math.max(1, ...recentDays.map(([, d]) => d.requests))
  }, [recentDays])

  return (
    <section className="surface">
      <div className="surface-heading">
        <h2 className="surface-title">{t('usage.title')}</h2>
        <Button variant="ghost" size="sm" onClick={scan} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {data && !loading ? (
        <div className="space-y-4">
          {/* 指标卡片 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Activity className="h-3 w-3" />
                {t('usage.totalRequests')}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{data.total_requests}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Cpu className="h-3 w-3" />
                {t('usage.totalTokens')}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {formatTokens(data.total_input_tokens + data.total_output_tokens)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TrendingUp className="h-3 w-3" />
                {t('usage.cacheHitRate')}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">
                {data.total_input_tokens + data.total_cache_read_tokens > 0
                  ? `${((data.total_cache_read_tokens / (data.total_input_tokens + data.total_cache_read_tokens)) * 100).toFixed(0)}%`
                  : '—'}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Coins className="h-3 w-3" />
                {t('usage.estimatedCost')}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatCost(data.estimated_cost_usd)}</div>
            </div>
          </div>

          {/* 近14天趋势 */}
          {recentDays.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">{t('usage.recentTrend')}</p>
              <div className="flex items-end gap-1" style={{ height: '60px' }}>
                {recentDays.map(([date, d]) => (
                  <div
                    key={date}
                    className="flex-1 rounded-t-sm bg-primary/20 transition-colors hover:bg-primary/40"
                    style={{ height: `${(d.requests / maxDailyRequests) * 100}%` }}
                    title={`${date}: ${d.requests} 请求`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Top 模型 */}
          {topModels.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">{t('usage.topModels')}</p>
              <div className="space-y-1.5">
                {topModels.map(([model, u]) => (
                  <div key={model} className="flex items-center justify-between text-sm">
                    <span className="truncate font-mono text-xs">{model}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground tabular-nums">
                      {u.requests} 次 · {formatCost(u.estimated_cost)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('usage.scanning')}
        </div>
      ) : (
        <div className="py-8 text-center text-sm text-muted-foreground">
          {t('usage.noData')}
        </div>
      )}
    </section>
  )
}
