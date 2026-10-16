import { useState, useMemo, useDeferredValue } from 'react'
import { AddAccountDialog } from './AddAccountDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { KiroAccountCard } from './KiroAccountCard'
import { AccountTable } from '@/components/accounts/AccountTable'
import { AccountSearch } from '@/components/accounts/AccountSearch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { useTranslation } from 'react-i18next'
import { KiroAccount } from '@/types/account'
import { Download, LayoutGrid, List, Search } from 'lucide-react'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'

type ViewMode = 'grid' | 'list'

export function KiroAccountList() {
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const [exportOpen, setExportOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const { versions, loading: versionsLoading } = usePlatformVersions()
  
  // 性能优化：使用 useDeferredValue 延迟搜索查询，避免输入卡顿
  const deferredSearchQuery = useDeferredValue(searchQuery)
  
  // 获取 Kiro 平台版本信息
  const kiroVersion = versions.find(v => v.platform === 'kiro')

  const kiroAccounts = useMemo(
    () => accounts.filter((acc): acc is KiroAccount => acc.platform === 'kiro'),
    [accounts]
  )

  const filteredAccounts = useMemo(() => {
    if (!deferredSearchQuery.trim()) return kiroAccounts

    const query = deferredSearchQuery.toLowerCase().trim()
    return kiroAccounts.filter((account) => {
      const email = account.email?.toLowerCase() || ''
      const name = account.name?.toLowerCase() || ''
      return email.includes(query) || name.includes(query)
    })
  }, [kiroAccounts, deferredSearchQuery])

  return (
    <div className="platform-account-list">
      <div className="platform-list-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="platform-list-title">
              {t('platforms.kiro.name')}
            </h1>
            {versionsLoading ? (
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded animate-pulse">
                {t('common.loading') || 'Loading...'}
              </span>
            ) : kiroVersion?.installed ? (
              kiroVersion.version ? (
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  v{kiroVersion.version}
                </span>
              ) : null
            ) : (
              <span className="text-xs text-muted-foreground bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                {t('common.notInstalled')}
              </span>
            )}
          </div>
          <p className="platform-list-description">
            {t('platforms.kiro.description', 'Manage your Kiro IDE accounts and licenses')}
          </p>
        </div>
        <div className="platform-list-actions">
          {kiroAccounts.length > 0 && (
            <>
              <AccountSearch
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={filteredAccounts.length}
                className="account-search"
              />
              <div className="view-switcher">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-7 px-2"
                  title={t('common.gridView', { defaultValue: 'Grid View' })}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-7 px-2"
                  title={t('common.listView', { defaultValue: 'List View' })}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="toolbar-export"
              >
                <Download className="h-4 w-4 mr-2" />
                {t('common.export', { defaultValue: 'Export' })}
              </Button>
            </>
          )}
          <div className="relative z-10">
            <AddAccountDialog />
          </div>
        </div>
      </div>

      {kiroAccounts.length === 0 ? (
        <Card className="account-empty-state">
          <CardContent className="account-empty-content">
            <div className="account-empty-icon">
              <Search aria-hidden="true" />
            </div>
            <p className="empty-title">{t('accounts.noAccounts')}</p>
            <p className="empty-description">{t('workbench.firstAccount')}</p>
            <AddAccountDialog />
          </CardContent>
        </Card>
      ) : filteredAccounts.length === 0 ? (
        <Card className="account-empty-state">
          <CardContent className="account-empty-content">
            <Search className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <p className="empty-title">{t('common.noResults')}</p>
            <p className="text-sm text-muted-foreground">
              {t('common.tryDifferentSearch', 'Try a different search term')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="account-grid">
              {filteredAccounts.map((account) => (
                <KiroAccountCard
                  key={account.id}
                  account={account}
                  onExport={() => setExportOpen(true)}
                />
              ))}
            </div>
          ) : (
            <AccountTable accounts={filteredAccounts} />
          )}
        </>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        accounts={kiroAccounts}
      />
    </div>
  )
}
