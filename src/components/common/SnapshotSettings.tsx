import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { History, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { logError } from '@/lib/logger'
import { getAllPlatforms } from '@/platforms/registry'

interface ConfigSnapshot {
  id: string
  platform: string
  createdAt: number
  files: string[]
}

/** 切号前配置快照管理：查看 / 恢复 / 删除一键切号前自动留存的配置快照 */
export function SnapshotSettings() {
  const { t, i18n } = useTranslation()
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)

  const platformNames = new Map(getAllPlatforms().map((platform) => [platform.id, platform.name]))

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invoke<ConfigSnapshot[]>('list_switch_snapshots', { platform: null })
      setSnapshots(list)
    } catch (error) {
      logError('Failed to list snapshots:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleRestore = async (snapshot: ConfigSnapshot) => {
    setRestoringId(snapshot.id)
    try {
      await invoke('restore_switch_snapshot', { platform: snapshot.platform, id: snapshot.id })
      toast.success(
        t('settings.snapshotRestored', {
          platform: platformNames.get(snapshot.platform) || snapshot.platform,
        }),
      )
    } catch (error) {
      logError('Failed to restore snapshot:', error)
      toast.error(String(error))
    } finally {
      setRestoringId(null)
    }
  }

  const handleDelete = async (snapshot: ConfigSnapshot) => {
    try {
      await invoke('delete_switch_snapshot', { platform: snapshot.platform, id: snapshot.id })
      setSnapshots((prev) => prev.filter((item) => item.id !== snapshot.id))
    } catch (error) {
      logError('Failed to delete snapshot:', error)
      toast.error(String(error))
    }
  }

  const handleClearAll = async () => {
    try {
      await invoke('clear_switch_snapshots', { platform: null })
      setSnapshots([])
      toast.success(t('settings.snapshotCleared'))
    } catch (error) {
      logError('Failed to clear snapshots:', error)
      toast.error(String(error))
    }
  }

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2 text-amber-500">
            <History className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-xl">{t('settings.snapshotTitle')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t('settings.snapshotDesc')}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('settings.snapshotEmpty')}</p>
        ) : (
          <>
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {platformNames.get(snapshot.platform) || snapshot.platform}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t('settings.snapshotFiles', { count: snapshot.files.length })}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(snapshot.createdAt).toLocaleString(
                        i18n.resolvedLanguage || i18n.language,
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={restoringId !== null}
                    onClick={() => handleRestore(snapshot)}
                    title={t('settings.snapshotRestoreHint')}
                  >
                    {restoringId === snapshot.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {t('settings.snapshotRestore')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(snapshot)}
                    title={t('settings.snapshotDelete')}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={handleClearAll}>
                <Trash2 className="h-3.5 w-3.5" />
                {t('settings.snapshotClearAll')}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
