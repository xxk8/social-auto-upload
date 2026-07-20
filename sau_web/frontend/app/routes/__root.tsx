import { type ReactNode, Suspense, StrictMode, lazy } from 'react'
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AccountsProvider } from '@/features/accounts/AccountsProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthLoadingSkeleton } from '@/features/auth/AuthLoadingSkeleton'
import { resumeInterruptedDownloads } from '@/stores/inboxResume'

// Startup side-effects (from main.tsx).
// Guarded with `typeof window !== 'undefined'` because __root.tsx runs
// BOTH on the server (SSR) and the client (hydration).
// `resumeInterruptedDownloads` touches browser-only APIs (IndexedDB,
// localStorage), which would crash during SSR.
if (typeof window !== 'undefined') {
  resumeInterruptedDownloads()
}

/**
 * QueryClient — 模块级单例。
 * 和当前 main.tsx 的行为完全一致，只是搬到了这里。
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1_000,
      refetchOnWindowFocus: false,
    },
  },
})

// Per-resource staleTime overrides
queryClient.setQueryDefaults(['accounts'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['account-groups'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['tasks'], { staleTime: 3_000 })
queryClient.setQueryDefaults(['task-logs'], { staleTime: 1_000 })
queryClient.setQueryDefaults(['ai-config'], { staleTime: 300_000 })
queryClient.setQueryDefaults(['ai-keys'], { staleTime: 300_000 })

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'social-auto-upload' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <StrictMode>
      <ThemeProvider defaultTheme="system" storageKey="sau-ui-theme">
        <TooltipProvider>
          <ToastProvider>
            <QueryClientProvider client={queryClient}>
              <I18nextProvider i18n={i18n}>
                <AccountsProvider>
                  <ErrorBoundary>
                    <RootDocument>
                      <Suspense fallback={<AuthLoadingSkeleton />}>
                        <LazyOnboardingTour>
                          <Outlet />
                        </LazyOnboardingTour>
                      </Suspense>
                    </RootDocument>
                  </ErrorBoundary>
                </AccountsProvider>
              </I18nextProvider>
            </QueryClientProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </StrictMode>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
        {/* Theme FOUC prevention: before React hydrates, read
            localStorage and set the dark class on <html> to match
            the user's saved preference. Without this, SSR outputs
            light-mode HTML that flashes before hydration. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('sau-ui-theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

const LazyOnboardingTour = lazy(() =>
  import('@/components/OnboardingTour').then((m) => ({ default: m.OnboardingTour }))
)
