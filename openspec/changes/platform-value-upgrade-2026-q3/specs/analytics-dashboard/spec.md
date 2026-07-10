## ADDED Requirements

### Requirement: Analytics Dashboard (openspec delta-format stub — see archived content below)
The `Analytics Dashboard` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Analytics Dashboard` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # analytics-dashboard Specification
    
    ## Overview
    
    New `/analytics` page providing publish performance insights: volume trends, platform distribution, success/failure rates, failure reasons, and account activity. Serves as the primary Pro tier differentiator.
    
    ## Requirements
    
    ### R1: Summary statistics cards
    
    - **Total publishes**: Count of all tasks in selected date range
    - **Success rate**: `success / total * 100` as percentage
    - **Active accounts**: Distinct count of accounts with ≥ 1 task in range
    - **Today's publishes**: Count of today's tasks
    - **Layout**: 4 cards in a responsive grid, each with icon, value, label, and trend indicator (↑/↓ vs previous period)
    
    ### R2: Publish volume trend chart
    
    - **Type**: Area chart (recharts `AreaChart`)
    - **X-axis**: Date (daily granularity)
    - **Y-axis**: Task count
    - **Series**: Success (green) stacked with Failed (red)
    - **Interaction**: Hover tooltip showing exact counts per day
    - **Time range**: Dropdown selector — 7天 / 30天 / 90天 / 自定义
    
    ### R3: Platform distribution chart
    
    - **Type**: Donut chart (recharts `PieChart` with inner radius)
    - **Segments**: One per platform, colored by platform brand color
    - **Center text**: Total count
    - **Interaction**: Click segment → filter other charts to that platform
    - **Legend**: Right side, showing platform name + count + percentage
    
    ### R4: Failure reason analysis
    
    - **Type**: Horizontal bar chart
    - **Data**: Top 5 failure reasons extracted from `tasks.result` JSON (error message classification)
    - **Sorting**: Descending by count
    - **Fallback**: If `result` is not structured, use raw first 50 chars as reason
    
    ### R5: Account activity table
    
    - **Columns**: Account name, Platform, Total tasks, Success rate, Last active
    - **Sorting**: By total tasks (descending by default)
    - **Filtering**: Search by account name
    - **Highlighting**: Rows with failure rate > 30% shown in warning color
    
    ### R6: Export
    
    - **Format**: CSV download
    - **Content**: All tasks in selected date range with columns: date, platform, account, title, status, error
    - **Trigger**: "导出 CSV" button in top-right of page
    
    ### R7: Tier-based data window
    
    - **Free tier**: Data limited to last 7 days. Chart x-axis locked. Upgrade prompt shown.
    - **Pro tier / Legacy**: Full date range, custom date picker enabled
    - **Detection**: Read `users.license_tier` from auth context
    
    ## API Endpoints
    
    ```
    GET /api/analytics/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
    Response: {
      total: number,
      success: number,
      failed: number,
      today: number,
      prev_total: number,     // for trend comparison
      prev_success: number,
      by_platform: Record<string, { success: number, failed: number }>,
      by_day: Array<{ date: string, success: number, failed: number }>,
      failure_reasons: Array<{ reason: string, count: number }>
    }
    
    GET /api/analytics/accounts?from=YYYY-MM-DD&to=YYYY-MM-DD
    Response: {
      accounts: Array<{
        account: string,
        platform: string,
        total: number,
        success: number,
        failed: number,
        success_rate: number,
        last_active: string
      }>
    }
    
    GET /api/analytics/export?from=YYYY-MM-DD&to=YYYY-MM-DD
    Response: CSV file download
    ```
    
    ## UI Components
    
    | Component | Location | Description |
    |-----------|----------|-------------|
    | `AnalyticsPage` | `/analytics` route | Top-level page with filter bar + grid |
    | `StatsCards` | Top of page | 4 summary metric cards |
    | `VolumeTrendChart` | Main content area | Stacked area chart |
    | `PlatformPieChart` | Side panel or below trend | Donut chart |
    | `FailureReasonChart` | Below trend | Horizontal bar chart |
    | `AccountActivityTable` | Bottom section | Sortable/filterable table |
    | `DateRangeSelector` | Page header | Dropdown + custom date picker |
    | `ExportButton` | Page header | CSV download button |
    | `QuotaUpgradeBanner` | Below filter bar (Free tier) | "升级 Pro 解锁完整数据" |
    
    ## Database
    
    No new tables required. Queries run against existing `tasks` table with composite index:
    
    ```sql
    CREATE INDEX idx_tasks_analytics ON tasks(platform, status, created_at);
    ```
    
    ## Acceptance Criteria
    
    - [ ] Navigate to `/analytics` → see 4 summary cards with real data
    - [ ] Select "30天" → charts update with 30-day data
    - [ ] Hover area chart → tooltip shows per-day success/fail counts
    - [ ] Click platform in donut → other charts filter to that platform
    - [ ] Free user → data limited to 7 days, upgrade banner shown
    - [ ] Pro user → custom date range works, full history visible
    - [ ] Click "导出 CSV" → file downloads with correct data
    - [ ] Account table → sort by success rate → lowest rate first
    
