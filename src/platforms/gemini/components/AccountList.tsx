import { logError } from '@/lib/logger'
import { useState, useMemo, useDeferredValue } from 'react'
import { AddAccountDialog } from './AddAccountDialog'
import { EditAccountDialog } from './EditAccountDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { GeminiAccountCard } from './GeminiAccountCard'
import { AccountTable } from '@/components/accounts/AccountTable'
import { AccountSearch } from '@/components/accounts/AccountSearch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { useTranslation } from 'react-i18next'
import { Download, LayoutGrid, List, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import type { Account, GeminiAccount } from '@/types/account'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'

type ViewMode = 'grid' | 'list'

export function GeminiAccountList() {
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const updateAccount = usePlatformStore((state) => state.updateAccount)
  const [exportOpen, setExportOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [editAccount, setEditAccount] = useState<GeminiAccount | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const { versions, loading: versionsLoading } = usePlatformVersions()
  
  // 性能优化：使用 useDeferredValue 延迟搜索查询，避免输入卡顿
  const deferredSearchQuery = useDeferredValue(searchQuery)
  
  // 获取 Gemini 平台版本信息
  const geminiVersion = versions.find(v => v.platform === 'gemini')

  const geminiAccounts = useMemo(
    () => accounts.filter((acc): acc is GeminiAccount => acc.platform === 'gemini'),
    [accounts]
  )

  const filteredAccounts = useMemo(() => {
    if (!deferredSearchQuery.trim()) return geminiAccounts

    const query = deferredSearchQuery.toLowerCase().trim()
    return geminiAccounts.filter((account) => {
      const email = account.email?.toLowerCase() || ''
      const name = account.name?.toLowerCase() || ''
      return email.includes(query) || name.includes(query)
    })
  }, [geminiAccounts, deferredSearchQuery])

  const setSwitchAccount = async (account: Account) => {
    if (account.platform !== 'gemini') return
    
    const geminiAccount = account as GeminiAccount
    
    // 防止重复切换
    if (isSwitching) return
    
    setIsSwitching(true)
    
    try {
      // 1. 调用 Rust 后端切换账户配置（包含回填逻辑）
      const config = geminiAccount.config

      if (!config) {
        toast.error(t('gemini.errors.noConfig', 'Configuration not found in account'))
        return
      }
      
      await invoke('switch_gemini_account', { settings: JSON.stringify(config) })
      
      // 2. 将其他账户设置为非激活状态
      const updatePromises = geminiAccounts
        .filter(acc => acc.id !== account.id && acc.isActive)
        .map(acc => updateAccount(acc.id, { isActive: false }))
      
      await Promise.all(updatePromises)
      
      // 3. 更新当前账户为激活状态
      await updateAccount(account.id, { 
        isActive: true,
        lastUsedAt: Date.now()
      })
      
      toast.success(t('gemini.switchSuccess', 'Gemini account switched successfully'))
    } catch (error: any) {
      logError('Failed to switch Gemini account:', error)
      toast.error(t('gemini.errors.switchFailed', `Failed to switch account: ${error.message || error}`))
    } finally {
      setIsSwitching(false)
    }
  }

  const setEdit = (account: Account) => {
    if (account.platform === 'gemini') {
      setEditAccount(account as GeminiAccount)
      setEditOpen(true)
    }
  }

  const handleEditClose = () => {
    setEditOpen(false)
    setEditAccount(null)
  }

  return (
    <div className="platform-account-list">
      <div className="platform-list-header">
        <div className="platform-list-heading">
          <h1 className="platform-list-title">
            Google Gemini
          </h1>
          {versionsLoading ? (
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded animate-pulse">
              {t('common.loading') || 'Loading...'}
            </span>
          ) : geminiVersion?.installed ? (
            geminiVersion.version ? (
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                v{geminiVersion.version}
              </span>
            ) : null
          ) : (
            <span className="text-xs text-muted-foreground bg-destructive/10 text-destructive px-2 py-0.5 rounded">
              {t('common.notInstalled')}
            </span>
          )}
          <p className="platform-list-description">
            {t('platforms.gemini.description', 'Manage your Google Gemini API accounts')}
          </p>
        </div>
        <div className="platform-list-actions">
          {geminiAccounts.length > 0 && (
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

      {geminiAccounts.length === 0 ? (
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
                <GeminiAccountCard
                  key={account.id}
                  account={account}
                  onSwitch={() => setSwitchAccount(account)}
                  onExport={() => setExportOpen(true)}
                  onEdit={() => setEdit(account)}
                />
              ))}
            </div>
          ) : (
            <AccountTable
              accounts={filteredAccounts}
              onSwitch={setSwitchAccount}
              onEdit={setEdit}
              isSwitching={isSwitching}
            />
          )}
        </>
      )}

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        accounts={geminiAccounts}
      />

      <EditAccountDialog
        account={editAccount}
        open={editOpen}
        onClose={handleEditClose}
      />
    </div>
  )
}
