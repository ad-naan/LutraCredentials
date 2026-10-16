import { Outlet } from 'react-router-dom'
import { TopNav } from './TopNav'

export function MainLayout() {
  return (
    <div className="app-shell selection:bg-primary/20 selection:text-primary">
      <TopNav />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  )
}
