import { Suspense, StrictMode, lazy } from 'react'
import { Outlet, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n/config'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ThemeProvider } from '@/components/ThemeProvider'
import { AccountsProvider } from '@/features/accounts/AccountsProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { AuthLoadingSkeleton } from '@/features/auth/AuthLoadingSkeleton'
import { scheduleInboxResume } from '@/stores/inboxResume'
import { NotFound } from '@/components/NotFound'

// Browser-only: re-issue in-progress inbox downloads/transcribes after
// localStorage rehydration. Idle-defer so first paint is not blocked.
const _resumeInbox = () => {
  try {
    scheduleInboxResume()
  } catch {
    /* private mode / storage blocked */
  }
}
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => _resumeInbox(), { timeout: 2_000 })
} else {
  setTimeout(_resumeInbox, 1)
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Default 5s: most shell screens are not tick-sensitive.
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

queryClient.setQueryDefaults(['accounts'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['account-groups'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['tasks'], { staleTime: 5_000 })
queryClient.setQueryDefaults(['task-logs'], { staleTime: 1_500 })
queryClient.setQueryDefaults(['logs'], { staleTime: 1_500 })
queryClient.setQueryDefaults(['calendar-tasks'], { staleTime: 10_000 })
queryClient.setQueryDefaults(['ai-config'], { staleTime: 300_000 })
queryClient.setQueryDefaults(['ai-keys'], { staleTime: 300_000 })

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFound,
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
                    <Suspense fallback={<AuthLoadingSkeleton />}>
                      <LazyOnboardingTour>
                        <Outlet />
                      </LazyOnboardingTour>
                    </Suspense>
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

const LazyOnboardingTour = lazy(() =>
  import('@/components/OnboardingTour').then((m) => ({ default: m.OnboardingTour })),
)
