import { AccountDetailsDialog, DetailRow, DetailGrid } from '@/components/accounts/AccountDetailsDialogBase'
import { Badge } from '@/components/ui/badge'
import { QuotaItem } from '@/components/accounts/QuotaItem'
import { cn, getSubscriptionDisplayName, getSubscriptionStyle } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import type { AntigravityAccount } from '@/types/account'
import {
  Mail, User, Shield, Clock, Cpu, AlertTriangle, Gem, Diamond, Circle, BarChart3
} from 'lucide-react'

interface AntigravityAccountDetailsDialogProps {
  account: AntigravityAccount | null
  open: boolean
  onClose: () => void
}

const getSubscriptionIcon = (tier?: string) => {
  const t = (tier || '').toLowerCase()
  if (t.includes('ultra')) return <Gem className="w-4 h-4 fill-current" />
  if (t.includes('pro')) return <Diamond className="w-4 h-4 fill-current" />
  return <Circle className="w-4 h-4" />
}

export function AntigravityAccountDetailsDialog({ account, open, onClose }: AntigravityAccountDetailsDialogProps) {
  const { t } = useTranslation()

  if (!account) return null

  const subscriptionTier = account.quota?.subscription_tier || 'FREE'
  const isForbidden = account.is_forbidden || account.quota?.is_forbidden

  const sections = [
    // 周期用量桶（5h / weekly）
    !!(account.quota?.usage_buckets && account.quota.usage_buckets.length > 0) && {
      title: 'Usage Windows',
      icon: <Clock className="h-4 w-4" />,
      content: (
        <div className="space-y-1.5 p-4 bg-muted/30 rounded-lg border border-border/50">
          {account.quota!.usage_buckets!.map((bucket) => (
            <QuotaItem
              key={bucket.id}
              label={bucket.display_name || bucket.id}
              percentage={bucket.percentage}
              resetTime={bucket.reset_time}
            />
          ))}
        </div>
      )
    },

    // 配额模型
    account.quota && {
      title: 'Model Quotas',
      icon: <BarChart3 className="h-4 w-4" />,
      content: (
        <div className="space-y-2 p-4 bg-muted/30 rounded-lg border border-border/50">
          <div className="flex justify-between text-sm mb-3">
            <span className="text-muted-foreground">Usage Status</span>
            <span className="text-xs text-muted-foreground">
              {account.quota.models?.length || 0} models
            </span>
          </div>
          {isForbidden ? (
            <div className="flex items-center gap-2 text-xs text-red-500 bg-red-50 dark:bg-red-900/10 p-3 rounded-lg border border-red-200 dark:border-red-900/30">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Account is forbidden</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {account.quota.models?.map((model) => (
                <QuotaItem
                  key={model.name}
                  label={model.name}
                  percentage={model.percentage}
                  resetTime={model.reset_time}
                />
              ))}
            </div>
          )}
        </div>
      )
    },

    // 基础信息
    {
      title: t('accounts.basicInfo'),
      icon: <User className="h-4 w-4" />,
      content: (
        <DetailGrid columns={1}>
          <DetailRow
            label={t('common.email')}
            value={account.email}
            icon={<Mail className="h-4 w-4" />}
            copyable
          />
          {account.name && (
            <DetailRow
              label={t('common.name')}
              value={account.name}
              icon={<User className="h-4 w-4" />}
            />
          )}
          <DetailRow
            label="Last Used"
            value={new Date(account.lastUsedAt).toLocaleString()}
            icon={<Clock className="h-4 w-4" />}
          />
          <DetailRow
            label="Created"
            value={new Date(account.createdAt).toLocaleString()}
            icon={<Clock className="h-4 w-4" />}
          />
        </DetailGrid>
      )
    },

    // Token & Device
    {
      title: 'Token & Device',
      icon: <Shield className="h-4 w-4" />,
      content: (
        <DetailGrid columns={1}>
          <DetailRow
            label="Refresh Token"
            value={account.token.refresh_token.substring(0, 20) + '...'}
            copyable
          />
          {account.device_profile && (
            <DetailRow
              label="Machine ID"
              value={account.device_profile.machine_id}
              icon={<Cpu className="h-4 w-4" />}
              copyable
            />
          )}
        </DetailGrid>
      )
    }
  ].filter(Boolean)

  return (
    <AccountDetailsDialog
      open={open}
      onClose={onClose}
      title={account.name || account.email.split('@')[0]}
      subtitle={account.email}
      avatar={
        <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-bold text-lg shadow-sm">
          {account.email.charAt(0).toUpperCase()}
        </div>
      }
      badges={
        <>
          <Badge className={cn('border-0', getSubscriptionStyle(subscriptionTier))}>
            {getSubscriptionIcon(subscriptionTier)}
            <span className="ml-1.5">{getSubscriptionDisplayName(subscriptionTier)}</span>
          </Badge>
          {account.isActive && (
            <Badge className="bg-green-500/90 text-white border-0">
              {t('accounts.active')}
            </Badge>
          )}
          {isForbidden && (
            <Badge variant="destructive" className="flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t('accounts.banned')}
            </Badge>
          )}
          <Badge variant="outline" className="bg-background/50">Antigravity</Badge>
        </>
      }
      sections={sections as any}
      maxWidth="lg"
    />
  )
}
