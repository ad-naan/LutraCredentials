import { logError } from '@/lib/logger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { StorageService } from '@/services/StorageService'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import { invoke } from '@tauri-apps/api/core'
import packageJson from '../../package.json'
import {
  FolderOpen,
  Save,
  Database,
  Download,
  Upload,
  Palette,
  Moon,
  Sun,
  Laptop,
  Info,
  CheckCircle2,
  RotateCcw,
  RefreshCw,
  Sparkles,
  AppWindow,
  Search,
  TriangleAlert,
  HardDrive,
} from 'lucide-react'

interface UpdateInfo {
  current_version: string
  latest_version: string
  has_update: boolean
  release_notes?: string
  download_url?: string
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

const platformPathDescriptions: Record<string, string> = {
  antigravity: '管理 Antigravity 可执行文件路径，支持自动检测、浏览选择和手动填写。',
  cursor: '管理 Cursor 本地 state.vscdb 路径，便于本地导入和一键切换账号。',
  windsurf: '管理 Windsurf 本地 state.vscdb 路径，便于读取当前登录状态。',
  'github-copilot':
    '管理 GitHub Copilot 对应的 VS Code 本地 state.vscdb 路径，便于导入本地会话。',
  codebuddy: '管理 CodeBuddy 本地 state.vscdb 路径，支持本地会话导入和一键切换账号。',
  codebuddy_cn:
    '管理 CodeBuddy CN 本地 state.vscdb 路径，支持本地会话导入和一键切换账号。',
  workbuddy: '管理 WorkBuddy 本地 state.vscdb 路径，支持本地会话导入和一键切换账号。',
  qoder: '管理 Qoder 本地 state.vscdb 路径，便于读取和回写当前登录状态。',
  trae: '管理 Trae 本地 storage.json 路径，支持扫描、手动配置和一键切换账号。',
}

function stripAccountsFile(path: string) {
  return path.replace(/[\\\/]accounts\.json$/, '')
}

function kindLabel(kind: string) {
  if (kind === 'executable') return '可执行文件'
  if (kind === 'storage') return '状态文件'
  return '状态数据库'
}

export function Settings() {
  const theme = useTheme((state) => state.theme)
  const setTheme = useTheme((state) => state.setTheme)
  const { t } = useTranslation()
  const [storagePath, setStoragePath] = useState('')
  const [storageInput, setStorageInput] = useState('')
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageSuccess, setStorageSuccess] = useState(false)
  const [pathInfos, setPathInfos] = useState<LocalPlatformPathInfo[]>([])
  const [pathInputs, setPathInputs] = useState<Record<string, string>>({})
  const [pathBusyPlatform, setPathBusyPlatform] = useState<string | null>(null)
  const [pathFeedbacks, setPathFeedbacks] = useState<Record<string, FeedbackState>>({})
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
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
          message: '已选择路径，点击保存后生效',
        })
      }
    } catch (error) {
      logError('Failed to select local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : '选择路径失败',
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
          message: '已检测到路径，如需固定使用请点击保存',
        })
      } else {
        setPathFeedback(platform, {
          type: 'error',
          message: '未检测到路径，请手动选择或填写',
        })
      }
    } catch (error) {
      logError('Failed to detect local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : '检测路径失败',
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
        message: `${info.name} 路径已保存`,
      })
    } catch (error) {
      logError('Failed to save local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : '保存路径失败',
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
        message: info.detected_path
          ? '已清除手动配置，当前将使用自动检测路径'
          : '已清除手动配置路径',
      })
    } catch (error) {
      logError('Failed to clear local platform path:', error)
      setPathFeedback(platform, {
        type: 'error',
        message: error instanceof Error ? error.message : '重置路径失败',
      })
    } finally {
      setPathBusyPlatform(null)
    }
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const info = await invoke<UpdateInfo>('check_for_updates')
      setUpdateInfo(info)
      setShowUpdateDialog(true)
    } catch (error) {
      logError('Failed to check for updates:', error)
    } finally {
      setCheckingUpdate(false)
    }
  }

  return (
    <div className="page-stack settings-page">
      <div>
        <h1 className="page-title">
          {t('settings.title')}
        </h1>
        <p className="page-description">{t('settings.subtitle')}</p>
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
            <h4 className="mb-4 flex items-center gap-2 text-sm font-medium">
              <Database className="h-4 w-4" />
              {t('settings.dataManagement')}
            </h4>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" className="bg-background hover:bg-muted">
                <Upload className="mr-2 h-4 w-4" />
                {t('settings.importLegacy')}
              </Button>
              <Button variant="outline" size="sm" className="bg-background hover:bg-muted">
                <Download className="mr-2 h-4 w-4" />
                {t('settings.exportData')}
              </Button>
            </div>
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
              <CardTitle className="text-xl">本地软件与状态路径</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                统一管理本地软件可执行文件和状态数据库路径，支持自动检测、浏览和手动配置。
              </p>
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
                  ? '已配置'
                  : '已自动检测'
                : '未配置'

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
                        {platformPathDescriptions[info.platform] || '管理本地路径配置。'}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-muted-foreground lg:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">配置路径</div>
                      <div className="truncate text-foreground">
                        {info.configured_path || '未设置'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">检测路径</div>
                      <div className="truncate text-foreground">
                        {info.detected_path || '未检测到'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                      <div className="mb-1 text-xs uppercase tracking-wide">生效路径</div>
                      <div className="truncate text-foreground">
                        {info.effective_path || '暂无'}
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
                        浏览
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleDetectLocalPlatformPath(info.platform)}
                        disabled={busy}
                        className="bg-background hover:bg-muted"
                      >
                        <Search className="mr-2 h-4 w-4" />
                        检测安装
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleResetLocalPlatformPath(info.platform)}
                        disabled={busy}
                        className="bg-background hover:bg-muted"
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        重置
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
                        保存
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

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/10 p-2 text-purple-500 dark:text-purple-400">
              <Palette className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('settings.appearance')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('settings.theme')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid max-w-2xl grid-cols-3 gap-4">
            <Button
              variant={theme === 'light' ? 'default' : 'outline'}
              className={cn(
                'h-24 flex-col gap-2 transition-all',
                theme !== 'light' && 'border-input bg-background hover:bg-muted',
              )}
              onClick={() => setTheme('light')}
            >
              <Sun className="h-6 w-6" />
              <span className="text-sm font-medium">{t('settings.light')}</span>
            </Button>
            <Button
              variant={theme === 'dark' ? 'default' : 'outline'}
              className={cn(
                'h-24 flex-col gap-2 transition-all',
                theme !== 'dark' && 'border-input bg-background hover:bg-muted',
              )}
              onClick={() => setTheme('dark')}
            >
              <Moon className="h-6 w-6" />
              <span className="text-sm font-medium">{t('settings.dark')}</span>
            </Button>
            <Button
              variant={theme === 'system' ? 'default' : 'outline'}
              className={cn(
                'h-24 flex-col gap-2 transition-all',
                theme !== 'system' && 'border-input bg-background hover:bg-muted',
              )}
              onClick={() => setTheme('system')}
            >
              <Laptop className="h-6 w-6" />
              <span className="text-sm font-medium">{t('settings.system')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2 text-green-500 dark:text-green-400">
              <Info className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('settings.about')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">LutraCredentials</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-background p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.version')}
              </span>
              <p className="mt-1 text-lg font-mono font-medium">{packageJson.version}</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.author')}
              </span>
              <p className="mt-1 text-lg font-medium">Adnaan</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.license')}
              </span>
              <p className="mt-1 text-lg font-medium">MIT</p>
            </div>
          </div>

          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="flex items-center gap-2 text-sm font-medium">
                  <Sparkles className="h-4 w-4" />
                  {t('update.checkForUpdates')}
                </h4>
                <p className="text-xs text-muted-foreground">{t('update.checkDescription')}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckUpdate}
                disabled={checkingUpdate}
                className="bg-background hover:bg-muted"
              >
                {checkingUpdate ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t('update.checking')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('update.checkNow')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <UpdateDialog
        open={showUpdateDialog}
        onOpenChange={setShowUpdateDialog}
        updateInfo={updateInfo}
      />
    </div>
  )
}
