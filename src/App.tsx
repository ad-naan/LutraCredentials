import { logError } from '@/lib/logger'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { Dashboard } from './pages/Dashboard'
import { Accounts } from './pages/Accounts'
import { MachineId } from './pages/MachineId'
import { Settings } from './pages/Settings'
import { Data } from './pages/Data'
import { ThemeManager } from './components/common/ThemeManager'
import { useEffect } from 'react'
import { useTrayQuickSwitch } from './hooks/useTrayQuickSwitch'
import { usePlatformStore } from './stores/usePlatformStore'
import { Toaster } from "@/components/ui/sonner"

function App() {
  const loadAllAccounts = usePlatformStore((state) => state.loadAllAccounts)
  const startAutoRefresh = usePlatformStore((state) => state.startAutoRefresh)
  const stopAutoRefresh = usePlatformStore((state) => state.stopAutoRefresh)
  const checkAndRefreshExpiringTokens = usePlatformStore(
    (state) => state.checkAndRefreshExpiringTokens,
  )

  // 系统托盘快速切号（菜单同步 + 切号事件）
  useTrayQuickSwitch()

  useEffect(() => {
    // 应用启动时加载所有账户，随后立即执行一次过期凭据检查：
    // 否则启动时已临近过期的令牌要等到第一个定时周期才会被刷新。
    let cancelled = false
    loadAllAccounts()
      .then(() => {
        if (cancelled) return
        void checkAndRefreshExpiringTokens()
      })
      .catch((error) => {
        logError('Failed to load accounts on startup:', error)
      })
    return () => {
      cancelled = true
    }
  }, [loadAllAccounts, checkAndRefreshExpiringTokens])

  useEffect(() => {
    // 启用后台凭据自动刷新（开关与间隔由设置页管理）
    startAutoRefresh()
    return () => stopAutoRefresh()
  }, [startAutoRefresh, stopAutoRefresh])

  return (
    <>
      <ThemeManager />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="machine-id" element={<MachineId />} />
            <Route path="settings" element={<Settings />} />
            <Route path="data" element={<Data />} />
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </>
  )
}

export default App
