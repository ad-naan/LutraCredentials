import type { WheelEvent } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Database,
  Fingerprint,
  Globe,
  Home,
  Minus,
  Moon,
  Settings,
  Square,
  Sun,
  Users,
  X,
} from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import { VersionMenu } from '@/components/common/VersionMenu'

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Single desktop toolbar: brand, primary navigation, utilities and the window
 * controls share one row instead of stacking a title bar on top of a nav bar.
 */
export function TopNav() {
  const { setTheme } = useTheme()
  const { t, i18n } = useTranslation()
  const isChinese = (i18n.resolvedLanguage || i18n.language).startsWith('zh')

  // In a plain browser preview the Tauri window API is unavailable.
  const appWindow = isTauriRuntime() ? getCurrentWindow() : null

  const navigation = [
    { name: 'nav.dashboard', href: '/', icon: Home },
    { name: 'nav.accounts', href: '/accounts', icon: Users },
    { name: 'nav.machineId', href: '/machine-id', icon: Fingerprint },
    { name: 'nav.settings', href: '/settings', icon: Settings },
    { name: 'nav.data', href: '/data', icon: Database },
  ]

  const toggleTheme = () => {
    setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')
  }

  // Mouse-wheel drag: convert vertical wheel deltas into horizontal nav
  // scrolling so the strip can be swiped with the wheel like a touch swipe.
  const handleNavWheel = (event: WheelEvent<HTMLElement>) => {
    const el = event.currentTarget
    if (el.scrollWidth <= el.clientWidth) return
    if (event.deltaY === 0) return
    event.preventDefault()
    el.scrollLeft += event.deltaY
  }

  return (
    <header className="app-topbar" data-tauri-drag-region>
      <div className="topbar-brand" data-tauri-drag-region>
        <span className="topbar-brand-mark">
          <img src="/logo.png" alt="" aria-hidden="true" />
        </span>
        <span className="topbar-brand-name" data-tauri-drag-region>LutraCredentials</span>
      </div>

      <nav className="topbar-links" aria-label={t('workbench.navigation')} onWheel={handleNavWheel}>
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            end={item.href === '/'}
            className={({ isActive }) => cn('topbar-link', isActive && 'topbar-link--active')}
          >
            <item.icon aria-hidden="true" />
            <span className="topbar-link-label">{t(item.name)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="topbar-spacer" data-tauri-drag-region />

      <div className="topbar-utilities">
        <VersionMenu />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => i18n.changeLanguage(isChinese ? 'en' : 'zh')}
          aria-label={t('workbench.switchLanguage')}
          title={t('workbench.switchLanguage')}
          className="h-8 gap-1.5 px-2 text-muted-foreground"
        >
          <Globe aria-hidden="true" />
          <span className="topbar-language-label">{isChinese ? '中文' : 'EN'}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label={t('workbench.toggleTheme')}
          title={t('workbench.toggleTheme')}
          className="h-8 w-8 text-muted-foreground"
        >
          <Sun className="hidden dark:block" aria-hidden="true" />
          <Moon className="dark:hidden" aria-hidden="true" />
        </Button>
      </div>

      <div className="topbar-controls">
        <Button
          onClick={() => appWindow?.minimize()}
          aria-label="Minimize"
          variant="ghost"
          size="icon"
          className="h-full w-11 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <Button
          onClick={() => appWindow?.toggleMaximize()}
          aria-label="Maximize / restore"
          variant="ghost"
          size="icon"
          className="h-full w-11 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Square className="w-3.5 h-3.5" />
        </Button>
        <Button
          onClick={() => appWindow?.close()}
          aria-label="Close window"
          variant="ghost"
          size="icon"
          className="h-full w-11 rounded-none text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </header>
  )
}
