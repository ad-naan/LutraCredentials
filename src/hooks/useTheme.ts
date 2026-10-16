import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

// 历史包袱清理：迁移旧版 nexus-theme 存储键，保留用户已选主题。
// 必须在 store 创建（同步水合）之前执行。
if (typeof window !== 'undefined') {
  const LEGACY_KEY = 'nexus-theme'
  if (!localStorage.getItem('lutra-theme')) {
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      localStorage.setItem('lutra-theme', legacy)
      localStorage.removeItem(LEGACY_KEY)
    }
  }
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        set({ theme })
        applyTheme(theme)
      },
    }),
    {
      name: 'lutra-theme',
    }
  )
)

function applyTheme(theme: Theme) {
  const root = window.document.documentElement
  root.classList.remove('light', 'dark')

  if (theme === 'system') {
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    root.classList.add(systemTheme)
  } else {
    root.classList.add(theme)
  }
}

// 初始化主题
if (typeof window !== 'undefined') {
  const stored = localStorage.getItem('lutra-theme')
  const theme = stored ? (JSON.parse(stored).state.theme as Theme) : 'system'
  applyTheme(theme)
}
