import { Outlet, useLocation } from 'react-router-dom'
import { TitleBar } from './TitleBar'
import { TopNav } from './TopNav'

export function MainLayout() {
  const { pathname } = useLocation()
  const isAccountsPage = pathname === '/accounts'

  return (
    <div className="app-shell selection:bg-primary/20 selection:text-primary">
      <TitleBar />
      <div className="app-body">
        <TopNav />
        <main className={isAccountsPage ? 'app-main app-main--accounts' : 'app-main'}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
