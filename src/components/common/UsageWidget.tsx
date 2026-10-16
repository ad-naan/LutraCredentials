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

  const maxModelRequests = useMemo(() => {
    return Math.max(1, ...topModels.map(([, u]) => u.requests))
  }, [topModels])

  return (
    <section className="surface">
      <div className="surface-heading">
        <h2 className="surface-title">{t('usage.title')}</h2>
        <Button variant="ghost" size="sm" onClick={scan} disabled={loading} aria-label={t('common.refresh')}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {data && !loading ? (
        <div className="usage-body">
          <div className="usage-stats">
            <div className="usage-stat">
              <div className="usage-stat-label">
                <Activity aria-hidden="true" />
                {t('usage.totalRequests')}
              </div>
              <div className="usage-stat-value">{data.total_requests}</div>
            </div>
            <div className="usage-stat">
              <div className="usage-stat-label">
                <Cpu aria-hidden="true" />
                {t('usage.totalTokens')}
              </div>
              <div className="usage-stat-value">
                {formatTokens(data.total_input_tokens + data.total_output_tokens)}
              </div>
            </div>
            <div className="usage-stat">
              <div className="usage-stat-label">
                <TrendingUp aria-hidden="true" />
                {t('usage.cacheHitRate')}
              </div>
              <div className="usage-stat-value">
                {data.total_input_tokens + data.total_cache_read_tokens > 0
                  ? `${((data.total_cache_read_tokens / (data.total_input_tokens + data.total_cache_read_tokens)) * 100).toFixed(0)}%`
                  : '—'}
              </div>
            </div>
            <div className="usage-stat">
              <div className="usage-stat-label">
                <Coins aria-hidden="true" />
                {t('usage.estimatedCost')}
              </div>
              <div className="usage-stat-value">{formatCost(data.estimated_cost_usd)}</div>
            </div>
          </div>

          {recentDays.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-heading">
                <span className="usage-section-title">{t('usage.recentTrend')}</span>
                <span className="usage-section-meta">{t('usage.peak', { count: maxDailyRequests })}</span>
              </div>
              <div className="usage-trend">
                {recentDays.map(([date, d]) => (
                  <div
                    key={date}
                    className="usage-trend-bar"
                    style={{ height: `${Math.max(4, (d.requests / maxDailyRequests) * 100)}%` }}
                    title={`${date}: ${d.requests}`}
                  />
                ))}
              </div>
            </div>
          )}

          {topModels.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-heading">
                <span className="usage-section-title">{t('usage.topModels')}</span>
              </div>
              <div className="usage-models">
                {topModels.map(([model, u], index) => (
                  <div key={model} className="usage-model-row">
                    <span className="usage-model-rank">{index + 1}</span>
                    <span className="usage-model-name" title={model}>{model}</span>
                    <span className="usage-model-detail">
                      <span className="usage-model-count">
                        <strong>{u.requests}</strong> · {formatCost(u.estimated_cost)}
                      </span>
                      <span className="usage-model-bar">
                        <span style={{ width: `${(u.requests / maxModelRequests) * 100}%` }} />
                      </span>
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
