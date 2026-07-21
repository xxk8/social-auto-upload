## ADDED Requirements

### Requirement: Scheduled Timeline (openspec delta-format stub — see archived content below)
The `Scheduled Timeline` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Scheduled Timeline` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # scheduled-timeline Specification
    
    ## Overview
    
    Calendar/timeline view in TasksPage showing future scheduled tasks as visual cards on a time × platform grid. Enables users to see "what's coming" and drag-to-reschedule.
    
    ## Requirements
    
    ### R1: Timeline view toggle
    
    - **Location**: TasksPage, toggle button in header: "列表视图" / "时间线视图"
    - **Default**: List view (current behavior preserved)
    - **Persistence**: View mode stored in localStorage
    
    ### R2: Timeline grid layout
    
    - **X-axis**: Time (hours of day, or days of week/month depending on zoom)
    - **Y-axis**: Platforms (one row per platform: 抖音, B站, 小红书, 快手, 视频号, 百家号, TikTok)
    - **Cards**: Each scheduled task rendered as a colored card at its `scheduled_at` time
    - **Card content**: Title (truncated), account name, time
    - **Card color**: Platform brand color (from `PLATFORM_COLORS`)
    - **Now line**: Vertical red line at current time
    
    ### R3: Zoom levels
    
    - **Day view**: Hours on x-axis (00:00 – 23:00), shows single day
    - **Week view**: Days on x-axis (Mon–Sun), shows current week
    - **Month view**: Days on x-axis (1–31), shows current month
    - **Navigation**: Left/right arrows to move date range, "今天" button to reset
    
    ### R4: Drag-to-reschedule
    
    - **Behavior**: Drag a task card to a new time slot → update `tasks.scheduled_at` via API
    - **Confirmation**: Show toast "已调整到 {new_time}" with "撤销" option (5s window)
    - **Constraint**: Cannot schedule in the past. Cannot schedule more than 30 days ahead.
    - **API**: `POST /api/tasks/reschedule { task_id, new_scheduled_at }`
    
    ### R5: Empty state
    
    - **When**: No scheduled tasks in current view range
    - **Display**: EmptyState component with calendar icon + "暂无定时任务" + "去发布" CTA
    
    ## API Endpoints
    
    ```
    GET /api/tasks/scheduled?from=YYYY-MM-DD&to=YYYY-MM-DD
    Response: {
      tasks: Array<{
        task_id: string,
        platform: string,
        account: string,
        title: string,
        scheduled_at: string,  // ISO 8601
        status: string
      }>
    }
    
    POST /api/tasks/reschedule
    Request: { task_id: string, new_scheduled_at: string }
    Response: { success: true, task: { ... } }
    ```
    
    ## UI Components
    
    | Component | Location | Description |
    |-----------|----------|-------------|
    | `ScheduleTimeline` | TasksPage (alternate view) | Main timeline grid |
    | `TimelineHeader` | Top of timeline | Date navigation + zoom toggle |
    | `TimelineGrid` | Center | CSS Grid with time columns × platform rows |
    | `TaskCard` | Inside grid cells | Draggable task card |
    | `NowLine` | Grid overlay | Current time indicator |
    
    ## Database
    
    No schema changes. Uses existing `tasks.scheduled_at` column (added in executor refactor).
    
    ## Acceptance Criteria
    
    - [ ] TasksPage → click "时间线视图" → grid appears with scheduled tasks
    - [ ] Drag task card to new time → toast confirmation → task updated
    - [ ] Click "今天" → view resets to current day
    - [ ] Switch between Day/Week/Month → grid adjusts
    - [ ] No scheduled tasks → empty state with "去发布" CTA
    - [ ] View mode persists across page refreshes
    
