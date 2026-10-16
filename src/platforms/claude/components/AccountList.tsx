import { logError } from '@/lib/logger'
import { useState, useMemo, useDeferredValue } from 'react'
import { AddAccountDialog } from './AddAccountDialog'
import { EditAccountDialog } from './EditAccountDialog'
import { ExportDialog } from '@/components/dialogs/ExportDialog'
import { ClaudeAccountCard } from './ClaudeAccountCard'
import { AccountTable } from '@/components/accounts/AccountTable'
import { AccountSearch } from '@/components/accounts/AccountSearch'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { useTranslation } from 'react-i18next'
import { Download, LayoutGrid, List, Search } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import type { Account, ClaudeAccount } from '@/types/account'
import { usePlatformVersions } from '@/hooks/usePlatformVersions'

type ViewMode = 'grid' | 'list'

export function ClaudeAccountList() {
  const { t } = useTranslation()
  const accounts = usePlatformStore((state) => state.accounts)
  const updateAccount = usePlatformStore((state) => state.updateAccount)
  const [exportOpen, setExportOpen] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [editAccount, setEditAccount] = useState<ClaudeAccount | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [searchQuery, setSearchQuery] = useState('')
  const { versions, loading: versionsLoading } = usePlatformVersions()
  
  // 性能优化：使用 useDeferredValue 延迟搜索查询，避免输入卡顿
  const deferredSearchQuery = useDeferredValue(searchQuery)
  
  // 获取 Claude 平台版本信息
  const claudeVersion = versions.find(v => v.platform === 'claude')

  const claudeAccounts = useMemo(
    () => accounts.filter((acc): acc is ClaudeAccount => acc.platform === 'claude'),
    [accounts]
  )

  const filteredAccounts = useMemo(() => {
    if (!deferredSearchQuery.trim()) return claudeAccounts

    const query = deferredSearchQuery.toLowerCase().trim()
    return claudeAccounts.filter((account) => {
      const email = account.email?.toLowerCase() || ''
      const name = account.name?.toLowerCase() || ''
      return email.includes(query) || name.includes(query)
    })
  }, [claudeAccounts, deferredSearchQuery])

  const setSwitchAccount = async (account: Account) => {
    if (account.platform !== 'claude') return
    
    const claudeAccount = account as ClaudeAccount
    
    // 防止重复切换
    if (isSwitching) return
    
    setIsSwitching(true)
    
    try {
      if (claudeAccount.oauth) {
        // 官方 OAuth 账号：先刷新 token，再写入 .credentials.json
        let oauth = claudeAccount.oauth
        try {
          const refreshed = await invoke<ClaudeAccount['oauth']>('claude_oauth_refresh', {
            refreshToken: oauth.refresh_token,
          })
          if (refreshed?.access_token) {
            oauth = { ...oauth, ...refreshed }
          }
        } catch (e) {
          // 刷新失败时沿用现有凭据继续切换
          logError('Failed to refresh Claude OAuth token:', e)
        }

        await invoke('claude_oauth_switch', { credentials: JSON.stringify(oauth) })

        await Promise.all(
          claudeAccounts
            .filter((acc) => acc.id !== account.id && acc.isActive)
            .map((acc) => updateAccount(acc.id, { isActive: false })),
        )
        await updateAccount(account.id, { oauth, isActive: true, lastUsedAt: Date.now() })

        toast.success(t('claude.switchSuccess', 'Account switched successfully'))
        return
      }

      // API Key / 中转站账号：写 settings.json env
      const config = claudeAccount.config

      if (!config) {
        toast.error(t('claude.errors.noApiKey', 'API Key not found in account config'))
        return
      }
      
      await invoke('switch_claude_account', { settings: JSON.stringify(config) })
      
      // 将其他账户设置为非激活状态
      const updatePromises = claudeAccounts
        .filter(acc => acc.id !== account.id && acc.isActive)
        .map(acc => updateAccount(acc.id, { isActive: false }))
      
      await Promise.all(updatePromises)
      
      // 更新当前账户为激活状态
      await updateAccount(account.id, { 
        isActive: true,
        lastUsedAt: Date.now()
      })
      
      toast.success(t('claude.switchSuccess', 'Account switched successfully'))
    } catch (error: any) {
      logError('Failed to switch Claude account:', error)
      toast.error(t('claude.errors.switchFailed', `Failed to switch account: ${error.message || error}`))
    } finally {
      setIsSwitching(false)
    }
  }

  const setEdit = (account: Account) => {
    if (account.platform === 'claude') {
      setEditAccount(account as ClaudeAccount)
      setEditOpen(true)
    }
  }

  const handleEditClose = () => {
    setEditOpen(false)
    setEditAccount(null)
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
              Claude
            </h2>
            {versionsLoading ? (
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded animate-pulse">
                {t('common.loading') || 'Loading...'}
              </span>
            ) : claudeVersion?.installed ? (
              claudeVersion.version ? (
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                  v{claudeVersion.version}
                </span>
              ) : null
            ) : (
              <span className="text-xs text-muted-foreground bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                {t('common.notInstalled')}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-2 max-w-3xl text-lg font-light">
            {t('platforms.claude.description', 'Manage your Claude API accounts')}
          </p>
        </div>
        <div className="flex w-full flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-end xl:w-auto">
          {claudeAccounts.length > 0 && (
            <>
              <AccountSearch
                value={searchQuery}
                onChange={setSearchQuery}
                resultCount={filteredAccounts.length}
                className="w-full md:w-72"
              />
              <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm border border-white/10 rounded-lg p-1">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-7 px-2"
                  title={t('common.gridView', 'Grid View')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-7 px-2"
                  title={t('common.listView', 'List View')}
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportOpen(true)}
                className="w-full bg-background/50 border-white/10 backdrop-blur-sm hover:bg-background/80 md:w-auto"
              >
                <Download className="h-4 w-4 mr-2" />
                {t('common.export')}
              </Button>
            </>
          )}
          <div className="relative z-10">
            <AddAccountDialog />
          </div>
        </div>
      </div>

      {claudeAccounts.length === 0 ? (
        <Card className="bg-card/30 border-dashed border-2 border-muted hover:border-muted-foreground/50 transition-colors">
          <CardContent className="flex flex-col items-center justify-center py-24">
            <div className="p-4 rounded-full bg-background/50 mb-4 ring-1 ring-white/10">
              <div className="h-8 w-8 rounded-full bg-primary/20 animate-pulse" />
            </div>
            <p className="text-lg font-medium mb-2">{t('accounts.noAccounts', 'No accounts yet')}</p>
            <p className="text-sm text-muted-foreground mb-6">Get started by adding your first account</p>
            <AddAccountDialog />
          </CardContent>
        </Card>
      ) : filteredAccounts.length === 0 ? (
        <Card className="bg-card/30 border-dashed border-2 border-muted">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Search className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium mb-2">{t('common.noResults', 'No results found')}</p>
            <p className="text-sm text-muted-foreground">
              {t('common.tryDifferentSearch', 'Try a different search term')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredAccounts.map((account) => (
                <ClaudeAccountCard
                  key={account.id}
                  account={account}
                  onSwitch={() => setSwitchAccount(account)}
                  onExport={() => setExportOpen(true)}
                  onEdit={account.oauth ? undefined : () => setEdit(account)}
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
        accounts={claudeAccounts}
      />

      <EditAccountDialog
        account={editAccount}
        open={editOpen}
        onClose={handleEditClose}
      />
    </div>
  )
}
