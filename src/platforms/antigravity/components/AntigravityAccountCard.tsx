import { logError } from '@/lib/logger'
import { memo, useState } from 'react'
import { AccountCard } from '@/components/accounts/AccountCardBase'
import { Badge } from '@/components/ui/badge'
import { QuotaItem } from '@/components/accounts/QuotaItem'
import { AntigravityAccountDetailsDialog } from './AntigravityAccountDetailsDialog'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { cn, getSubscriptionDisplayName, getSubscriptionStyle } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { AntigravityAccount } from '@/types/account'
import { Ban, Gem, Diamond, Circle } from 'lucide-react'

interface AntigravityAccountCardProps {
  account: AntigravityAccount
  onExport?: () => void
}

const getSubscriptionIcon = (tier?: string) => {
  const t = (tier || '').toLowerCase()
  if (t.includes('ultra')) return <Gem className="w-3 h-3 fill-current" />
  if (t.includes('pro')) return <Diamond className="w-3 h-3 fill-current" />
  return <Circle className="w-3 h-3" />
}

export const AntigravityAccountCard = memo(function AntigravityAccountCard({
  account,
  onExport,
}: AntigravityAccountCardProps) {
  const { t } = useTranslation()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const deleteAccount = usePlatformStore(state => state.deleteAccount)
  const refreshAccount = usePlatformStore(state => state.refreshAccount)
  const switchAccount = usePlatformStore(state => state.switchAccount)

  const subscriptionTier = account.quota?.subscription_tier || 'FREE'
  const isForbidden = account.is_forbidden || account.quota?.is_forbidden

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      const success = await refreshAccount(account.id)
      if (success) {
        toast.success(t('accounts.refreshSuccess'), account.email)
      } else {
        toast.error(t('accounts.refreshFailed'), t('common.unknownError'))
      }
    } catch (e: any) {
      logError('Failed to refresh:', e)
      toast.error(t('accounts.refreshFailed'), e.message || t('common.unknownError'))
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleSwitch = async () => {
    try {
      await switchAccount(account.id)
      toast.success(t('accounts.switchSuccess'), account.email)
    } catch (e: any) {
      logError('Failed to switch account:', e)
      toast.error(t('accounts.switchFailed'), e.message || t('common.unknownError'))
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

  return (
    <>
      <AccountCard
        id={account.id}
        email={account.email}
        name={account.name}
        isActive={account.isActive}
        warningBadge={
          isForbidden ? (
            <div className="bg-destructive/90 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded-bl-lg font-medium flex items-center gap-1">
              <Ban className="w-3 h-3" />
              BANNED
            </div>
          ) : undefined
        }
        badges={
          <>
            <Badge className={cn('text-[10px] h-5 px-2 border-0 shadow-sm', getSubscriptionStyle(subscriptionTier))}>
              {getSubscriptionIcon(subscriptionTier)}
              <span className="ml-1.5 font-medium">{getSubscriptionDisplayName(subscriptionTier)}</span>
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5 px-2 text-muted-foreground">
              Antigravity
            </Badge>
          </>
        }
        content={
          account.quota && (
            <div className="space-y-1.5 pt-1">
              {isForbidden ? (
                <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/10 p-2 rounded-lg border border-red-200 dark:border-red-900/30">
                  <Ban className="w-4 h-4 shrink-0" />
                  <span>Account Forbidden</span>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {account.quota.models?.slice(0, 3).map((model) => (
                    <QuotaItem
                      key={model.name}
                      label={model.name}
                      percentage={model.percentage}
                      resetTime={model.reset_time}
                    />
                  ))}
                  {account.quota.models && account.quota.models.length > 3 && (
                    <div className="text-[10px] text-muted-foreground/50 text-center">
                      +{account.quota.models.length - 3} more models
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }
        onSwitch={handleSwitch}
        onRefresh={handleRefresh}
        onExport={onExport}
        onDetails={() => setDetailsOpen(true)}
        onDelete={() => setDeleteConfirmOpen(true)}
        isRefreshing={isRefreshing}
      />

      <AntigravityAccountDetailsDialog
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
