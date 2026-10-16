import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { History, Loader2, RefreshCw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UpdateDialog } from '@/components/dialogs/UpdateDialog'
import { ChangelogDialog } from '@/components/dialogs/ChangelogDialog'
import { toast } from '@/lib/toast'
import { logError } from '@/lib/logger'
import packageJson from '../../../package.json'

interface UpdateInfo {
  current_version: string
  latest_version: string
  has_update: boolean
  release_notes?: string
  download_url?: string
}

/** Clickable topbar version badge: opens a small menu to check for updates. */
export function VersionMenu() {
  const { t } = useTranslation()
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [changelogOpen, setChangelogOpen] = useState(false)

  const handleCheckUpdate = async () => {
    setChecking(true)
    try {
      const info = await invoke<UpdateInfo>('check_for_updates')
      setUpdateInfo(info)
      setDialogOpen(true)
    } catch (error) {
      logError('Failed to check for updates:', error)
      toast.error(t('update.errorTitle'), String(error))
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="topbar-version topbar-version--button"
          title={t('update.checkForUpdates')}
        >
          v{packageJson.version}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuLabel className="text-xs">
            LutraCredentials v{packageJson.version}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={checking}
            onClick={() => void handleCheckUpdate()}
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {checking ? t('update.checking') : t('update.checkNow')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setChangelogOpen(true)}>
            <History className="h-4 w-4" />
            {t('changelog.menuItem')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <UpdateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        updateInfo={updateInfo}
      />

      <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
    </>
  )
}
