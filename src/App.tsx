import { logError } from '@/lib/logger'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MainLayout } from './components/layout/MainLayout'
import { Dashboard } from './pages/Dashboard'
import { Accounts } from './pages/Accounts'
import { MachineId } from './pages/MachineId'
import { Settings } from './pages/Settings'
import { ThemeManager } from './components/common/ThemeManager'
import { useEffect } from 'react'
import { usePlatformStore } from './stores/usePlatformStore'
import { Toaster } from "@/components/ui/sonner"

function App() {
  const loadAllAccounts = usePlatformStore((state) => state.loadAllAccounts)
  const startAutoRefresh = usePlatformStore((state) => state.startAutoRefresh)
  const stopAutoRefresh = usePlatformStore((state) => state.stopAutoRefresh)

  useEffect(() => {
    // 应用启动时加载所有账户
    loadAllAccounts().catch((error) => {
      logError('Failed to load accounts on startup:', error)
    })
  }, [loadAllAccounts])

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
          </Route>
        </Routes>
        <Toaster />
      </BrowserRouter>
    </>
  )
}

export default App
