/**
 * 运行日志查看器
 *
 * 读取后端日志文件尾部内容，支持级别过滤、关键字搜索与清空。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { cn } from '@/lib/utils'
import { logError } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { FolderOpen, RefreshCw, Search, Trash2 } from 'lucide-react'

interface LogChunk {
  path: string
  directory: string
  lines: string[]
  totalLines: number
  truncated: boolean
  sizeBytes: number
}

const TAIL_LINES = 1000

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG'] as const
type Level = (typeof LEVELS)[number]

const LEVEL_TEXT_STYLES: Record<string, string> = {
  INFO: 'text-sky-600 dark:text-sky-400',
  WARN: 'text-amber-600 dark:text-amber-400',
  ERROR: 'text-red-600 dark:text-red-400',
  DEBUG: 'text-purple-600 dark:text-purple-400',
}

function detectLevel(line: string): string {
  const match = line.match(/\[(INFO|WARN|ERROR|DEBUG)\]/)
  return match ? match[1] : 'INFO'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface LogViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LogViewer({ open, onOpenChange }: LogViewerProps) {
  const { t } = useTranslation()
  const [chunk, setChunk] = useState<LogChunk | null>(null)
  const [loading, setLoading] = useState(false)
  const [level, setLevel] = useState<Level>('ALL')
  const [query, setQuery] = useState('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  const loadLogs = useCallback(async () => {
    setLoading(true)
    try {
      const result = await invoke<LogChunk>('read_log_tail', { maxLines: TAIL_LINES })
      setChunk(result)
    } catch (error) {
      logError('Failed to read log tail:', error)
      toast.error(t('settings.logLoadFailed'), String(error))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) {
      void loadLogs()
    }
  }, [open, loadLogs])

  const visibleLines = useMemo(() => {
    const lines = chunk?.lines ?? []
    const keyword = query.trim().toLowerCase()

    return lines.filter((line) => {
      if (level !== 'ALL' && detectLevel(line) !== level) return false
      if (keyword && !line.toLowerCase().includes(keyword)) return false
      return true
    })
  }, [chunk, level, query])

  const handleOpenDirectory = async () => {
    try {
      await invoke('open_log_directory')
    } catch (error) {
      logError('Failed to open log directory:', error)
      toast.error(t('settings.openLogDirFailed'), String(error))
    }
  }

  const handleClearLogs = async () => {
    try {
      await invoke('clear_log_file')
      toast.success(t('settings.logsCleared'))
      await loadLogs()
    } catch (error) {
      logError('Failed to clear logs:', error)
      toast.error(t('settings.clearLogsFailed'), String(error))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[880px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('settings.logsTitle')}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{t('settings.logsDesc')}</span>
            {chunk && (
              <span className="truncate font-mono text-xs text-muted-foreground/80" title={chunk.path}>
                {chunk.path}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-input bg-background p-1">
            {LEVELS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setLevel(item)}
                className={cn(
                  'rounded px-2 py-1 text-xs font-medium transition-colors',
                  level === item
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item === 'ALL' ? t('settings.logAllLevels') : item}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('settings.logSearchPlaceholder')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-9 py-2 text-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            />
          </div>

          <Button variant="outline" size="sm" onClick={() => void loadLogs()} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            {t('settings.logRefresh')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void handleOpenDirectory()}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('settings.openLogDir')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setClearConfirmOpen(true)}
            disabled={!chunk?.lines.length}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('settings.clearLogs')}
          </Button>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {chunk?.truncated
              ? t('settings.logTruncated', { shown: visibleLines.length, total: chunk.totalLines })
              : `${visibleLines.length} / ${chunk?.totalLines ?? 0}`}
          </span>
          {chunk && <span>{formatSize(chunk.sizeBytes)}</span>}
        </div>

        <div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-border bg-muted/30 p-3">
          {visibleLines.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {loading ? t('common.loading') : t('settings.logEmpty')}
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
              {visibleLines.map((line, index) => (
                <div
                  key={`${index}-${line.slice(0, 24)}`}
                  className={cn(LEVEL_TEXT_STYLES[detectLevel(line)])}
                >
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>

        <ConfirmDialog
          open={clearConfirmOpen}
          onOpenChange={setClearConfirmOpen}
          title={t('settings.clearLogsConfirmTitle')}
          description={t('settings.clearLogsConfirmDesc')}
          variant="destructive"
          confirmText={t('settings.clearLogs')}
          onConfirm={handleClearLogs}
        />
      </DialogContent>
    </Dialog>
  )
}
