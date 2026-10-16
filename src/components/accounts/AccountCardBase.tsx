/**
 * 通用账户卡片基础组件
 * 提供统一的布局结构和交互逻辑，支持平台自定义内容渲染
 */
import { memo, useState, ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/toast'
import { useTranslation } from 'react-i18next'
import {
  RefreshCw,
  Trash2,
  Copy,
  Power,
  Info,
  Check,
  Download
} from 'lucide-react'

export interface AccountCardAction {
  icon: typeof Power
  label: string
  onClick: () => void | Promise<void>
  disabled?: boolean
  variant?: 'default' | 'destructive'
  loading?: boolean
}

export interface AccountCardProps {
  // 基础信息
  id: string
  email: string
  name?: string
  isActive?: boolean
  
  // 状态标识
  statusBadge?: ReactNode
  warningBadge?: ReactNode
  
  // 自定义内容区域
  header?: ReactNode
  badges?: ReactNode
  content?: ReactNode
  footer?: ReactNode
  
  // 标准操作
  onSwitch?: () => void | Promise<void>
  onRefresh?: () => void | Promise<void>
  onCopy?: () => void | Promise<void>
  onExport?: () => void | Promise<void>
  onDetails?: () => void
  onDelete?: () => void
  
  // 额外操作
  customActions?: AccountCardAction[]
  
  // 状态
  isRefreshing?: boolean
  isSwitching?: boolean
  
  // 样式
  className?: string
  variant?: 'default' | 'compact' | 'detailed'
}

export const AccountCard = memo(function AccountCard({
  id: _id,
  email,
  name,
  isActive = false,
  statusBadge,
  warningBadge,
  header,
  badges,
  content,
  footer,
  onSwitch,
  onRefresh,
  onCopy,
  onExport,
  onDetails,
  onDelete,
  customActions = [],
  isRefreshing = false,
  isSwitching = false,
  className,
  variant = 'default'
}: AccountCardProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (onCopy) {
      await onCopy()
    } else {
      await navigator.clipboard.writeText(email)
    }
    setCopied(true)
    toast.success(t('accounts.copySuccess'), email)
    setTimeout(() => setCopied(false), 1500)
  }

  const hasWarning = !!warningBadge

  return (
    <Card
      className={cn(
        'account-card group',
        isActive && 'account-card--active',
        hasWarning && 'account-card--warning',
        className
      )}
    >
      {/* 警告标识 */}
      {warningBadge && (
        <div className="absolute top-0 right-0 z-20">
          {warningBadge}
        </div>
      )}


      <CardContent className={cn(
        'account-card-content space-y-3',
        variant === 'compact' && 'p-3'
      )}>
        {/* 自定义头部或默认头部 */}
        {header || (
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3
                  className={cn(
                    "font-semibold text-[13px] truncate cursor-pointer transition-colors",
                    copied ? "text-primary" : "hover:text-primary"
                  )}
                  onClick={handleCopy}
                  title={email}
                >
                  {copied ? t('common.copied') : email}
                </h3>
                {isActive && (
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" aria-label={t('external.active')} />
                )}
              </div>
              {name && (
                <p className="text-xs text-muted-foreground truncate">
                  {name}
                </p>
              )}
            </div>
            {statusBadge}
          </div>
        )}

        {/* 徽章区域 */}
        {badges && (
          <div className="flex items-center gap-2 flex-wrap">
            {badges}
          </div>
        )}

        {/* 自定义内容区域 */}
        {content}

        {/* 底部操作栏 */}
        <div className="account-card-actions">
          {/* 左侧操作 */}
          <div className="flex items-center gap-0.5">
            {onSwitch && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onSwitch}
                disabled={isActive || isSwitching}
                title={t('common.switch')}
              >
                <Power className={cn("h-3.5 w-3.5", isSwitching && "animate-pulse")} />
              </Button>
            )}
            {onRefresh && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onRefresh}
                disabled={isRefreshing}
                title={t('common.refresh')}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleCopy}
              title={t('common.copy')}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </Button>
            {onExport && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onExport}
                title={t('common.export')}
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            )}
            {customActions.map((action, idx) => (
              <Button
                key={idx}
                size="icon"
                variant="ghost"
                className={cn(
                  "h-7 w-7",
                  action.variant === 'destructive' && "hover:bg-red-500/10 hover:text-red-500"
                )}
                onClick={action.onClick}
                disabled={action.disabled || action.loading}
                title={action.label}
              >
                <action.icon className={cn("h-3.5 w-3.5", action.loading && "animate-spin")} />
              </Button>
            ))}
          </div>

          {/* 右侧操作 */}
          <div className="flex items-center gap-0.5">
            {onDetails && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onDetails}
                title={t('common.details')}
              >
                <Info className="h-3.5 w-3.5" />
              </Button>
            )}
            {onDelete && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 hover:bg-red-500/10 hover:text-red-500"
                onClick={onDelete}
                title={t('common.delete')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* 自定义底部 */}
        {footer}
      </CardContent>
    </Card>
  )
})
