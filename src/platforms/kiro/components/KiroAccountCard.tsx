import { logError } from '@/lib/logger'
import { memo, useState } from 'react'
import { AccountCard } from '@/components/accounts/AccountCardBase'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { KiroAccountDetailsDialog } from './KiroAccountDetailsDialog'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { KiroAccount } from '@/types/account'
import { Gem, Diamond, Circle, Loader2, Ban } from 'lucide-react'

interface KiroAccountCardProps {
  account: KiroAccount
  onExport?: () => void
}

const getSubscriptionIcon = (type?: string) => {
  const t = (type || '').toLowerCase()
  if (t.includes('pro') && t.includes('plus')) return <Gem className="w-3 h-3 fill-current" />
  if (t.includes('pro')) return <Diamond className="w-3 h-3 fill-current" />
  return <Circle className="w-3 h-3" />
}

const getSubscriptionStyle = (type?: string) => {
  const t = (type || '').toLowerCase()
  if (t.includes('pro') && t.includes('plus')) return 'bg-purple-600 text-white border-purple-600'
  if (t.includes('pro')) return 'bg-blue-600 text-white border-blue-600'
  return 'bg-secondary text-secondary-foreground'
}

export const KiroAccountCard = memo(function KiroAccountCard({
  account,
  onExport,
}: KiroAccountCardProps) {
  const { t } = useTranslation()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const deleteAccount = usePlatformStore(state => state.deleteAccount)
  const refreshAccount = usePlatformStore(state => state.refreshAccount)
  const switchAccount = usePlatformStore(state => state.switchAccount)

  const subscriptionType = account.subscription?.type || 'Free'
  const usagePercent = (account.usage?.percentUsed || 0) * 100
  const isBanned = account.status === 'banned'
  const isError = account.status === 'error'

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
    setIsSwitching(true)
    try {
      await switchAccount(account.id)
      toast.success(t('accounts.switchSuccess'), account.email)
    } catch (e: any) {
      logError('Failed to switch account:', e)
      toast.error(t('accounts.switchFailed'), e.message || t('common.unknownError'))
    } finally {
      setIsSwitching(false)
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
          (isBanned || isError) ? (
            <div className="bg-destructive/90 backdrop-blur text-white text-[10px] px-2 py-0.5 rounded-bl-lg font-medium flex items-center gap-1">
              {isBanned ? <><Ban className="w-3 h-3" />BANNED</> : 'ERROR'}
            </div>
          ) : undefined
        }
        badges={
          <>
            <Badge className={cn('text-[10px] h-5 px-2 border-0 shadow-sm', getSubscriptionStyle(subscriptionType))}>
              {getSubscriptionIcon(subscriptionType)}
              <span className="ml-1.5 font-medium">{subscriptionType.toUpperCase()}</span>
            </Badge>
            <Badge variant="outline" className="text-[10px] h-5 px-2 text-muted-foreground">
              {account.idp || 'Kiro'}
            </Badge>
            {account.status === 'refreshing' && (
              <Badge variant="outline" className="text-[10px] h-5 px-2 bg-blue-500/10 text-blue-600 border-0">
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                REFRESHING
              </Badge>
            )}
          </>
        }
        content={
          account.usage && (
            <div className="space-y-2 pt-1">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">{t('accounts.usage')}</span>
                <span className={cn(
                  "font-mono font-medium",
                  usagePercent > 80 ? "text-amber-500" : "text-foreground/80"
                )}>
                  {usagePercent.toFixed(0)}%
                </span>
              </div>
              <Progress
                value={usagePercent}
                className="h-1.5 bg-secondary/50"
                indicatorClassName={cn(
                  "transition-all duration-500",
                  usagePercent > 90 ? "bg-red-500" :
                    usagePercent > 70 ? "bg-amber-500" : "bg-primary"
                )}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground/70">
                <span>{account.usage.current} / {account.usage.limit}</span>
                {account.usage.lastUpdated && (
                  <span>{new Date(account.usage.lastUpdated).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          )
        }
        onSwitch={handleSwitch}
        onRefresh={handleRefresh}
        onExport={onExport}
        onDetails={() => setDetailsOpen(true)}
        onDelete={() => setDeleteConfirmOpen(true)}
        isRefreshing={isRefreshing}
        isSwitching={isSwitching}
      />

      <KiroAccountDetailsDialog
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
