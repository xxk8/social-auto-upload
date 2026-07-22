# TanStack Start 迁移计划：react-router-dom → TanStack Router

> **日期**: 2026-07-22
> **范围**: `sau_web/frontend/src/` + `app/` 目录
> **依赖**: `@tanstack/react-router` (当前版本 1.170.18)

---

## 目录

1. [总体架构变更](#1-总体架构变更)
2. [迁移分类总览](#2-迁移分类总览)
3. [37 个源文件逐文件方案](#3-37-个源文件逐文件方案)
4. [26 个测试文件逐文件方案](#4-26-个测试文件逐文件方案)
5. [执行顺序建议](#5-执行顺序建议)
6. [关键 TanStack Router API 对照](#6-关键-tanstack-router-api-对照)
7. [风险与注意事项](#7-风险与注意事项)

---

## 1. 总体架构变更

### 当前架构 (react-router-dom)

```
main.tsx → <App>
  └─ <BrowserRouter>
       └─ <Routes>
            ├─ <Route path="/" page={<LandingPage />} />
            ├─ <Route path="/login" page={<LoginPage />} />
            ├─ ...
            └─ <Route path="/dashboard/*" page={<AppShell />} />
```

### 目标架构 (TanStack Router)

```
main.tsx → <App>
  └─ <RouterProvider router={router}>
       └─ <RootRoute>
            ├─ / → LandingPage
            ├─ /login → LoginPage
            ├─ ...
            └─ <DashboardLayout>
                 ├─ /dashboard/publish → PublishPage
                 ├─ /dashboard/tasks → TasksPage
                 ├─ ...
```

### 核心变更

| 组件 | react-router-dom | TanStack Router |
|------|----------------|-----------------|
| **Router Provider** | `<BrowserRouter>` | `<RouterProvider router={router}>` |
| **路由定义** | 内联 `<Routes><Route>` | 文件路由 `app/routes/*.tsx` |
| **URL params** | `useParams()` | `useParams()` (兼容) |
| **Query params** | `useSearchParams()` | `useSearch()` (只读) / `useNavigate({ search })` |
| **Navigate** | `navigate(path)` 字符串 | `navigate({ to: path })` 对象 |
| **Navigate (类型)** | `NavigateFunction` from `react-router-dom` | `NavigateFunction` from `@tanstack/react-router` |
| **Redirect 组件** | `<Navigate to="..." replace />` | `<Navigate to="..." replace />` (export 兼容) |
| **不渲染路由内容** | `<Outlet />` | `<Outlet />` (export 兼容) |
| **链接** | `<Link to={path}>` | `<Link to={path}>` (export 兼容) |
| **测试路由上下文** | `<MemoryRouter initialEntries={...}>` from `react-router-dom` | `MemoryRouter` from `@/test-utils/MemoryRouter` (已实现) |
| **布局路由** | `<Route element={<Layout/>}><Route...>` | `<Route component={Layout}><Route...>` |

---

## 2. 迁移分类总览

### 🟢 简单交换（40 个文件）— import 来源切换 + 语法微调

| API | 改前（react-router-dom） | 改后（@tanstack/react-router） |
|-----|------------------------|-------------------------------|
| `useNavigate` | `navigate(path, opts)` | `navigate({ to: path, ...opts })` |
| `useLocation` | `location.pathname` | 兼容—API 相同 |
| `Link` | `<Link to={path}>` | 兼容—export 相同 |
| `useParams` | `params.id` | 兼容—API 相同 |
| `Outlet` | `<Outlet />` | 兼容—export 相同 |

### 🟡 中等复杂度（6 个文件）— API 不等效，需重构

| API | react-router-dom | TanStack Router |
|-----|-----------------|-----------------|
| `useSearchParams()` | 读写 URL query params | `useSearch()` + `navigate({ search })` |
| `NavigateFunction` type | from `react-router-dom` | from `@tanstack/react-router` |
| `<Navigate>` 组件 | 声明式 redirect | 兼容但需确认 export |

### 🔴 高复杂度（4 个文件）— 架构级变更

| 文件 | 复杂度 |
|------|--------|
| `src/App.tsx` | BrowserRouter → RouterProvider；Routes → routeTree；lazy 路由需重构 |
| `src/AppShell.tsx` | **已完成**（useLocation/useNavigate/Link/Outlet 已迁移） |
| `src/lib/navigation.ts` | NavigateFunction type 来源切换 |
| `src/test-utils/MemoryRouter.tsx` | **已完成**（React 19 fix 待验证） |

### 🟣 测试文件 mock 策略（26 个文件）

| 模式 | 改前 | 改后 |
|------|------|------|
| `<MemoryRouter>` wrapper | import from `react-router-dom` | import from `@/test-utils/MemoryRouter`（已实现） |
| `vi.mock('react-router-dom')` | mock 整个 react-router-dom 模块 | mock `@tanstack/react-router`（需验证兼容性） |
| `const mockNavigate = vi.fn()` | 可从 vi.mock 返回 | 依据新 mock 策略调整 |

---

## 3. 37 个源文件逐文件方案

### 🟢 简单交换：仅改 import + `navigate()` 签名（23 个文件）

#### 仅用 `useNavigate`（8 个文件）

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 1 | `src/Components/CommandPalette.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 2 | `src/Components/UserMenu.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ..., replace: ... })` |
| 3 | `src/features/accounts/GroupListItem.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 4 | `src/features/accounts/SortableGroup.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 5 | `src/features/publish/GroupPublishSelector.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 6 | `src/features/tasks/TaskTableRow.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 7 | `src/Pages/AccountsPage.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 8 | `src/Pages/CalendarPage.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |

#### 仅用 `Link`（10 个文件）

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 9 | `src/Components/AiRightPanel/AiPaywallBanner.tsx` | `Link` | 仅改 import 来源 |
| 10 | `src/Components/catalog/SidebarRowDemo.tsx` | `Link` | 仅改 import 来源 |
| 11 | `src/Components/MarketingFooter.tsx` | `Link` | 仅改 import 来源 |
| 12 | `src/Components/NotFound.tsx` | `Link` | 仅改 import 来源 |
| 13 | `src/Components/Studio/StudioRenderQuotaPill.tsx` | `Link` | 仅改 import 来源 |
| 14 | `src/Components/Studio/StudioUpsellModal.tsx` | `Link` | 仅改 import 来源 |
| 15 | `src/Components/ui/pricing-tier.tsx` | `Link` | 仅改 import 来源 |
| 16 | `src/features/preferences/tabs/AboutTab.tsx` | `Link` | 仅改 import 来源 |
| 17 | `src/features/preferences/tabs/SettingsTab.tsx` | `Link` | 仅改 import 来源 |
| 18 | `src/features/tasks/TaskErrorPanel.tsx` | `Link` | 仅改 import 来源 |

#### 仅用 `Link`（Pages）— 5 个文件

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 19 | `src/Pages/AboutPage.tsx` | `Link` | 仅改 import 来源 |
| 20 | `src/Pages/LandingPage.tsx` | `Link` | 仅改 import 来源 |
| 21 | `src/Pages/PricingPage.tsx` | `Link` | 仅改 import 来源 |

#### 混合 `useNavigate` + `useSearchParams`（5 个文件）

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 22 | `src/Pages/ForgotPasswordPage.tsx` | `useNavigate, useSearchParams` | import + navigate 签名 + useSearchParams→useSearch |
| 23 | `src/Pages/LoginAuthPage.tsx` | `useNavigate, useSearchParams` | import + navigate 签名 + useSearchParams→useSearch |
| 24 | `src/Pages/LoginPage.tsx` | `Link, useNavigate, useSearchParams` | import + navigate 签名 + useSearchParams→useSearch |
| 25 | `src/Pages/PublishPage.tsx` | `useNavigate, useSearchParams` | import + navigate 签名 + useSearchParams→useSearch |
| 26 | `src/Pages/ResetPasswordPage.tsx` | `useNavigate, useSearchParams` | import + navigate 签名 + useSearchParams→useSearch |

#### `useLocation` + `useNavigate`（2 个文件）

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 27 | `src/Components/MarketingTopBar.tsx` | `Link, useLocation, useSearchParams` | import + useSearchParams→useSearch |
| 28 | `src/features/admin/components/AdminNavTabs.tsx` | `useLocation, useNavigate` | import + navigate 签名 |

#### `useNavigate`（Pages）— 4 个文件

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 29 | `src/Pages/InboxPage.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 30 | `src/Pages/StudioPage.tsx` | `useNavigate` | import 改来源 + `navigate({ to: ... })` |
| 31 | `src/Pages/StudioDetailPage.tsx` | `useNavigate, useParams` | import 改来源 + navigate 签名 |

#### `useNavigate` + `useSearchParams`（Pages）— 2 个文件

| # | 文件 | 导入 | 改动 |
|---|------|------|------|
| 32 | `src/Pages/ForgotPasswordPage.tsx` | `useNavigate, useSearchParams` | import + navigate + useSearch |
| 33 | `src/Pages/LoginAuthPage.tsx` | `useNavigate, useSearchParams` | import + navigate + useSearch |

### 🟡 中等复杂度（6 个文件）

#### `useSearchParams` hooks/utility（4 个文件）
> 需重构为 TanStack Router 的 `useSearch()` + 手动 `navigate({ search })`

| # | 文件 | 当前 API | 改动量 |
|---|------|---------|--------|
| 34 | `src/features/admin/useTimeRangeFilter.ts` | `useSearchParams` — 读写+replace | **中等(~30 行)** — 替换为 `useSearch()` + `useNavigate()` |
| 35 | `src/hooks/useTaskTableState.ts` | `useSearchParams` — 读 focus + 删除 | **简单(~10 行)** — 用 `useSearch()` 读 + `useNavigate()` 改写 URL |
| 36 | `src/features/publish/wizard/PublishWizard.tsx` | `useSearchParams` | **中等**(~15 行) |
| 37 | `src/features/admin/AdminAuditPage.tsx` | `useSearchParams` | **中等**(~15 行) |

#### `NavigateFunction` type（1 个文件）

| # | 文件 | 当前导入 | 改动 |
|---|------|---------|------|
| 38 | `src/lib/navigation.ts` | `import type { NavigateFunction } from 'react-router-dom'` | 仅改 type import → `from '@tanstack/react-router'` |

#### `<Navigate>` component（1 个文件）

| # | 文件 | 当前导入 | 改动 |
|---|------|---------|------|
| 39 | `src/features/auth/AuthGuard.tsx` | `import { Navigate } from 'react-router-dom'` | 改 import 来源——`@tanstack/react-router` 也 export `<Navigate>` |

### 🔴 高复杂度（1 个文件）

| # | 文件 | 当前架构 | 目标架构 | 改动量 |
|---|------|---------|---------|--------|
| 40 | `src/App.tsx` | `<BrowserRouter><Routes><Route>...` | `<RouterProvider router={router}>` | **大重构(~150 行)** |

**App.tsx 详细迁移方案：**

```diff
- import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
+ import { RouterProvider } from '@tanstack/react-router'
+ import { router } from '@/app/router'

// 移除：
// - LegacyAppRedirect (用 TanStack Router redirect 替代)
// - RegisterNavigate (保留 registerNavigate 模式但从 @tanstack/react-router 获取)
// - 所有内联 <Route> + lazy(() => import(...))
// - <NotFound /> 内联兜底

// 保留：
// - ThemeProvider, TooltipProvider, ToastProvider, AccountsProvider
// - ErrorBoundary, Suspense, AuthLoadingSkeleton, LazyOnboardingTour

function App() {
  return (
-   <BrowserRouter>
-     <RegisterNavigate />
+   <RouterProvider router={router}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <AccountsProvider>
              <ErrorBoundary>
                <Suspense fallback={<AuthLoadingSkeleton />}>
                  <LazyOnboardingTour>
-                   <Routes>
-                     <Route path="/" element={<LandingPage />} />
-                     <Route path="/login" element={<LoginPage />} />
-                     ... (全部 Route 定义)
-                   </Routes>
+                   <!-- 路由由 router 实例管理 -->
                  </LazyOnboardingTour>
                </Suspense>
              </ErrorBoundary>
            </AccountsProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
-   </BrowserRouter>
+   </RouterProvider>
  )
}
```

**路由树文件结构（需新建 `app/` 目录）：**

```
app/
├── router.tsx              # createRouter + routeTree 定义
├── routeTree.gen.ts        # 自动生成（@tanstack/router-vite-plugin）
├── ssr.tsx                 # 可选 SSR 入口
├── client.tsx              # StartClient 入口
└── routes/
    ├── __root.tsx          # Root layout (providers + Outlet)
    ├── index.tsx           # 首页 (LandingPage)
    ├── login.tsx           # 登录页 (LoginPage)
    ├── login.auth.tsx      # 登录子路由 (LoginAuthPage)
    ├── login.forgot-password.tsx
    ├── login.reset-password.tsx
    ├── pricing.tsx
    ├── about.tsx
    ├── catalog.tsx
    ├── hotlist.tsx
    ├── dashboard.tsx       # Dashboard 布局 (AppShell + Outlet)
    ├── dashboard/
    │   ├── index.tsx       # /dashboard → AccountsPage
    │   ├── publish.tsx
    │   ├── tasks.tsx
    │   ├── inbox.tsx
    │   ├── analytics.tsx
    │   ├── logs.tsx
    │   ├── calendar.tsx
    │   ├── studio.tsx
    │   ├── studio.$id.tsx
    │   ├── crawl.tsx
    │   └── admin/
    │       ├── index.tsx
    │       ├── users.tsx
    │       └── audit.tsx
    ├── 404.tsx             # catch-all 404
    └── _legacy/
        ├── app.tsx         # /app/* → /dashboard/*
        └── publish.tsx     # /publish → /dashboard/publish
```

---

## 4. 26 个测试文件逐文件方案

### 🟢 仅改 MemoryRouter import（21 个文件）

将 `import { MemoryRouter } from 'react-router-dom'` 改为：
```typescript
import { MemoryRouter } from '@/test-utils/MemoryRouter'
```

| # | 文件 |
|---|------|
| 1 | `src/App.test.tsx` |
| 2 | `src/Components/MarketingTopBar.test.tsx` |
| 3 | `src/Components/UserMenu.test.tsx` |
| 4 | `src/features/accounts/GroupListItem.test.tsx` |
| 5 | `src/features/accounts/SortableGroup.test.tsx` |
| 6 | `src/features/tasks/TaskTableRow.test.tsx` |
| 7 | `src/features/tasks/TaskProgressBar.test.tsx` |
| 8 | `src/features/tasks/TaskErrorPanel.test.tsx` |
| 9 | `src/Pages/__tests__/LandingPage.test.tsx` |
| 10 | `src/Pages/__tests__/PricingPage.test.tsx` |
| 11 | `src/Pages/__tests__/ProfilePage.test.tsx` |
| 12 | `src/Pages/__tests__/SettingsPage.test.tsx` |
| 13 | `src/Pages/__tests__/StudioPage.test.tsx` |
| 14 | `src/Pages/__tests__/StudioPage.i18n.test.tsx` |
| 15 | `src/Pages/__tests__/StudioDetailPage.test.tsx` |
| 16 | `src/Pages/__tests__/PublishPage.i18n.test.tsx` |
| 17 | `src/Pages/__tests__/TasksPage.i18n.test.tsx` |
| 18 | `src/Pages/__tests__/PersonalizationPage.test.tsx` |
| 19 | `src/Pages/__tests__/LoginAuthPage.test.tsx` |
| 20 | `src/Pages/PersonalizationPage.test.tsx` |
| 21 | `src/Pages/ProfilePage.test.tsx` |
| 22 | `src/Pages/SettingsPage.test.tsx` |

### 🟡 需要 mock 策略调整（4 个文件）

这些测试文件中调用了 `vi.mock('react-router-dom')` 或 `vi.importActual('react-router-dom')`，需要改为 mock `@tanstack/react-router`：

| # | 文件 | mock 内容 | 改动 |
|---|------|----------|------|
| 23 | `src/Components/AiRightPanel/TierBlockGate.test.tsx` | `vi.mock('react-router-dom', ...)` | 改为 `vi.mock('@tanstack/react-router', ...)` |
| 24 | `src/features/admin/AdminDashboard.test.tsx` | `vi.mock('react-router-dom')` + `const mockNavigate = vi.fn()` | 改为 mock `@tanstack/react-router` + `navigate({ to: any })` 匹配 |
| 25 | `src/features/auth/LoginPage.test.tsx` | `vi.mock('react-router-dom', ...)` with `memoryHistory` | 改为 mock `@tanstack/react-router` + `createMemoryHistory` |
| 26 | `src/features/preferences/PreferencesDialog.test.tsx` | vi.mock + MemoryRouter | import 改来源 |

---

## 5. 执行顺序建议

### Phase 1: 基础设施（1 个 PR）
```
[Day 1-2] 确保 MemoryRouter.tsx 测试工具在 React 19 下正常工作
[Day 1-2] 更新 test/auth-router-spies.ts 以支持 @tanstack/react-router
[Day 1-2] 确认 tsc + vitest 基线
```

### Phase 2: 🟢 简单交换 + 🟡 中等（2 个 PR）
```
PR-A: 仅改 import 来源 (23 个文件 + 22 个测试文件)
  - 全部仅用 useNavigate / Link / Outlet / useLocation / useParams 的文件
  - navigate() 签名 { to: } 更新
  - 测试文件 MemoryRouter import 改来源

PR-B: useSearchParams → useSearch (4 个文件)
  - useTimeRangeFilter.ts（最大重构）
  - useTaskTableState.ts
  - PublishWizard.tsx
  - AdminAuditPage.tsx
```

### Phase 3: 🔴 App.tsx 重构（1 个 PR）
```
[Day 4-6] 核心——最大 PR：
  - 新建 app/routes/ 文件路由树（~18 个路由文件）
  - 重写 App.tsx：BrowserRouter→RouterProvider
  - auth 守卫迁移到 beforeLoad
  - 404 兜底迁移到 catch-all 路由
  - LegacyAppRedirect 迁移到路由 redirect
  - RegisterNavigate 适配新 router
```

### Phase 4: 🔴 AuthGuard + navigation.ts（1 个 PR）
```
[Day 6-7] 最后清理：
  - AuthGuard.tsx: Navigate import 改来源
  - navigation.ts: NavigateFunction type import 改来源
  - 清理残余 react-router-dom 依赖
```

---

## 6. 关键 TanStack Router API 对照

### useSearchParams → useSearch 迁移模式

```typescript
// react-router-dom
const [searchParams, setSearchParams] = useSearchParams()
const page = searchParams.get('page')
setSearchParams(new URLSearchParams({ page: '2' }), { replace: true })

// TanStack Router
import { useSearch, useNavigate } from '@tanstack/react-router'

// 只读
const search = useSearch({ from: routeTree }) // 类型安全
search.page // string | undefined

// 写
const navigate = useNavigate()
navigate({ search: { page: '2' }, replace: true })
```

### navigate 签名对照

```typescript
// react-router-dom
navigate('/dashboard/publish')
navigate('/dashboard/tasks?focus=abc123')
navigate(ROUTES.public.landing, { replace: true })

// TanStack Router
navigate({ to: '/dashboard/publish' })
navigate({ to: '/dashboard/tasks', search: { focus: 'abc123' } })
navigate({ to: ROUTES.public.landing, replace: true })
```

### useParams（兼容）

```typescript
// 两者都兼容
const { id } = useParams<{ id: string }>()
// TanStack Router 的类型更严格——useParams 自动推断路由 param 类型
```

### 路由守卫（AuthGuard）

```typescript
// react-router-dom: AuthGuard 作为 wrapper 组件
<Route element={<AuthGuard><Page /></AuthGuard>} />

// TanStack Router: beforeLoad 守卫
// 在文件路由中：
// app/routes/dashboard.tsx
const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'dashboard',
  beforeLoad: async ({ location }) => {
    const auth = useAuthStore.getState()
    if (!auth.isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } })
    }
  },
  component: AppShell,
})
```

---

## 7. 风险与注意事项

### 已知风险

| # | 风险 | 影响 | 缓解 |
|---|------|------|------|
| 1 | `@tanstack/react-router` 的 `useSearch()` 是类型安全的 search schema，与 `URLSearchParams` 的字符串式 API 不同 | `useTimeRangeFilter.ts` 等文件大量使用 `URLSearchParams` set/delete/toString | 拆为读写分离：`useSearch()` 读 + `useNavigate()` 写 |
| 2 | TanStack Router 的 `navigate({ to })` 不支持 query string 嵌入 path | `navigate(\`${ROUTES.dashboard.tasks}?focus=${id}\`)` 需改为 `navigate({ to: ROUTES.dashboard.tasks, search: { focus: id } })` | 逐文件检查，将 path 中 `?query` 提取为 `search` 参数 |
| 3 | `React 19` + `react-i18next@17` 的 ESM default import 兼容性 | 测试环境可能 `useContext` 找不到值 | Layer C recipe 已确认使用 named useMemo import |
| 4 | `RegisterNavigate` 在 TanStack Router 中的 `useNavigate()` 行为不同 | `navigateInApp` 可能在新 router 下行为不一致 | 验证 `useNavigate()` 返回是否在每次 render 时稳定 |
| 5 | 文件路由 `app/routes/` + `routeTree.gen.ts` 需要 `@tanstack/router-vite-plugin` 配置 | CI 构建需要插件工作 | 已在 `vite.config.ts` 配置；注意 Fast Refresh 冲突 (FIX-B) |
| 6 | `@tanstack/router-vite-plugin` 版本 `1.167.23` 与 `react@1.170.18` 版本不一致 | 已导致 `Duplicate declaration hot` 错误 | 当前 FIX-B: `react({ fastRefresh: false })` |

### 迁移验收标准

- [ ] `grep -rn "react-router-dom" src/` → 0 结果
- [ ] `grep -rn "react-router-dom" app/` → 0 结果
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npx vitest run` → 通过率与迁移前一致
- [ ] `npm run build` → 构建成功
- [ ] 开发服务器 `npm run dev` → / 路由返回 200，页面正常渲染
- [ ] 生产预览 `npx vite preview` → 路由正常，无白屏

### 遗留问题（延期处理）

| 问题 | 描述 | 建议处理时间 |
|------|------|-------------|
| `fastRefresh: false` | 禁用了组件级 HMR；dev 体验降级 | 等 `@tanstack/router-plugin` 上游修复后还原 |
| `react-i18next` 类型增强 | `t(key, fallback)` 返回 `never` 问题 | 独立 PR 处理 |
| `app/routeTree.gen.ts` 自动生成 | 文件路由树需要手动维护 | 独立 PR—先用手动路由注册 |

---

## 附录：快速搜索命令

```bash
# 查找所有 react-router-dom 残留
grep -rn "react-router-dom" sau_web/frontend/src/ --include='*.ts' --include='*.tsx' | grep -v '.test.' | grep -v '__tests__'

# 查找测试文件中的 react-router-dom
grep -rn "react-router-dom" sau_web/frontend/src/ --include='*.test.ts' --include='*.test.tsx'

# 查找 navigate() 字符串调用（需改为 { to } 对象）
grep -rn "navigate(" sau_web/frontend/src/ --include='*.ts' --include='*.tsx' | grep -v '.test.' | grep -v '__tests__' | grep -v "navigate({ to"

# 查找 useSearchParams 残留
grep -rn "useSearchParams" sau_web/frontend/src/ --include='*.ts' --include='*.tsx'
```
