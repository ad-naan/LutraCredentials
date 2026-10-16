import { logError } from '@/lib/logger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { StorageService } from '@/services/StorageService'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { LogViewer } from '@/components/common/LogViewer'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { toast } from '@/lib/toast'
import { invoke } from '@tauri-apps/api/core'
import {
  FolderOpen,
  Save,
  Database,
  Download,
  Upload,
  Info,
  CheckCircle2,
  RotateCcw,
  RefreshCw,
  AppWindow,
  Search,
  TriangleAlert,
  HardDrive,
  Archive,
  ScrollText,
} from 'lucide-react'

interface BackupOutcome {
  path: string
  accountCount: number
  bytes: number
}

interface RestoreOutcome {
  path: string
  mode: string
  added: number
  updated: number
  invalid: number
  total: number
}

interface LocalPlatformPathInfo {
  platform: string
  name: string
  kind: string
  configured_path: string | null
  detected_path: string | null
  effective_path: string | null
  exists: boolean
  version: string | null
}

type FeedbackState = {
  type: 'success' | 'error' | 'info'
  message: string
} | null

function stripAccountsFile(path: string) {
  return path.replace(/[\\\/]accounts\.json$/, '')
}

export function Data() {
  const { t } = useTranslation()
  const [storagePath, setStoragePath] = useState('')
  const [storageInput, setStorageInput] = useState('')
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageSuccess, setStorageSuccess] = useState(false)
  const [pathInfos, setPathInfos] = useState<LocalPlatformPathInfo[]>([])
  const [pathInputs, setPathInputs] = useState<Record<string, string>>({})
  const [pathBusyPlatform, setPathBusyPlatform] = useState<string | null>(null)
  const [pathFeedbacks, setPathFeedbacks] = useState<Record<string, FeedbackState>>({})
  const [backupBusy, setBackupBusy] = useState(false)
  const [restoreBusy, setRestoreBusy] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [showLogViewer, setShowLogViewer] = useState(false)
  const storageService = StorageService.getInstance()

  useEffect(() => {
    void loadStoragePath()
    void loadLocalPlatformPathInfos()
  }, [])

  const replacePathInfo = (nextInfo: LocalPlatformPathInfo) => {
    setPathInfos((current) =>
      current.map((item) => (item.platform === nextInfo.platform ? nextInfo : item)),
    )
    setPathInputs((current) => ({
      ...current,
      [nextInfo.platform]: nextInfo.configured_path || nextInfo.effective_path || '',
    }))
  }

  const setPathFeedback = (platform: string, feedback: FeedbackState) => {
    setPathFeedbacks((current) => ({
      ...current,
      [platform]: feedback,
    }))
  }

  const showStorageSuccess = () => {
    setStorageSuccess(true)
    window.setTimeout(() => setStorageSuccess(false), 3000)
  }

  const loadStoragePath = async () => {
    try {
      const path = await storageService.getCurrentPath()
      setStoragePath(path)
      setStorageInput(stripAccountsFile(path))
    } catch (error) {
      logError('Failed to load storage path:', error)
    }
  }

  const loadLocalPlatformPathInfos = async () => {
    try {
      const infos = await invoke<LocalPlatformPathInfo[]>('get_local_platform_path_infos')
      setPathInfos(infos)
      setPathInputs((current) => {
        const next = { ...current }
        for (const info of infos) {
          if (!next[info.platform]) {
            next[info.platform] = info.configured_path || info.effective_path || ''
          }
        }
        return next
      })
    } catch (error) {
      logError('Failed to load local platform path infos:', error)
    }
  }

  const handleSelectDirectory = async () => {
    try {
      const selected = await storageService.selectDirectory()
      if (selected) {
        setStorageInput(selected)
      }
    } catch (error) {
      logError('Failed to select directory:', error)
    }
  }

  const handleUpdatePath = async () => {
    const trimmedPath = storageInput.trim()
    if (!trimmedPath) return

    setStorageLoading(true)
    try {
      await storageService.setStoragePath(trimmedPath)
      await loadStoragePath()
      showStorageSuccess()
    } catch (error) {
      logError('Failed to set storage path:', error)
    } finally {
      setStorageLoading(false)
    }
  }

  const handleResetPath = async () => {
    setStorageLoading(true)
    try {
      await storageService.resetToDefault()
      await loadStoragePath()
      showStorageSuccess()
    } catch (error) {
      logError('Failed to reset path:', error)
    } finally {
      setStorageLoading(false)
    }
  }

  const handleSelectLocalPlatformPath = async (platform: string) => {
    setPathBusyPlatform(platform)
    try {
      const selected = await invoke<string | null>('select_local_platform_path', { platform })
      if (selected) {
        setPathInputs((current) => ({
          ...current,
          [platform]: selected,
        }))
        setPathFeedback(platform, {
          type: 'info',
          message: t('data.pathSelectDone'),
        })
      }
    } catch (error) {
      logError('Failed to select local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : t('data.pathSelectFailed'),
      })
    } finally {
      setPathBusyPlatform(null)
    }
  }

  const handleDetectLocalPlatformPath = async (platform: string) => {
    setPathBusyPlatform(platform)
    try {
      const detectedPath = await invoke<string | null>('detect_local_platform_path', { platform })
      const infos = await invoke<LocalPlatformPathInfo[]>('get_local_platform_path_infos')
      setPathInfos(infos)

      if (detectedPath) {
        setPathInputs((current) => ({
          ...current,
          [platform]: detectedPath,
        }))
        setPathFeedback(platform, {
          type: 'success',
          message: t('data.pathDetected'),
        })
      } else {
        setPathFeedback(platform, {
          type: 'error',
          message: t('data.pathDetectNone'),
        })
      }
    } catch (error) {
      logError('Failed to detect local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : t('data.pathDetectFailed'),
      })
    } finally {
      setPathBusyPlatform(null)
    }
  }

  const handleSaveLocalPlatformPath = async (platform: string) => {
    const trimmedPath = (pathInputs[platform] || '').trim()
    if (!trimmedPath) return

    setPathBusyPlatform(platform)
    try {
      const info = await invoke<LocalPlatformPathInfo>('set_local_platform_path', {
        platform,
        path: trimmedPath,
      })
      replacePathInfo(info)
      setPathFeedback(platform, {
        type: 'success',
        message: t('data.pathSaved', { name: info.name }),
      })
    } catch (error) {
      logError('Failed to save local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : t('data.pathSaveFailed'),
      })
    } finally {
      setPathBusyPlatform(null)
    }
  }

  const handleResetLocalPlatformPath = async (platform: string) => {
    setPathBusyPlatform(platform)
    try {
      const info = await invoke<LocalPlatformPathInfo>('clear_local_platform_path', { platform })
      replacePathInfo(info)
      setPathFeedback(platform, {
        type: 'success',
        message: info.detected_path ? t('data.pathClearedDetected') : t('data.pathCleared'),
      })
    } catch (error) {
      logError('Failed to clear local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : t('data.pathClearFailed'),
      })
    } finally {
      setPathBusyPlatform(null)
    }
  }

  const handleExportBackup = async () => {
    setBackupBusy(true)
    try {
      // path 为 null 时由后端弹出系统保存对话框
      const result = await invoke<BackupOutcome | null>('backup_accounts', { path: null })
      if (!result) {
        toast.info(t('settings.backupCancelled'))
        return
      }
      toast.success(t('settings.backupDone', { count: result.accountCount }), result.path)
    } catch (error) {
      logError('Failed to export backup:', error)
      toast.error(t('settings.backupFailed'), String(error))
    } finally {
      setBackupBusy(false)
    }
  }

  const handleRestoreBackup = async () => {
    setRestoreBusy(true)
    try {
      const result = await invoke<RestoreOutcome | null>('restore_accounts', {
        path: null,
        mode: 'merge',
      })
      if (!result) {
        toast.info(t('settings.restoreCancelled'))
        return
      }
      toast.success(
        t('settings.restoreDone', {
          added: result.added,
          updated: result.updated,
          total: result.total,
        }),
      )
      await usePlatformStore.getState().loadAllAccounts()
    } catch (error) {
      logError('Failed to restore backup:', error)
      toast.error(t('settings.restoreFailed'), String(error))
    } finally {
      setRestoreBusy(false)
    }
  }

  const handleOpenLogDirectory = async () => {
    try {
      await invoke('open_log_directory')
    } catch (error) {
      logError('Failed to open log directory:', error)
      toast.error(t('settings.openLogDirFailed'), String(error))
    }
  }

  const kindLabel = (kind: string) => {
    if (kind === 'executable') return t('data.kindExecutable')
    if (kind === 'storage') return t('data.kindStorage')
    return t('data.kindDatabase')
  }

  return (
    <div className="page-stack data-page">
      <div className="page-heading">
        <h1 className="page-title">{t('data.title')}</h1>
        <p className="page-description">{t('data.subtitle')}</p>
      </div>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent p-2 text-primary">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('settings.storage')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('settings.dataLocationDesc')}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="space-y-4">
            <div className="flex flex-col gap-3 xl:flex-row">
              <div className="relative flex-1 group">
                <FolderOpen className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  type="text"
                  value={storageInput}
                  onChange={(event) => setStorageInput(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-10 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  placeholder={t('settings.storagePath')}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleSelectDirectory}
                  className="bg-background hover:bg-muted"
                  title={t('settings.browse')}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  {t('settings.browse')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleResetPath}
                  disabled={storageLoading}
                  className="bg-background hover:bg-muted"
                  title={t('settings.reset')}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('settings.reset')}
                </Button>
                <Button
                  onClick={handleUpdatePath}
                  disabled={storageLoading || !storageInput.trim()}
                  className={cn(
                    'min-w-[100px] transition-all',
                    storageSuccess && 'bg-green-600 hover:bg-green-700',
                  )}
                >
                  {storageLoading ? (
                    t('common.loading')
                  ) : storageSuccess ? (
                    <>
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {t('common.success')}
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      {t('common.save')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            <p className="flex items-start gap-2 pl-1 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{t('settings.currentPath', { path: stripAccountsFile(storagePath) })}</span>
            </p>
          </div>

          <div className="border-t border-border pt-6">
            <h4 className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Archive className="h-4 w-4" />
              {t('settings.backupTitle')}
            </h4>
            <p className="mb-4 text-xs text-muted-foreground">{t('settings.backupDesc')}</p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                className="bg-background hover:bg-muted"
                disabled={backupBusy}
                onClick={() => void handleExportBackup()}
              >
                {backupBusy ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                {t('settings.exportBackup')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-background hover:bg-muted"
                disabled={restoreBusy}
                onClick={() => setRestoreConfirmOpen(true)}
              >
                {restoreBusy ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {t('settings.restoreBackup')}
              </Button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>{t('settings.restoreModeHint')}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent p-2 text-primary">
              <ScrollText className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('settings.logsTitle')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('settings.logsDesc')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              className="bg-background hover:bg-muted"
              onClick={() => setShowLogViewer(true)}
            >
              <ScrollText className="mr-2 h-4 w-4" />
              {t('settings.viewLogs')}
            </Button>
            <Button
              variant="outline"
              className="bg-background hover:bg-muted"
              onClick={() => void handleOpenLogDirectory()}
            >
              <FolderOpen className="mr-2 h-4 w-4" />
              {t('settings.openLogDir')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500 dark:text-emerald-400">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('data.localPathsTitle')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('data.localPathsDesc')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <div className="grid gap-4 xl:grid-cols-2">
            {pathInfos.map((info) => {
              const busy = pathBusyPlatform === info.platform
              const inputValue = pathInputs[info.platform] || ''
              const feedback = pathFeedbacks[info.platform]
              const statusLabel = info.exists
                ? info.configured_path
                  ? t('data.pathStatusConfigured')
                  : t('data.pathStatusAutoDetected')
                : t('data.pathStatusNotConfigured')

              return (
                <div
                  key={info.platform}
                  className="space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-semibold">{info.name}</h4>
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-0.5 text-xs font-medium',
                            info.exists
                              ? 'bg-emerald-500/10 text-emerald-600'
                              : 'bg-amber-500/10 text-amber-600',
                          )}
                        >
                          {statusLabel}
                        </span>
                        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
                          {kindLabel(info.kind)}
                        </span>
                        {info.version && (
                          <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
                            v{info.version}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(`data.pathDescriptions.${info.platform}`, {
                          defaultValue: t('data.pathDescDefault'),
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-muted-foreground lg:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">
                        {t('data.configuredPath')}
                      </div>
                      <div className="truncate text-foreground">
                        {info.configured_path || t('data.notSet')}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">
                        {t('data.detectedPath')}
                      </div>
                      <div className="truncate text-foreground">
                        {info.detected_path || t('data.notDetected')}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">
                        {t('data.effectivePath')}
                      </div>
                      <div className="truncate text-foreground">
                        {info.effective_path || t('data.none')}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <div className="relative">
                      <AppWindow className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={inputValue}
                        onChange={(event) =>
                          setPathInputs((current) => ({
                            ...current,
                            [info.platform]: event.target.value,
                          }))
                        }
                        className="flex h-10 w-full rounded-md border border-input bg-background px-10 py-2 text-sm shadow-sm transition-all placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        placeholder={
                          info.kind === 'executable'
                            ? '例如: C:\\Program Files\\Antigravity\\Antigravity.exe'
                            : info.kind === 'storage'
                              ? '例如: C:\\Users\\...\\storage.json'
                              : '例如: C:\\Users\\...\\state.vscdb'
                        }
                      />
                    </div>

                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        onClick={() => void handleSelectLocalPlatformPath(info.platform)}
                        disabled={busy}
                        className="bg-background hover:bg-muted"
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        {t('settings.browse')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleDetectLocalPlatformPath(info.platform)}
                        disabled={busy}
                        className="bg-background hover:bg-muted"
                      >
                        <Search className="mr-2 h-4 w-4" />
                        {t('data.detectInstall')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleResetLocalPlatformPath(info.platform)}
                        disabled={busy}
                        className="bg-background hover:bg-muted"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        {t('settings.reset')}
                      </Button>
                      <Button
                        onClick={() => void handleSaveLocalPlatformPath(info.platform)}
                        disabled={busy || !inputValue.trim()}
                      >
                        {busy ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Save className="mr-2 h-4 w-4" />
                        )}
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>

                  {feedback && (
                    <div
                      className={cn(
                        'flex items-start gap-2 rounded-lg px-3 py-3 text-sm',
                        feedback.type === 'success' && 'bg-emerald-500/10 text-emerald-600',
                        feedback.type === 'error' && 'bg-red-500/10 text-red-600',
                        feedback.type === 'info' && 'bg-blue-500/10 text-blue-600',
                      )}
                    >
                      {feedback.type === 'error' ? (
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : feedback.type === 'success' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span>{feedback.message}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <LogViewer open={showLogViewer} onOpenChange={setShowLogViewer} />

      <ConfirmDialog
        open={restoreConfirmOpen}
        onOpenChange={setRestoreConfirmOpen}
        title={t('settings.restoreConfirmTitle')}
        description={t('settings.restoreConfirmDesc')}
        confirmText={t('settings.restoreBackup')}
        onConfirm={handleRestoreBackup}
      />
    </div>
  )
}
