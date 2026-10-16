import { memo, useState } from 'react'
import { AccountCard } from '@/components/accounts/AccountCardBase'
import { QuotaItem } from '@/components/accounts/QuotaItem'
import { Badge } from '@/components/ui/badge'
import { ClaudeAccountDetailsDialog } from './ClaudeAccountDetailsDialog'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { toast } from '@/lib/toast'
import { Edit, CheckCircle, BarChart3 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePlatformStore } from '@/stores/usePlatformStore'
import { ClaudeAccountService } from '../services/ClaudeAccountService'
import type { ClaudeAccount } from '@/types/account'

interface ClaudeAccountCardProps {
  account: ClaudeAccount
  onExport?: () => void
  onEdit?: () => void
  onSwitch?: () => void
}

export const ClaudeAccountCard = memo(function ClaudeAccountCard({
  account,
  onSwitch,
  onExport,
  onEdit,
}: ClaudeAccountCardProps) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const deleteAccount = usePlatformStore(state => state.deleteAccount)
  const refreshAccount = usePlatformStore(state => state.refreshAccount)

  const isOAuth = !!account.oauth

  const handleDelete = async () => {
    try {
      await deleteAccount(account.id)
      toast.success(t('accounts.deleteSuccess'), account.email)
    } catch (e: any) {
      toast.error(t('accounts.deleteFailed'), e.message || t('common.unknownError'))
    }
  }

  // API Key / 中转站账号：校验密钥是否可用
  const handleVerify = async () => {
    try {
      setIsVerifying(true)

      const result = await ClaudeAccountService.verifyApiKey(account)

      if (result.valid) {
        toast.success(t('platforms.claude.verifySuccess'))
      } else {
        toast.error(t('platforms.claude.verifyFailed'), result.message)
      }
    } catch (e: any) {
      toast.error(t('platforms.claude.verifyFailed'), e.message || t('common.unknownError'))
    } finally {
      setIsVerifying(false)
    }
  }

  // OAuth 账号：刷新凭据并更新订阅用量（由 store 依据 accountOps 契约执行）
  const handleRefreshUsage = async () => {
    if (!account.oauth) return

    setIsVerifying(true)
    try {
      const success = await refreshAccount(account.id)
      if (success) {
        toast.success(t('platforms.claude.usage.refreshed', 'Usage refreshed'))
      } else {
        toast.error(t('platforms.claude.usage.refreshFailed', 'Failed to refresh usage'))
      }
    } finally {
      setIsVerifying(false)
    }
  }

  const usage = account.usage

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
              Claude
            </Badge>
            {isOAuth && (
              <Badge variant="outline" className="text-[10px] h-5 px-2 text-primary border-primary/40">
                OAuth
              </Badge>
            )}
          </>
        }
        content={
          isOAuth && usage && (
            <div className="flex flex-wrap gap-1.5">
              {usage.five_hour_percentage !== undefined && (
                <QuotaItem
                  label="5h"
                  percentage={usage.five_hour_percentage}
                  resetTime={usage.five_hour_reset_time}
                />
              )}
              {usage.seven_day_percentage !== undefined && (
                <QuotaItem
                  label="7d"
                  percentage={usage.seven_day_percentage}
                  resetTime={usage.seven_day_reset_time}
                />
              )}
            </div>
          )
        }
        onSwitch={onSwitch}
        onExport={onExport}
        onDetails={() => setDetailsOpen(true)}
        onDelete={() => setDeleteConfirmOpen(true)}
        customActions={[
          ...(onEdit ? [{
            icon: Edit,
            label: t('common.edit'),
            onClick: onEdit
          }] : []),
          isOAuth
            ? {
                icon: BarChart3,
                label: isVerifying ? t('platforms.claude.usage.refreshing', 'Refreshing...') : t('platforms.claude.usage.refresh', 'Refresh Usage'),
                onClick: handleRefreshUsage,
                loading: isVerifying,
                disabled: isVerifying
              }
            : {
                icon: CheckCircle,
                label: isVerifying ? t('platforms.claude.verifying') : t('platforms.claude.verify'),
                onClick: handleVerify,
                loading: isVerifying,
                disabled: isVerifying
              }
        ]}
      />

      <ClaudeAccountDetailsDialog
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
