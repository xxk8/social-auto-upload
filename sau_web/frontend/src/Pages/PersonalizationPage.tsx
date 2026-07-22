import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
// Round-OPT-prefs-dialog v5 (barrel migration): collapsed
// '@/features/preferences/tabs/PersonalizationTab' → '@/features/preferences'.
import { PersonalizationTab } from '@/features/preferences'
import { Sun } from 'lucide-react'

// ── Round-OPT-prefs-dialog-v4 (slice extraction):
//    PersonalizationPage is a thin wrapper that re-renders
//    PreferencesDialog's <PersonalizationTab /> under the
//    /dashboard/personalization route's PageHeader. See ProfilePage.tsx
//    for the full slice-rationale comment block; this page mirrors
//    the same `Components/PreferencesContent.tsx` →
//    `features/preferences/tabs/PersonalizationTab.tsx` migration.
//    The WAI-ARIA radiogroup + arrow-key navigation + theme mutation
//    all live in PersonalizationTab so the modal tab body AND this
//    route-mounted page render the SAME markup. Theme mutation goes
//    through the same useTheme() hook both surfaces consume —
//    picking "深色" updates the entire app instantly regardless of
//    which surface flipped the switch.

export default function PersonalizationPage() {
  return (
    <PageWrapper variant="flush">
      <PageHeader
        title="个性化"
        description="外观与显示"
        icon={<Sun className="h-5 w-5 text-muted-foreground" />}
      />
      <PersonalizationTab />
    </PageWrapper>
  )
}
