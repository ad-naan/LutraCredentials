import { NavLink } from 'react-router-dom'
import { Home, Users, Settings, Moon, Sun, Globe, Fingerprint } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/hooks/useTheme'
import { useTranslation } from 'react-i18next'
import packageJson from '../../../package.json'

export function TopNav() {
  const { theme, setTheme } = useTheme()
  const { t, i18n } = useTranslation()

  const navigation = [
    { name: 'nav.dashboard', href: '/', icon: Home },
    { name: 'nav.accounts', href: '/accounts', icon: Users },
    { name: 'nav.machineId', href: '/machine-id', icon: Fingerprint },
    { name: 'nav.settings', href: '/settings', icon: Settings },
  ]

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'zh' ? 'en' : 'zh')
  }

  return (
    <nav className="h-16 flex items-center justify-between px-6 z-40 sticky top-0 bg-background border-b border-border transition-colors duration-300">
      {/* Logo */}
      <div className="flex items-center gap-10">
        <div className="flex items-center gap-3">
          <img
            src="/logo.png"
            alt="Lutra"
            className="h-9 w-9 rounded-lg object-cover ring-1 ring-border"
          />
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              {t('app.name')}
            </h1>
            <span className="text-xs text-muted-foreground">v{packageJson.version}</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-1">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-secondary text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {t(item.name)}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <div className="flex items-center border border-border rounded-md bg-background/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleLanguage}
            className="h-8 px-3 text-xs font-medium hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Globe className="h-3.5 w-3.5 mr-2" />
            {i18n.language === 'zh' ? '中文' : 'EN'}
          </Button>

          <div className="w-[1px] h-4 bg-border" />

          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </nav>
  )
}
