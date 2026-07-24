import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
// Round-OPT-prefs-dialog v5 (barrel migration): collapsed
// '@/features/preferences/tabs/AccountTab' → '@/features/preferences'.
// Keeps the Page import surface at the slice level so future
// cross-tab component moves inside the slice land transparently.
import { AccountTab } from '@/features/preferences'
import { User } from 'lucide-react'

// ── Round-OPT-prefs-dialog-v4 (slice extraction):
//    ProfilePage is a thin wrapper that re-renders PreferencesDialog's
//    <AccountTab /> under the /dashboard/account route's PageHeader. The
//    slice migrated from `Components/PreferencesContent.tsx` to
//    `features/preferences/` so:
//      • The dialog tabs are now owned by a single slice that ANY shell
//        (sidebar, mobile AppBar, future operator sub-shells) can mount
//        the SAME <PreferencesDialogProvider /> against without
//        reaching into `Components/`. This unlocks the user's stated
//        reuse goal from the round-3 brief.
//      • The 4 tab bodies live in `features/preferences/tabs/` as
//        sibling files — `<AccountTab />` (here), `<SettingsTab />`,
//        `<PersonalizationTab />`, `<AboutTab />`. The dialog AND the
//        route-mounted page both render the same `<AccountTab />`
//        composition, so deep-link / share-link / browser-refresh
//        behavior stays in lockstep with the modal surface.
//      • The provider split (`<PreferencesDialogProvider />` +
//        `usePreferencesDialog()` hook + `PreferencesTab` type) mirrors
//        the canonical <AccountsProvider /> + <AccountsProvider.helpers />
//        pattern, so future slice-onboarding lands in lockstep with
//        the established convention.
//    ┌──────────────────────────────────────────────────────────────┐
//    │ Page-header note: the modal surface drops <PageHeader />     │
//    │ (Chrome-less) so the dialog reads as a contained composite,  │
//    │ so both surfaces diverge ONLY in the route chrome — which is │
//    │ exactly the API surface that should diverge.                │
//    └──────────────────────────────────────────────────────────────┘
//    Test surface below in ProfilePage.test.tsx exercises the
//    body-component rendering paths so the shared body contract
//    is locked at the COMPOSITION level (not just the page level).

export default function ProfilePage() {
  return (
    <PageWrapper variant="flush">
      <PageHeader
        title="账户"
        description="个人信息与账号管理"
        icon={<User className="h-5 w-5 text-muted-foreground" />}
      />
      <div className="mx-auto max-w-2xl px-6 pb-8">
        <AccountTab />
      </div>
    </PageWrapper>
  )
}
