import { useEffect, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import i18n from '@/i18n/config'
import { logError } from '@/lib/logger'
import { getAllPlatforms } from '@/platforms/registry'
import { usePlatformStore } from '@/stores/usePlatformStore'
import type { Account } from '@/types/account'

interface TrayAccountItem {
  id: string
  label: string
  active: boolean
}

interface TrayPlatformGroup {
  name: string
  accounts: TrayAccountItem[]
}

/** 根据当前账号列表构建托盘菜单分组（只包含有账号的平台） */
function buildTrayGroups(accounts: Account[]): TrayPlatformGroup[] {
  return getAllPlatforms()
    .map((platform) => ({
      name: platform.name,
      accounts: accounts
        .filter((account) => account.platform === platform.id)
        .map((account) => ({
          id: account.id,
          label: account.name || account.email,
          active: Boolean(account.isActive),
        })),
    }))
    .filter((group) => group.accounts.length > 0)
}

/**
 * 系统托盘快速切号：
 * - 账号列表变化时同步重建托盘菜单（update_tray_menu）
 * - 监听 Rust 侧的 tray-switch-account 事件，走统一的 switchAccount 流程
 */
export function useTrayQuickSwitch() {
  const lastAccountsRef = useRef<Account[] | null>(null)

  useEffect(() => {
    const syncMenu = (accounts: Account[]) => {
      const groups = buildTrayGroups(accounts)
      if (groups.length === 0) return
      invoke('update_tray_menu', { groups }).catch((error) => {
        logError('Failed to update tray menu:', error)
      })
    }

    // 启动即同步一次，并订阅后续变化
    const accounts = usePlatformStore.getState().accounts
    lastAccountsRef.current = accounts
    syncMenu(accounts)

    const unsubscribe = usePlatformStore.subscribe((state) => {
      if (state.accounts === lastAccountsRef.current) return
      lastAccountsRef.current = state.accounts
      syncMenu(state.accounts)
    })

    let unlisten: (() => void) | undefined
    let disposed = false
    listen<string>('tray-switch-account', async (event) => {
      const id = event.payload
      const store = usePlatformStore.getState()
      const account = store.accounts.find((item) => item.id === id)
      if (!account) {
        toast.error(i18n.t('tray.accountMissing'))
        return
      }
      try {
        await store.switchAccount(id)
        toast.success(i18n.t('tray.switched', { account: account.email }))
      } catch (error) {
        logError('Tray switch failed:', error)
        toast.error(i18n.t('tray.switchFailed', { account: account.email }))
      }
    }).then((fn) => {
      if (disposed) {
        fn()
      } else {
        unlisten = fn
      }
    })

    return () => {
      disposed = true
      unsubscribe()
      unlisten?.()
    }
  }, [])
}
