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
// 平台账号操作契约（accountOps）
// ============================================================================

/**
 * 单个账号操作的返回结果。
 * - success：操作是否成功
 * - error：失败原因（用于写入账号 lastError）
 * - patch：需要合并回账号并持久化的字段（如刷新后的 credentials / usage / status）
 */
export interface AccountOpResult {
  success: boolean
  error?: string
  patch?: Partial<Account>
}

/**
 * 平台账号操作契约。
 *
 * 平台通过实现这些**可选**方法，声明自己支持哪些「一键切号 / 刷新 / 状态检测」能力，
 * 由 usePlatformStore 统一调度，从而彻底移除全局 store 中的平台硬编码。
 * 未实现的平台在调用对应能力时会被明确拒绝（而不是静默失败）。
 */
export interface PlatformAccountOps {
  /** 在该主机上激活此账号（写 Token / SSO 缓存 / 数据库等）；返回需要持久化的补丁。 */
  switchAccount?: (account: Account) => Promise<Partial<Account> | void>
  /** 刷新凭据（Token）与配额。 */
  refresh?: (account: Account) => Promise<AccountOpResult>
  /** 检测账号健康状况（是否封禁 / 状态 / 配额）。 */
  checkStatus?: (account: Account) => Promise<AccountOpResult>
  /** 判断凭据是否即将过期，用于自动刷新调度。 */
  isExpiring?: (account: Account) => boolean
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

  // 账号操作契约（切号 / 刷新 / 状态检测），由 store 统一调度
  accountOps?: PlatformAccountOps

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
