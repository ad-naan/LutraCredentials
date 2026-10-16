import { LucideIcon } from 'lucide-react'
import { Account } from './account'
import { PlatformIconComponent } from '@/platforms/icons'
import { ComponentType, ReactNode } from 'react'

export type { Account } from './account'
export type BaseAccount = Account

// ============================================================================
// 添加方式类型
// ============================================================================

export type AddMethodType = 'oauth' | 'token' | 'import' | 'sso' | 'session' | 'builderid' | 'social' | 'json'

export interface AddMethodProps {
  platform: string
  onSuccess: (account: Account) => void
  onError: (error: string) => void
  onClose: () => void
}

export interface AddMethodConfig {
  id: AddMethodType
  name: string
  description: string
  icon: LucideIcon
  /** 添加方式组件 */
  component: ComponentType<AddMethodProps>
}

// ============================================================================
// 账号操作类型
// ============================================================================

export interface AccountAction {
  id: string
  name: string
  icon: LucideIcon
  variant?: 'default' | 'destructive' | 'outline'
  handler: (account: Account) => void | Promise<void>
  visible?: (account: Account) => boolean
  disabled?: (account: Account) => boolean
}

// ============================================================================
// 平台配置
// ============================================================================

export interface Quota {
  used: number
  total: number
  percentage: number
  resetAt?: string
}

export interface PlatformFeatures {
  oauth?: boolean
  quota?: boolean
  proxy?: boolean
  machineId?: boolean
  autoRefresh?: boolean
}

export interface PlatformConfig {
  id: string
  name: string
  icon: PlatformIconComponent
  color: string
  description: string

  // 页面组件
  AccountList: ComponentType<any>
  AccountDetail?: ComponentType<any>
  Settings?: ComponentType<any>

  // 特性标志
  features: PlatformFeatures

  // 添加方式配置
  addMethods: AddMethodConfig[]

  // 账号卡片额外操作
  cardActions?: AccountAction[]

  // 自定义渲染
  renderUsage?: (account: Account) => ReactNode
  renderBadges?: (account: Account) => ReactNode
}

// 平台注册表
export type PlatformRegistry = Map<string, PlatformConfig>
