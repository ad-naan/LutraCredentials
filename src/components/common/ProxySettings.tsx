import { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ArrowUpDown,
  CheckCircle2,
  Globe,
  Loader2,
  Play,
  Plus,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useProxy, UpstreamConfig, ProxyConfig } from '@/hooks/useProxy'

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function defaultUpstream(): UpstreamConfig {
  return {
    id: uid(),
    name: '',
    base_url: '',
    api_key: null,
    auth_header: null,
    auth_prefix: null,
    priority: 0,
    timeout_ms: 30000,
    enabled: true,
  }
}

export function ProxySettings() {
  const { t } = useTranslation()
  const {
    config,
    status,
    loading,
    error,
    saveConfig,
    startProxy,
    stopProxy,
    healthCheck,
    testUpstream,
  } = useProxy()

  const [editingConfig, setEditingConfig] = useState<ProxyConfig | null>(null)

  const defaultConfig: ProxyConfig = {
    enabled: false,
    port: 3456,
    upstreams: [],
    failover_enabled: true,
    max_retries: 3,
    health_check_interval_secs: 30,
    aggregation_mode: 'Disabled',
    aggregation_timeout_ms: 30000,
  }

  const workingConfig = editingConfig ?? config ?? defaultConfig

  const updateConfig = useCallback((patch: Partial<ProxyConfig>) => {
    setEditingConfig((prev) => {
      const base = prev ?? config ?? defaultConfig
      return { ...base, ...patch }
    })
  }, [config])

  const updateUpstream = useCallback((id: string, patch: Partial<UpstreamConfig>) => {
    setEditingConfig((prev) => {
      const base = prev ?? config ?? defaultConfig
      return {
        ...base,
        upstreams: base.upstreams.map((u) =>
          u.id === id ? { ...u, ...patch } : u
        ),
      }
    })
  }, [config])

  const addUpstream = useCallback(() => {
    setEditingConfig((prev) => {
      const base = prev ?? config ?? defaultConfig
      const u = defaultUpstream()
      u.priority = base.upstreams.length
      return {
        ...base,
        upstreams: [...base.upstreams, u],
      }
    })
  }, [config])

  const removeUpstream = useCallback((id: string) => {
    setEditingConfig((prev) => {
      const base = prev ?? config ?? defaultConfig
      return {
        ...base,
        upstreams: base.upstreams.filter((u) => u.id !== id),
      }
    })
  }, [config])

  const handleSave = useCallback(async () => {
    if (!editingConfig) return
    await saveConfig(editingConfig)
    setEditingConfig(null)
  }, [editingConfig, saveConfig])

  const hasChanges = useMemo(() => {
    if (!editingConfig) return false
    return JSON.stringify(editingConfig) !== JSON.stringify(config)
  }, [editingConfig, config])

  return (
    <div className="space-y-6">
      {/* 状态卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {status?.running ? (
                <Activity className="h-5 w-5 text-emerald-500" />
              ) : (
                <Power className="h-5 w-5 text-muted-foreground" />
              )}
              <CardTitle>{t('proxy.title')}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {status?.running && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  {status.listen_addr}
                </span>
              )}
              {status?.active_upstream_name && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  <Globe className="h-3 w-3" />
                  {status.active_upstream_name}
                </span>
              )}
            </div>
          </div>
          <CardDescription>{t('proxy.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 统计 */}
          {status?.running && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold tabular-nums">{status.total_requests}</div>
                <div className="text-xs text-muted-foreground">{t('proxy.totalRequests')}</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-destructive">{status.failed_requests}</div>
                <div className="text-xs text-muted-foreground">{t('proxy.failedRequests')}</div>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <div className="text-2xl font-bold tabular-nums">{status.upstreams_health.length}</div>
                <div className="text-xs text-muted-foreground">{t('proxy.upstreams')}</div>
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex flex-wrap gap-2">
            {status?.running ? (
              <Button variant="destructive" size="sm" onClick={stopProxy} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Power className="mr-1 h-3.5 w-3.5" />}
                {t('proxy.stop')}
              </Button>
            ) : (
              <Button size="sm" onClick={startProxy} disabled={loading || workingConfig.upstreams.length === 0}>
                {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                {t('proxy.start')}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={healthCheck} disabled={loading || !status?.running}>
              {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              {t('proxy.healthCheck')}
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
              <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 配置 */}
      <Card>
        <CardHeader>
          <CardTitle>{t('proxy.configuration')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 基本设置 */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('proxy.port')}</Label>
              <Input
                type="number"
                value={workingConfig.port}
                onChange={(e) => updateConfig({ port: parseInt(e.target.value, 10) || 3456 })}
                min={1024}
                max={65535}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('proxy.failover')}</Label>
                <Switch
                  checked={workingConfig.failover_enabled}
                  onCheckedChange={(v: boolean) => updateConfig({ failover_enabled: v })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('proxy.maxRetries')}</Label>
              <Input
                type="number"
                value={workingConfig.max_retries}
                onChange={(e) => updateConfig({ max_retries: parseInt(e.target.value, 10) || 1 })}
                min={1}
                max={10}
                disabled={!workingConfig.failover_enabled}
              />
            </div>
          </div>

          {/* 聚合模式 */}
          <div className="space-y-3">
            <Label>{t('proxy.aggregationMode')}</Label>
            <div className="flex flex-wrap gap-2">
              {(['Disabled', 'Race', 'LowestLatency'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={workingConfig.aggregation_mode === mode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => updateConfig({ aggregation_mode: mode })}
                >
                  {t(`proxy.aggregationMode_${mode}`)}
                </Button>
              ))}
            </div>
            {workingConfig.aggregation_mode !== 'Disabled' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t('proxy.aggregationTimeout')}</Label>
                  <Input
                    type="number"
                    value={workingConfig.aggregation_timeout_ms}
                    onChange={(e) => updateConfig({ aggregation_timeout_ms: parseInt(e.target.value, 10) || 30000 })}
                    className="h-8 text-sm"
                    min={1000}
                    max={120000}
                  />
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* 上游列表 */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <Label>{t('proxy.upstreams')}</Label>
              <Button variant="outline" size="sm" onClick={addUpstream}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('proxy.addUpstream')}
              </Button>
            </div>

            {workingConfig.upstreams.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {t('proxy.noUpstreams')}
              </div>
            ) : (
              <div className="space-y-3">
                {workingConfig.upstreams.map((u, idx) => (
                  <UpstreamRow
                    key={u.id}
                    upstream={u}
                    index={idx}
                    health={status?.upstreams_health.find((h) => h.id === u.id)}
                    onUpdate={(patch) => updateUpstream(u.id, patch)}
                    onRemove={() => removeUpstream(u.id)}
                    onTest={() => testUpstream(u.base_url, u.api_key, u.timeout_ms)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          {hasChanges && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditingConfig(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading}>
                {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t('common.save')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function UpstreamRow({
  upstream,
  index,
  health,
  onUpdate,
  onRemove,
  onTest,
}: {
  upstream: UpstreamConfig
  index: number
  health?: { healthy: boolean; latency_ms?: number | null; error?: string | null }
  onUpdate: (patch: Partial<UpstreamConfig>) => void
  onRemove: () => void
  onTest: () => Promise<{ healthy: boolean; latency_ms?: number | null; error?: string | null } | undefined>
}) {
  const { t } = useTranslation()
  const [testResult, setTestResult] = useState<{
    loading: boolean
    result?: { healthy: boolean; latency_ms?: number | null; error?: string | null }
  }>({ loading: false })

  const handleTest = async () => {
    setTestResult({ loading: true })
    const result = await onTest()
    if (result) {
      setTestResult({ loading: false, result })
    } else {
      setTestResult({ loading: false })
    }
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-medium">
            {index + 1}
          </span>
          <Switch
            checked={upstream.enabled}
            onCheckedChange={(v: boolean) => onUpdate({ enabled: v })}
          />
          {health && (
            <span className={`inline-flex items-center gap-1 text-xs ${health.healthy ? 'text-emerald-500' : 'text-destructive'}`}>
              {health.healthy ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {health.latency_ms !== null && health.latency_ms !== undefined
                ? `${health.latency_ms}ms`
                : health.healthy
                  ? t('proxy.healthy')
                  : t('proxy.unhealthy')}
            </span>
          )}
          {testResult.result && (
            <span className={`inline-flex items-center gap-1 text-xs ${testResult.result.healthy ? 'text-emerald-500' : 'text-destructive'}`}>
              {testResult.result.healthy ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
              {testResult.result.latency_ms !== null && testResult.result.latency_ms !== undefined
                ? `${testResult.result.latency_ms}ms`
                : testResult.result.error || (testResult.result.healthy ? t('proxy.healthy') : t('proxy.unhealthy'))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleTest} disabled={testResult.loading}>
            {testResult.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t('proxy.name')}</Label>
          <Input
            value={upstream.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            placeholder={t('proxy.namePlaceholder')}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('proxy.baseUrl')}</Label>
          <Input
            value={upstream.base_url}
            onChange={(e) => onUpdate({ base_url: e.target.value })}
            placeholder="https://api.example.com/v1"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('proxy.apiKey')}</Label>
          <Input
            type="password"
            value={upstream.api_key || ''}
            onChange={(e) => onUpdate({ api_key: e.target.value || null })}
            placeholder="sk-..."
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{t('proxy.priority')}</Label>
            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
          </div>
          <Input
            type="number"
            value={upstream.priority}
            onChange={(e) => onUpdate({ priority: parseInt(e.target.value, 10) || 0 })}
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t('proxy.timeout')}</Label>
          <Input
            type="number"
            value={upstream.timeout_ms}
            onChange={(e) => onUpdate({ timeout_ms: parseInt(e.target.value, 10) || 30000 })}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  )
}
