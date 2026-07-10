import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import './index.css'
// Default import of the config module ALSO triggers the
// `void i18n.use(initReactI18next).init({...})` block — Vite/CJS
// ES-module cache guarantees one module-record per physical file,
// so importing for the `i18n` default value is also the implicit
// side-effect that initialises i18next. The <I18nextProvider>
// below binds that live singleton to React so `useTranslation()`
// everywhere reads the SAME instance — no double-init, no
// race-on-bootstrap. See src/lib/i18n/config.ts §"Side-effect
// import" for the full bootstrap invariants + locale-detection
// chain.
import i18n from '@/lib/i18n/config'
import App from './App.tsx'

/**
 * §8.5 — Per-resource staleTime configuration.
 *
 * The global default is a conservative 1s. Individual resource types
 * override this via `setQueryDefaults` keyed on the query key prefix:
 *
 *   accounts    → 60s  (changes rarely — user adds/removes accounts)
 *   tasks       → 3s   + refetchInterval=5s (live task status polling)
 *   logs        → 0    (always stale — logs consumer polls independently;
 *                       refetches on consumer demand)
 *   ai-models   → 300s (model list changes at most daily)
 *
 * `refetchOnWindowFocus` stays false globally (logs have their own
 * visibility-driven poller in the consumer hook).
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

// Per-resource overrides keyed on query key prefix.
// The prefixes must match what the existing hooks in src/hooks/ actually
// use. Verified keys:
//   useTasks         → ['tasks']
//   useAccounts      → ['accounts', platform]
//   useAccountGroups → ['account-groups']
//   useTaskLogs      → ['task-logs', taskId]
//   useAiConfig      → ['ai-config'] / ['ai-keys']
queryClient.setQueryDefaults(['accounts'], { staleTime: 60_000 })
queryClient.setQueryDefaults(['account-groups'], { staleTime: 60_000 })
// Note: spec §8.5 calls for refetchInterval=5s on tasks, but useTasks already
// has a smarter conditional refetchInterval (3s while running, stops when idle).
// A blanket 5s interval would conflict, so we only set staleTime here.
queryClient.setQueryDefaults(['tasks'], { staleTime: 3_000 })
queryClient.setQueryDefaults(['task-logs'], { staleTime: 1_000 })
queryClient.setQueryDefaults(['ai-config'], { staleTime: 300_000 })
queryClient.setQueryDefaults(['ai-keys'], { staleTime: 300_000 })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </QueryClientProvider>
  </StrictMode>,
)
