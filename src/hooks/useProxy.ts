import { useState, useCallback, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface UpstreamConfig {
  id: string
  name: string
  base_url: string
  api_key: string | null
  auth_header: string | null
  auth_prefix: string | null
  priority: number
  timeout_ms: number
  enabled: boolean
}

export interface ProxyConfig {
  enabled: boolean
  port: number
  upstreams: UpstreamConfig[]
  failover_enabled: boolean
  max_retries: number
  health_check_interval_secs: number
}

export interface UpstreamHealth {
  id: string
  name: string
  healthy: boolean
  last_checked: number | null
  latency_ms: number | null
  error: string | null
}

export interface ProxyStatus {
  running: boolean
  listen_addr: string | null
  active_upstream_id: string | null
  active_upstream_name: string | null
  total_requests: number
  failed_requests: number
  upstreams_health: UpstreamHealth[]
  started_at: number | null
  error: string | null
}

const STORAGE_KEY = 'lutra.proxyConfig'

function loadConfigFromStorage(): ProxyConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ProxyConfig
  } catch {
    return null
  }
}

function saveConfigToStorage(config: ProxyConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore
  }
}

export function useProxy() {
  const [config, setConfig] = useState<ProxyConfig | null>(null)
  const [status, setStatus] = useState<ProxyStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, st] = await Promise.all([
        invoke<ProxyConfig>('get_proxy_config'),
        invoke<ProxyStatus>('get_proxy_status'),
      ])
      // 如果后端没有配置，从 localStorage 加载
      if (!cfg.upstreams || cfg.upstreams.length === 0) {
        const local = loadConfigFromStorage()
        if (local) {
          setConfig(local)
          setStatus(st)
          return
        }
      }
      setConfig(cfg)
      setStatus(st)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const saveConfig = useCallback(async (newConfig: ProxyConfig) => {
    setLoading(true)
    setError(null)
    try {
      saveConfigToStorage(newConfig)
      const st = await invoke<ProxyStatus>('set_proxy_config', { config: newConfig })
      setConfig(newConfig)
      setStatus(st)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const startProxy = useCallback(async () => {
    if (!config) return
    setLoading(true)
    setError(null)
    try {
      const st = await invoke<ProxyStatus>('start_proxy', { config })
      setStatus(st)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [config])

  const stopProxy = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await invoke('stop_proxy')
      setStatus(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const healthCheck = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const healthList = await invoke<UpstreamHealth[]>('proxy_health_check')
      if (status) {
        setStatus({ ...status, upstreams_health: healthList })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [status])

  const testUpstream = useCallback(async (baseUrl: string, apiKey: string | null, timeoutMs: number) => {
    try {
      return await invoke<UpstreamHealth>('test_upstream', {
        baseUrl,
        apiKey: apiKey || null,
        timeoutMs,
      })
    } catch (err) {
      return {
        id: 'test',
        name: baseUrl,
        healthy: false,
        last_checked: Date.now() / 1000,
        latency_ms: null,
        error: err instanceof Error ? err.message : String(err),
      } as UpstreamHealth
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return {
    config,
    status,
    loading,
    error,
    refresh,
    saveConfig,
    startProxy,
    stopProxy,
    healthCheck,
    testUpstream,
  }
}
