import { NavLink } from 'react-router-dom'
import { Home, Users, Settings, Moon, Sun, Globe, Fingerprint } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import packageJson from '../../../package.json'

export function TopNav() {
  const { setTheme } = useTheme()
  const { t, i18n } = useTranslation()
  const isChinese = (i18n.resolvedLanguage || i18n.language).startsWith('zh')

  const navigation = [
    { name: 'nav.dashboard', href: '/', icon: Home },
    { name: 'nav.accounts', href: '/accounts', icon: Users },
    { name: 'nav.machineId', href: '/machine-id', icon: Fingerprint },
    { name: 'nav.settings', href: '/settings', icon: Settings },
  ]

  const toggleTheme = () => {
    setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')
  }

  return (
    <nav className="app-sidebar" aria-label={t('workbench.navigation')}>
      <div className="sidebar-brand" title="LutraCredentials">
        <img src="/logo.png" alt="Lutra" />
        <div className="sidebar-brand-text">
          <div className="brand-name">Lutra</div>
          <div className="brand-caption">CREDENTIALS</div>
        </div>
      </div>

      <div>
        <div className="sidebar-section-label">{t('workbench.workspace')}</div>
        <div className="sidebar-links">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              end={item.href === '/'}
              title={t(item.name)}
              aria-label={t(item.name)}
              className={({ isActive }) => cn('sidebar-link', isActive && 'sidebar-link--active')}
            >
              <item.icon aria-hidden="true" />
              <span className="sidebar-link-label">{t(item.name)}</span>
            </NavLink>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-utilities">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => i18n.changeLanguage(isChinese ? 'en' : 'zh')}
            aria-label={t('workbench.switchLanguage')}
            title={t('workbench.switchLanguage')}
            className="h-8 px-2 text-muted-foreground"
          >
            <Globe aria-hidden="true" />
            <span className="sidebar-language-label">{isChinese ? '中文' : 'EN'}</span>
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
        <div className="sidebar-meta">
          <span>LutraCredentials</span>
          <span>v{packageJson.version}</span>
        </div>
      </div>
    </nav>
  )
}
