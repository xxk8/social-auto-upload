## ADDED Requirements

### Requirement: Frontend Polish (openspec delta-format stub — see archived content below)
The `Frontend Polish` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Frontend Polish` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # frontend-polish (Delta) Specification
    
    ## Overview
    
    Modifications to the existing `frontend-polish` capability: bundle optimization, virtual scrolling, input debouncing, and query cache tuning.
    
    ## Changes
    
    ### C1: Manual chunk splitting in Vite config
    
    **File**: `sau_web/frontend/vite.config.ts`
    
    ```typescript
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-radix': [
              '@radix-ui/react-dialog', '@radix-ui/react-select',
              '@radix-ui/react-tabs', '@radix-ui/react-accordion',
              '@radix-ui/react-tooltip', '@radix-ui/react-popover',
              '@radix-ui/react-dropdown-menu', '@radix-ui/react-switch',
              '@radix-ui/react-slot'
            ],
            'vendor-query': ['@tanstack/react-query'],
            'vendor-charts': ['recharts'],
          }
        }
      }
    }
    ```
    
    **Target**: Main chunk from 768KB → < 500KB.
    
    ### C2: FloatingLogs lazy load
    
    **File**: `sau_web/frontend/src/App.tsx`
    
    Change:
    ```typescript
    import { FloatingLogs } from './Components/FloatingLogs'
    ```
    To:
    ```typescript
    const FloatingLogs = React.lazy(() =>
      import('./Components/FloatingLogs').then(m => ({ default: m.FloatingLogs }))
    )
    ```
    
    Wrap in `<Suspense fallback={null}>`.
    
    ### C3: LogsPage virtual scrolling
    
    **File**: `sau_web/frontend/src/Pages/LogsPage.tsx`
    
    - Install `@tanstack/react-virtual`
    - Replace log list rendering with `useVirtualizer` from `@tanstack/react-virtual`
    - Estimate row height at 32px, overscan 10 rows
    - Only render visible rows + overscan
    
    ### C4: Search input debouncing
    
    **Files**: `LogsPage.tsx`, `TasksPage.tsx`
    
    - Add 300ms debounce to search input filtering
    - Use `useDeferredValue` or custom `useDebounce` hook
    - Immediate clear (no debounce on empty input)
    
    ### C5: TanStack Query staleTime optimization
    
    **File**: `sau_web/frontend/src/api/client.ts` or individual hooks
    
    ```typescript
    // Account list — changes infrequently
    useQuery({ queryKey: ['accounts'], queryFn: ..., staleTime: 60_000 })
    
    // Task list — near-realtime
    useQuery({ queryKey: ['tasks'], queryFn: ..., staleTime: 3_000, refetchInterval: 5_000 })
    
    // Logs — always fresh
    useQuery({ queryKey: ['logs'], queryFn: ..., staleTime: 0 })
    
    // AI models — almost never changes
    useQuery({ queryKey: ['ai-models'], queryFn: ..., staleTime: 300_000 })
    ```
    
    ### C6: New route for analytics
    
    **File**: `sau_web/frontend/src/App.tsx`
    
    Add lazy-loaded route:
    ```typescript
    const AnalyticsPage = React.lazy(() => import('./Pages/AnalyticsPage'))
    // Route: /analytics
    ```
    
    Add to sidebar navigation with `BarChart3` icon.
    
    ## Dependencies Added
    
    ```bash
    npm add recharts @tanstack/react-virtual
    ```
    
    ## Acceptance Criteria
    
    - [ ] `npm run build` → main chunk < 500KB
    - [ ] FloatingLogs chunk only loads when floating button clicked
    - [ ] LogsPage with 1000 entries → smooth scroll, no jank
    - [ ] Type in search → 300ms delay before filter applies
    - [ ] Clear search → filter clears immediately
    - [ ] `/analytics` route loads independently (code-split)
    - [ ] Accounts data served from cache for 60s (no redundant refetches)
    
