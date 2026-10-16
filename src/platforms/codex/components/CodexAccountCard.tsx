import { memo, useState } from 'react'
import { AccountCard } from '@/components/accounts/AccountCardBase'
import { Badge } from '@/components/ui/badge'
import { CodexAccountDetailsDialog } from './CodexAccountDetailsDialog'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { toast } from '@/lib/toast'
import { Edit, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { invoke } from '@tauri-apps/api/core'
import type { CodexAccount, CodexUsage } from '@/types/account'

interface CodexAccountCardProps {
  account: CodexAccount
  onSwitch?: () => void
  onExport?: () => void
  onEdit?: () => void
}

export const CodexAccountCard = memo(function CodexAccountCard({
  account,
  onSwitch,
  onExport,
  onEdit,
}: CodexAccountCardProps) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const deleteAccount = usePlatformStore(state => state.deleteAccount)
  const updateAccount = usePlatformStore(state => state.updateAccount)

  const isOAuth = !!account.oauth

  const handleSwitch = () => {
    if (onSwitch) {
      onSwitch()
    }
  }

  const handleDelete = async () => {
    try {
      await deleteAccount(account.id)
      toast.success(t('accounts.deleteSuccess'), account.email)
    } catch (e: any) {
      toast.error(t('accounts.deleteFailed'), e.message || t('common.unknownError'))
    }
  }

  // OAuth 账号：刷新 token 并查询订阅状态
  const handleCheckPlan = async () => {
    if (!account.oauth) return

    try {
      setIsChecking(true)

      let oauth = account.oauth
      try {
        const refreshed = await invoke<CodexAccount['oauth']>('codex_oauth_refresh', {
          refreshToken: oauth.refresh_token,
          idToken: oauth.id_token,
        })
        if (refreshed?.access_token) {
          oauth = { ...oauth, ...refreshed }
        }
      } catch (e) {
        // token 刷新失败时用现有凭据尝试查询
      }

      const usage = await invoke<CodexUsage>('codex_check_quota', {
        accessToken: oauth.access_token,
        accountId: oauth.account_id || null,
      })
      await updateAccount(account.id, { oauth, usage })

      toast.success(
        t('platforms.codex.usage.refreshed', 'Subscription refreshed'),
        usage.plan || undefined,
      )
    } catch (e: any) {
      toast.error(t('platforms.codex.usage.refreshFailed', 'Failed to refresh subscription'), e.message || t('common.unknownError'))
    } finally {
      setIsChecking(false)
    }
  }

  return (
    <>
      <AccountCard
        id={account.id}
        email={account.email}
        name={account.name}
        isActive={account.isActive}
        badges={
          <>
            <Badge variant="outline" className="text-[10px] h-5 px-2 text-muted-foreground">
              Codex
            </Badge>
            {isOAuth && (
              <Badge variant="outline" className="text-[10px] h-5 px-2 text-primary border-primary/40">
                {account.usage?.plan || 'ChatGPT'}
              </Badge>
            )}
          </>
        }
        onSwitch={handleSwitch}
        onExport={onExport}
        onDetails={() => setDetailsOpen(true)}
        onDelete={() => setDeleteConfirmOpen(true)}
        customActions={[
          ...(onEdit ? [{
            icon: Edit,
            label: t('common.edit'),
            onClick: onEdit
          }] : []),
          ...(isOAuth ? [{
            icon: BarChart3,
            label: isChecking ? t('platforms.codex.usage.checking', 'Checking...') : t('platforms.codex.usage.check', 'Check Subscription'),
            onClick: handleCheckPlan,
            loading: isChecking,
            disabled: isChecking
          }] : []),
        ]}
      />

      <CodexAccountDetailsDialog
        account={account}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={t('common.delete')}
        description={t('common.confirmDelete', { name: account.email })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
})
