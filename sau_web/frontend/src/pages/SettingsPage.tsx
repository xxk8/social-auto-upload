import { PageHeader } from '@/components/ui/page-header'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { SettingsTab } from '@/features/preferences'
import { Settings as SettingsIcon } from 'lucide-react'

export default function SettingsPage() {
  return (
    <PageWrapper>
      <PageHeader
        title="设置"
        description="套餐、通知与相关页面"
        icon={<SettingsIcon className="h-5 w-5 text-muted-foreground" />}
      />
      <div className="mx-auto max-w-2xl px-1 pb-8">
        <SettingsTab />
      </div>
    </PageWrapper>
  )
}
