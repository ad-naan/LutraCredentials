import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { Activity, Loader2 } from 'lucide-react'

/**
 * 端点测速面板：对预设的候选 Base URL 并发测延迟，
 * 支持手动选择或自动采用最快端点（参考 cc-switch EndpointSpeedTest 协议）。
 */

interface EndpointLatency {
  url: string
  latency: number | null
  status: number | null
  error: string | null
}

interface EndpointSpeedTestProps {
  /** 候选端点列表（来自预设的 endpointCandidates） */
  endpoints: string[]
  /** 当前选中的端点 */
  selectedUrl?: string
  /** 选择端点回调（会把该 URL 写入配置的 Base URL） */
  onSelect: (url: string) => void
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function latencyClass(latency: number | null): string {
  if (latency === null) return 'text-muted-foreground'
  if (latency < 300) return 'text-emerald-600 dark:text-emerald-400'
  if (latency < 800) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function EndpointSpeedTest({ endpoints, selectedUrl, onSelect }: EndpointSpeedTestProps) {
  const candidates = Array.from(new Set(endpoints.map(normalizeUrl).filter(Boolean)))

  const [results, setResults] = useState<Record<string, EndpointLatency>>({})
  const [isTesting, setIsTesting] = useState(false)
  const [autoSelectFastest, setAutoSelectFastest] = useState(true)

  const sorted = [...candidates].sort((a, b) => {
    const ra = results[a]
    const rb = results[b]
    const la = ra?.latency ?? Number.MAX_SAFE_INTEGER
    const lb = rb?.latency ?? Number.MAX_SAFE_INTEGER
    if (la !== lb) return la - lb
    return a.localeCompare(b)
  })

  const handleTest = async () => {
    if (candidates.length === 0 || isTesting) return
    setIsTesting(true)
    try {
      const res = await invoke<EndpointLatency[]>('test_api_endpoints', {
        urls: candidates,
        timeoutSecs: 8,
      })
      const map: Record<string, EndpointLatency> = {}
      for (const item of res) {
        map[normalizeUrl(item.url)] = item
      }
      setResults(map)

      if (autoSelectFastest) {
        const fastest = res
          .filter((r) => r.latency !== null)
          .sort((a, b) => (a.latency ?? 0) - (b.latency ?? 0))[0]
        if (fastest) onSelect(normalizeUrl(fastest.url))
      }
    } catch (error) {
      console.error('[SpeedTest] 测速失败', error)
    } finally {
      setIsTesting(false)
    }
  }

  if (candidates.length === 0) return null

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5" />
          端点测速
        </Label>
        <Button variant="outline" size="sm" onClick={handleTest} disabled={isTesting}>
          {isTesting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
          {isTesting ? '测速中…' : '开始测速'}
        </Button>
      </div>

      {candidates.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            checked={autoSelectFastest}
            onChange={(e) => setAutoSelectFastest(e.target.checked)}
          />
          测速后自动选择最快端点
        </label>
      )}

      <div className="space-y-1">
        {sorted.map((url) => {
          const r = results[url]
          const isSelected = normalizeUrl(selectedUrl ?? '') === url
          return (
            <button
              key={url}
              type="button"
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                isSelected
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              )}
              onClick={() => onSelect(url)}
            >
              <span className="truncate font-mono">{url}</span>
              {r ? (
                r.latency !== null ? (
                  <span className={cn('shrink-0 font-medium', latencyClass(r.latency))}>
                    {r.latency} ms
                  </span>
                ) : (
                  <span className="shrink-0 text-destructive">{r.error ?? '失败'}</span>
                )
              ) : (
                <span className="shrink-0 text-muted-foreground">未测</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
