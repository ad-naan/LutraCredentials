import { logError } from '@/lib/logger'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import { ProxySettings } from '@/components/common/ProxySettings'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { toast } from '@/lib/toast'
import { invoke } from '@tauri-apps/api/core'
import packageJson from '../../package.json'
import {
  Palette,
  Moon,
  Sun,
  Laptop,
  Info,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

interface UpdateInfo {
  current_version: string
  latest_version: string
  has_update: boolean
  release_notes?: string
  download_url?: string
}

export function Settings() {
  const theme = useTheme((state) => state.theme)
  const setTheme = useTheme((state) => state.setTheme)
  const { t } = useTranslation()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const autoRefreshEnabled = usePlatformStore((state) => state.autoRefreshEnabled)
  const autoRefreshInterval = usePlatformStore((state) => state.autoRefreshInterval)
  const setAutoRefresh = usePlatformStore((state) => state.setAutoRefresh)

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

  const handleAutoRefreshChange = (enabled: boolean, interval: number) => {
    if (enabled === autoRefreshEnabled && interval === autoRefreshInterval) return
    setAutoRefresh(enabled, interval)
    toast.success(t('settings.autoRefreshSaved'))
  }

  return (
    <div className="page-stack settings-page">
      <div className="page-heading">
        <h1 className="page-title">
          {t('settings.title')}
        </h1>
        <p className="page-description">{t('settings.subtitle')}</p>
      </div>

      <Card className="border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent p-2 text-primary">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-xl">{t('settings.autoRefreshTitle')}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{t('settings.autoRefreshDesc')}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(event) =>
                handleAutoRefreshChange(event.target.checked, autoRefreshInterval)
              }
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            {t('settings.autoRefreshEnable')}
          </label>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.autoRefreshInterval')}
            </div>
            <div className="flex flex-wrap gap-2">
              {[5, 15, 30, 60].map((minutes) => (
                <Button
                  key={minutes}
                  variant={autoRefreshInterval === minutes ? 'default' : 'outline'}
                  size="sm"
                  disabled={!autoRefreshEnabled}
                  onClick={() => handleAutoRefreshChange(autoRefreshEnabled, minutes)}
                  className={cn(autoRefreshInterval !== minutes && 'bg-background hover:bg-muted')}
                >
                  {t('settings.autoRefreshMinutes', { count: minutes })}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <ProxySettings />

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
          <div className="grid max-w-xl grid-cols-3 gap-3">
            {([
              { value: 'light' as const, icon: Sun, label: t('settings.light') },
              { value: 'dark' as const, icon: Moon, label: t('settings.dark') },
              { value: 'system' as const, icon: Laptop, label: t('settings.system') },
            ]).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                className={cn(
                  'flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium transition-colors',
                  theme === value
                    ? 'border-primary/50 bg-accent text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
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
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.version')}
              </span>
              <p className="mt-1 font-mono text-base font-medium">{packageJson.version}</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.author')}
              </span>
              <p className="mt-1 text-base font-medium">Adnaan</p>
            </div>
            <div className="rounded-lg border border-border bg-background px-4 py-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                {t('settings.license')}
              </span>
              <p className="mt-1 text-base font-medium">MIT</p>
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
