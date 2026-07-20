/// <reference types="node" />

import { createFileRoute, redirect } from '@tanstack/react-router'
import AppShell from '@/AppShell'

/**
 * `/dashboard` — 仪表盘根布局路由。
 *
 * beforeLoad 在 SSR 渲染前检查用户是否已登录。
 * 如果未登录，直接 302 redirect 到 /login（不会渲染 AppShell 的 HTML）。
 *
 * Cookie 传递：SSR 时，Nginx 会把浏览器请求的 cookie 原样转发到
 * TanStack Start 服务器，beforeLoad 中的 fetch 请求会携带这些 cookie。
 *
 * 开发环境（Vite proxy）：/api/auth/me 走相对路径，由 Vite proxy
 * 转发到 localhost:6001。不需要环境变量。
 */
export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ location }: any) => {
    try {
      // 开发环境用相对路径（Vite proxy 处理），生产环境用完整 URL
      // 但 SSR 服务器也需要访问 Flask，所以需要用完整 URL
      // 这里用相对路径在 SSR 环境下会自动拼接请求的 origin
      const cookie = typeof document !== 'undefined' ? document.cookie : ''
      const baseUrl = process.env.SSR_API_BASE_URL ?? ''

      const res = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { cookie },
      })

      if (!res.ok) {
        throw new Error('Not authenticated')
      }

      const user = await res.json()
      return { user }
    } catch {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      })
    }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  // AppShell 负责渲染侧边栏 + 标题栏 + <Outlet />
  // 后续 Step 2d 会将 AppShell 中的 DashboardRoutes 替换为 <Outlet />
  return <AppShell />
}
