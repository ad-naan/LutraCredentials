export type KnownPlatformType =
  | 'antigravity'
  | 'kiro'
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'github-copilot'
  | 'windsurf'
  | 'cursor'
  | 'codebuddy'
  | 'codebuddy_cn'
  | 'qoder'
  | 'trae'
  | 'zed'
  | 'grok'
  | 'zcode'
  | 'workbuddy'

export type PlatformType = KnownPlatformType | (string & {})

// --- Common Fields ---
export interface BaseAccount {
  id: string
  platform: PlatformType
  email: string
  name?: string
  avatar?: string
  isActive: boolean
  lastUsedAt: number
  createdAt: number
}

// --- Antigravity Specifics ---
export interface AntigravityTokenData {
  access_token: string
  refresh_token: string
  expires_in: number
  expiry_timestamp: number
  token_type: string
  session_id?: string
}

export interface ModelQuota {
  name: string
  percentage: number
  reset_time: string
}

export interface UsageBucket {
  id: string
  display_name?: string
  percentage: number
  reset_time: string
}

export interface AntigravityQuotaData {
  models: ModelQuota[]
  usage_buckets?: UsageBucket[]
  last_updated: number
  is_forbidden: boolean
  subscription_tier?: 'FREE' | 'PRO' | 'ULTRA'
}

export interface DeviceProfile {
  machine_id: string
  mac_machine_id: string
  dev_device_id: string
  sqm_id: string
}

export interface AntigravityAccount extends BaseAccount {
  platform: 'antigravity'
  token: AntigravityTokenData
  quota?: AntigravityQuotaData
  is_forbidden: boolean
  proxy_id?: string
  device_profile?: DeviceProfile
}

// --- Kiro Specifics ---
export type KiroIdpType = 'Google' | 'Github' | 'BuilderId' | 'AWSIdC' | 'Enterprise'
export type KiroSubscriptionType = 'Free' | 'Pro' | 'Ultra' | 'Enterprise'
export type KiroAccountStatus = 'active' | 'error' | 'refreshing' | 'unknown' | 'banned'

export interface KiroCredentials {
  accessToken: string
  refreshToken?: string
  clientId?: string
  clientSecret?: string
  region?: string
  expiresAt?: number
  authMethod?: 'social' | 'oidc' | 'sso'
  provider?: string
}

export interface KiroSubscription {
  type: KiroSubscriptionType
  title?: string
  expiresAt?: number
  daysRemaining?: number
  autoRenew?: boolean
}

export interface KiroUsageBonus {
  amount: number
  reason: string
  expiresAt?: number
}

export interface KiroUsage {
  current: number
  limit: number
  percentUsed: number
  lastUpdated: number
  baseLimit?: number
  baseCurrent?: number
  freeTrialLimit?: number
  freeTrialCurrent?: number
  freeTrialExpiry?: string
  bonuses?: KiroUsageBonus[]
  nextResetDate?: string
  resourceDetail?: string
}

export interface KiroAccount extends BaseAccount {
  platform: 'kiro'
  idp: KiroIdpType
  userId?: string
  credentials: KiroCredentials
  machineId?: string
  subscription: KiroSubscription
  usage: KiroUsage
  status: KiroAccountStatus
  lastError?: string
  lastCheckedAt?: number
  groupId?: string
  tags?: string[]
}

// --- Claude Specifics ---
export interface ClaudeEnvConfig {
  env: {
    ANTHROPIC_API_KEY?: string
    ANTHROPIC_AUTH_TOKEN?: string
    ANTHROPIC_BASE_URL?: string
    ANTHROPIC_MODEL?: string
    ANTHROPIC_DEFAULT_HAIKU_MODEL?: string
    ANTHROPIC_DEFAULT_SONNET_MODEL?: string
    ANTHROPIC_DEFAULT_OPUS_MODEL?: string
    [key: string]: any
  }
}

/** Claude 官方 OAuth 凭据 */
export interface ClaudeOAuthData {
  access_token: string
  refresh_token: string
  /** 毫秒时间戳 */
  expires_at: number
  scopes?: string[]
}

/** Claude 订阅用量（5 小时 / 7 天窗口） */
export interface ClaudeUsage {
  five_hour_percentage?: number
  five_hour_reset_time?: string
  seven_day_percentage?: number
  seven_day_reset_time?: string
}

export interface ClaudeAccount extends BaseAccount {
  platform: 'claude'
  providerId?: string
  /** 官方 OAuth（订阅账号）；与 API Key 导入互斥 */
  oauth?: ClaudeOAuthData
  usage?: ClaudeUsage
  config?: ClaudeEnvConfig
}

// --- Codex Specifics ---
export interface AuthJson {
  OPENAI_API_KEY?: string
  [key: string]: any
}

export interface ConfigToml {
  model_provider?: string
  model?: string
  model_reasoning_effort?: string
  disable_response_storage?: boolean
  model_providers?: {
    [key: string]: {
      name?: string
      base_url?: string
      wire_api?: string
      requires_openai_auth?: boolean
      [key: string]: any
    }
  }
  [key: string]: any
}

export interface CodexConfig {
  auth: AuthJson
  config: ConfigToml
  [key: string]: any
}

/** Codex (ChatGPT) 官方 OAuth 凭据 */
export interface CodexOAuthData {
  id_token: string
  access_token: string
  refresh_token: string
  account_id?: string
}

/** Codex 订阅状态 */
export interface CodexUsage {
  plan?: string
}

export interface CodexAccount extends BaseAccount {
  platform: 'codex'
  providerId?: string
  /** 官方 OAuth（ChatGPT 订阅账号）；与 API Key 导入互斥 */
  oauth?: CodexOAuthData
  usage?: CodexUsage
  config?: CodexConfig
}

// --- Gemini Specifics ---
export interface EnvConfig {
  GOOGLE_GEMINI_BASE_URL?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  [key: string]: any
}

export interface ConfigJson {
  [key: string]: any
}

export interface SettingsJson {
  ide?: {
    enabled?: boolean
    [key: string]: any
  }
  security?: {
    auth?: {
      selectedType?: string
      [key: string]: any
    }
    [key: string]: any
  }
  [key: string]: any
}

export interface GeminiConfig {
  env?: EnvConfig
  config: ConfigJson
  settings: SettingsJson
  [key: string]: any
}

export interface GeminiAccount extends BaseAccount {
  platform: 'gemini'
  providerId?: string
  config: GeminiConfig
}

// --- Generic External Platform Account ---
export interface GenericAccount extends BaseAccount {
  platform: Exclude<PlatformType, 'antigravity' | 'kiro' | 'claude' | 'codex' | 'gemini'>
  providerId?: string
  config?: Record<string, any>
  notes?: string
  source?: 'json' | 'local' | 'oauth' | 'token' | string
}

// --- Union Type ---
export type Account =
  | AntigravityAccount
  | KiroAccount
  | ClaudeAccount
  | CodexAccount
  | GeminiAccount
  | GenericAccount
