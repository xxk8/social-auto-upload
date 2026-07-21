import { PageHeader } from '@/Components/ui/page-header'
import { PageWrapper } from '@/Components/layout/PageWrapper'
// Round-OPT-prefs-dialog v5 (barrel migration): collapsed
// '@/features/preferences/tabs/SettingsTab' → '@/features/preferences'.
import { SettingsTab } from '@/features/preferences'
import { Settings as SettingsIcon } from 'lucide-react'

// ── Round-OPT-prefs-dialog-v4 (slice extraction):
//    SettingsPage is a thin wrapper that re-renders PreferencesDialog's
//    <SettingsTab /> under the /dashboard/settings route's PageHeader. See
//    ProfilePage.tsx for the full slice-rationale comment block;
//    this page mirrors the same `Components/PreferencesContent.tsx`
//    → `features/preferences/tabs/SettingsTab.tsx` migration. Future
//    copy revisions to TIER_MAP or the banner CTA copy land ONCE in
//    `features/preferences/shared/payments.ts` + SettingsTab so the
//    route page AND the modal tab inherit in lockstep.

export default function SettingsPage() {
  return (
    <PageWrapper>
      <PageHeader
        title="设置"
        description="账号权限与套餐管理"
        icon={<SettingsIcon className="h-5 w-5 text-muted-foreground" />}
      />
      <SettingsTab />
    </PageWrapper>
  )
}
