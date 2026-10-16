import { logError, logInfo } from '@/lib/logger'
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { Account, KiroAccount } from '@/types/account'
import { getAccountOps } from '@/platforms/accountOps'

// Auto-refresh timer
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null

const AUTO_REFRESH_STORAGE_KEY = 'lutra.autoRefresh'
const DEFAULT_AUTO_REFRESH_INTERVAL = 5
const MIN_AUTO_REFRESH_INTERVAL = 1

interface AutoRefreshSettings {
  enabled: boolean
  interval: number
}

/** 读取持久化的自动刷新配置（默认启用，5 分钟） */
function loadAutoRefreshSettings(): AutoRefreshSettings {
  try {
    const raw = localStorage.getItem(AUTO_REFRESH_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AutoRefreshSettings>
      const interval = Number(parsed.interval)
      return {
        enabled: parsed.enabled !== false,
        interval:
          Number.isFinite(interval) && interval >= MIN_AUTO_REFRESH_INTERVAL
            ? Math.round(interval)
            : DEFAULT_AUTO_REFRESH_INTERVAL,
      }
    }
  } catch (error) {
    logError('Failed to read auto-refresh settings:', error)
  }

  return { enabled: true, interval: DEFAULT_AUTO_REFRESH_INTERVAL }
}

function persistAutoRefreshSettings(settings: AutoRefreshSettings) {
  try {
    localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    logError('Failed to persist auto-refresh settings:', error)
  }
}

const initialAutoRefresh = loadAutoRefreshSettings()

// Backend Account Structure (matches Rust struct)
interface BackendAccount {
  id: string
  platform: string
  name: string | null
  email: string
  avatar: string | null
  is_active: boolean
  last_used_at: number
  created_at: number
  platform_data: any
}

interface PlatformStore {
  accounts: Account[]
  activeAccount: Account | null
  selectedPlatform: string | null
  isLoading: boolean
  error: string | null
  
  // Auto-refresh settings
  autoRefreshEnabled: boolean
  autoRefreshInterval: number // minutes

  loadAllAccounts: () => Promise<void>
  addAccount: (account: Account) => Promise<void>
  updateAccount: (id: string, data: Partial<Account>) => Promise<void>
  deleteAccount: (id: string) => Promise<void>
  setActiveAccount: (account: Account | null) => void
  setSelectedPlatform: (platform: string | null) => void
  getAccountsByPlatform: (platform: string) => Account[]
  
  // 通用账号操作（由各平台 accountOps 契约驱动，不再硬编码单一平台）
  switchAccount: (id: string) => Promise<void>
  refreshAccount: (id: string) => Promise<boolean>
  checkAccountStatus: (id: string) => Promise<void>
  batchRefreshAccounts: (ids: string[]) => Promise<void>
  batchCheckAccountStatus: (ids: string[]) => Promise<void>
  canSwitch: (platform: string) => boolean
  canRefresh: (platform: string) => boolean
  
  // Auto-refresh management
  startAutoRefresh: () => void
  stopAutoRefresh: () => void
  checkAndRefreshExpiringTokens: () => Promise<void>
  setAutoRefresh: (enabled: boolean, interval?: number) => void
}

// Helper: Transform Frontend -> Backend
const toBackend = (account: Account): BackendAccount => {
  // Extract common fields
  const { id, platform, name, email, avatar, isActive, lastUsedAt, createdAt, ...rest } = account

  return {
    id,
    platform,
    name: name || null,
    email,
    avatar: avatar || null,
    is_active: isActive,
    last_used_at: lastUsedAt,
    created_at: createdAt,
    platform_data: rest // Store remaining platform-specific fields in platform_data
  }
}

// Helper: Transform Backend -> Frontend
const toFrontend = (backend: BackendAccount): Account => {
  const { id, platform, name, email, avatar, is_active, last_used_at, created_at, platform_data } = backend

  const common = {
    id,
    platform: platform as Account['platform'],
    name: name || undefined,
    email,
    avatar: avatar || undefined,
    isActive: is_active,
    lastUsedAt: last_used_at, // Provide default if missing? No, backend guarantees i64.
    createdAt: created_at,
  }

  // Merge common fields with platform data
  return { ...common, ...platform_data } as Account
}

export const usePlatformStore = create<PlatformStore>((set, get) => ({
  accounts: [],
  activeAccount: null,
  selectedPlatform: null,
  isLoading: false,
  error: null,
  autoRefreshEnabled: initialAutoRefresh.enabled,
  autoRefreshInterval: initialAutoRefresh.interval, // minutes

  loadAllAccounts: async () => {
    set({ isLoading: true, error: null })
    try {
      const backendAccounts = await invoke<BackendAccount[]>('get_accounts')
      const accounts = backendAccounts.map(toFrontend)
      set({ accounts, isLoading: false })
    } catch (err: any) {
      logError('Failed to load accounts:', err)
      set({ error: err.message || 'Failed to load accounts', isLoading: false })
    }
  },

  addAccount: async (account) => {
    set({ isLoading: true, error: null })
    try {
      logInfo('[Store] Adding account:', JSON.stringify(account, null, 2))
      const backendAccount = toBackend(account)
      logInfo('[Store] Backend account:', JSON.stringify(backendAccount, null, 2))
      await invoke('add_account', { account: backendAccount })
      set((state) => ({
        accounts: [...state.accounts, account],
        isLoading: false
      }))
    } catch (err: any) {
      logError('Failed to add account:', err)
      set({ error: err.message || 'Failed to add account', isLoading: false })
      throw err
    }
  },

  updateAccount: async (id, data) => {
    set({ isLoading: true, error: null })
    try {
      const current = get().accounts.find(a => a.id === id)
      if (!current) throw new Error('Account not found')

      // Deep merge for nested objects like credentials
      const updated = { ...current, ...data } as Account
      
      // Special handling for Kiro accounts: deep merge credentials
      if (updated.platform === 'kiro' && 'credentials' in data && data.credentials) {
        const currentKiro = current as KiroAccount
        const updatedKiro = updated as KiroAccount
        updatedKiro.credentials = {
          ...currentKiro.credentials,
          ...data.credentials
        }
      }

      const backendAccount = toBackend(updated)
      await invoke('update_account', { id, account: backendAccount })

      set((state) => ({
        accounts: state.accounts.map((acc) => (acc.id === id ? updated : acc)),
        isLoading: false
      }))
    } catch (err: any) {
      logError('Failed to update account:', err)
      set({ error: err.message || 'Failed to update account', isLoading: false })
      throw err
    }
  },

  deleteAccount: async (id) => {
    set({ isLoading: true, error: null })
    try {
      await invoke('delete_account', { id })
      set((state) => ({
        accounts: state.accounts.filter((acc) => acc.id !== id),
        activeAccount: state.activeAccount?.id === id ? null : state.activeAccount,
        isLoading: false
      }))
    } catch (err: any) {
      logError('Failed to delete account:', err)
      set({ error: err.message || 'Failed to delete account', isLoading: false })
    }
  },

  setActiveAccount: (account) => set({ activeAccount: account }),

  setSelectedPlatform: (platform) => set({ selectedPlatform: platform }),

  getAccountsByPlatform: (platform) => {
    return get().accounts.filter((acc) => acc.platform === platform)
  },

  // ==================== 通用账号操作（accountOps 驱动） ====================

  canSwitch: (platform) => Boolean(getAccountOps(platform)?.switchAccount),

  canRefresh: (platform) => Boolean(getAccountOps(platform)?.refresh),

  switchAccount: async (id) => {
    const account = get().accounts.find((a) => a.id === id)
    if (!account) throw new Error('Account not found')

    const ops = getAccountOps(account.platform)
    if (!ops?.switchAccount) {
      throw new Error(`${account.platform} 平台不支持一键切号`)
    }

    const patch = (await ops.switchAccount(account)) || {}

    // 同一平台仅保留一个活跃账号
    const siblings = get().accounts.filter(
      (a) => a.platform === account.platform && a.id !== id && a.isActive,
    )
    for (const sibling of siblings) {
      await get().updateAccount(sibling.id, { isActive: false })
    }

    await get().updateAccount(id, {
      isActive: true,
      lastUsedAt: Date.now(),
      ...patch,
    } as Partial<Account>)

    set({ activeAccount: get().accounts.find((a) => a.id === id) || null })
  },

  refreshAccount: async (id) => {
    const account = get().accounts.find((a) => a.id === id)
    if (!account) return false

    const ops = getAccountOps(account.platform)
    if (!ops?.refresh) return false

    set((state) => ({
      accounts: state.accounts.map((acc) =>
        acc.id === id ? ({ ...acc, status: 'refreshing' } as Account) : acc,
      ),
    }))

    try {
      const result = await ops.refresh(account)
      const patch: Record<string, unknown> = { ...(result.patch || {}) }
      if (!result.success && !patch.status) {
        patch.status = 'error'
        patch.lastError = result.error
        patch.lastCheckedAt = Date.now()
      }
      await get().updateAccount(id, patch as Partial<Account>)
      return result.success
    } catch (error) {
      await get().updateAccount(id, {
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Unknown error',
        lastCheckedAt: Date.now(),
      } as Partial<Account>)
      return false
    }
  },

  checkAccountStatus: async (id) => {
    const account = get().accounts.find((a) => a.id === id)
    if (!account) return

    const ops = getAccountOps(account.platform)
    if (!ops?.checkStatus) return

    set((state) => ({
      accounts: state.accounts.map((acc) =>
        acc.id === id ? ({ ...acc, status: 'refreshing' } as Account) : acc,
      ),
    }))

    try {
      const result = await ops.checkStatus(account)
      const patch: Record<string, unknown> = { ...(result.patch || {}) }
      if (!result.success && !patch.status) {
        patch.status = 'error'
        patch.lastError = result.error
        patch.lastCheckedAt = Date.now()
      }
      await get().updateAccount(id, patch as Partial<Account>)
    } catch (error) {
      await get().updateAccount(id, {
        status: 'error',
        lastError: error instanceof Error ? error.message : 'Unknown error',
        lastCheckedAt: Date.now(),
      } as Partial<Account>)
    }
  },

  batchRefreshAccounts: async (ids) => {
    const targets = ids
      .map((id) => get().accounts.find((a) => a.id === id))
      .filter((acc): acc is Account => Boolean(acc && getAccountOps(acc.platform)?.refresh))

    if (targets.length === 0) return

    logInfo(`[BatchRefresh] 刷新 ${targets.length} 个账号...`)
    await Promise.all(targets.map((account) => get().refreshAccount(account.id)))
    logInfo('[BatchRefresh] 已完成')
  },

  batchCheckAccountStatus: async (ids) => {
    const targets = ids
      .map((id) => get().accounts.find((a) => a.id === id))
      .filter((acc): acc is Account => Boolean(acc && getAccountOps(acc.platform)?.checkStatus))

    await Promise.all(targets.map((account) => get().checkAccountStatus(account.id)))
  },

  // ==================== Auto-refresh management ====================

  startAutoRefresh: () => {
    if (autoRefreshTimer) return

    const { autoRefreshEnabled, autoRefreshInterval } = get()
    if (!autoRefreshEnabled) return

    const intervalMs = autoRefreshInterval * 60 * 1000

    autoRefreshTimer = setInterval(() => {
      get().checkAndRefreshExpiringTokens()
    }, intervalMs)

    logInfo(`[AutoRefresh] Started with interval: ${autoRefreshInterval} minutes`)
  },

  stopAutoRefresh: () => {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer)
      autoRefreshTimer = null
      logInfo('[AutoRefresh] Stopped')
    }
  },

  checkAndRefreshExpiringTokens: async () => {
    const { accounts, autoRefreshEnabled } = get()
    if (!autoRefreshEnabled) return

    const expiringIds = accounts
      .filter((acc) => {
        const ops = getAccountOps(acc.platform)
        return Boolean(ops?.refresh && ops.isExpiring?.(acc))
      })
      .map((acc) => acc.id)

    if (expiringIds.length > 0) {
      logInfo(`[AutoRefresh] Found ${expiringIds.length} expiring accounts`)
      await get().batchRefreshAccounts(expiringIds)
    }
  },

  setAutoRefresh: (enabled, interval) => {
    const nextInterval = interval !== undefined ? interval : get().autoRefreshInterval

    set({
      autoRefreshEnabled: enabled,
      autoRefreshInterval: nextInterval
    })

    persistAutoRefreshSettings({ enabled, interval: nextInterval })

    if (enabled) {
      get().stopAutoRefresh()
      get().startAutoRefresh()
    } else {
      get().stopAutoRefresh()
    }
  },
}))
