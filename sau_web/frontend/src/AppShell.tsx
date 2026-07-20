import { Outlet } from '@tanstack/react-router'

export default function AppShell() {
  return (
    <div className="flex min-h-screen bg-background">
      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  )
}
