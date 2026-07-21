## ADDED Requirements

### Requirement: Draft Templates (openspec delta-format stub — see archived content below)
The `Draft Templates` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Draft Templates` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # draft-templates Specification
    
    ## Overview
    
    Enable users to save, restore, and reuse publish form presets. Includes auto-save drafts (localStorage) and named templates (DB). Also adds a "re-publish" action from task history.
    
    ## Requirements
    
    ### R1: Auto-save drafts to localStorage
    
    - **Trigger**: Any form field change in PublishPage, debounced 800ms
    - **Storage**: `localStorage.setItem('sau-draft-video', JSON.stringify(snapshot))` or `sau-draft-note`
    - **Restore**: On PublishPage mount, if draft exists and `< 24h` old, show toast "已恢复上次草稿" with "恢复" / "清空" actions
    - **Clear**: On successful submit, clear the draft key. On explicit "清空" button click (with AlertDialog confirmation per OPT-D)
    - **Snapshot shape**:
      ```typescript
      {
        mode: 'video' | 'note'
        title: string
        description: string
        tags: string[]
        schedule: string | null
        platformGroupId: string | null
        // platform-specific fields
        savedAt: number
      }
      ```
    
    ### R2: Named templates (DB-backed)
    
    - **Create**: User can save current form state as a named template via "保存为模板" button in PublishPage
    - **Storage**: `publish_templates` table (name, mode, snapshot JSON, timestamps)
    - **List**: "📂 我的模板" chip row in PublishPage, showing saved template names
    - **Apply**: Click template → fill form fields from snapshot (does not replace file/account selection)
    - **Edit**: Update template name or delete template via settings/manage dialog
    - **Export/Import**: JSON file download/upload for backup/sharing
    
    ### R3: Re-publish from task history
    
    - **Location**: TasksPage task row action menu → "↻ 重发"
    - **Behavior**: Copy task's `publish_detail` (title, desc, tags, schedule, platform, account group) back to PublishPage form
    - **Navigation**: Navigate to `/publish` with query param `?from_task=<task_id>`, PublishPage reads and fills form
    - **Two modes**: "覆盖当前表单" (replace) / "复制为新草稿" (save as template)
    
    ### R4: Clear all with confirmation
    
    - **Trigger**: "清空" button click in VideoForm / NoteForm
    - **Guard**: Only show AlertDialog if ≥ 2 fields are filled
    - **Confirmation**: "确认清空所有已填内容？此操作不可撤销。" with "取消" / "确认清空" buttons
    
    ## API Endpoints
    
    ```
    GET    /api/templates              → list all templates
    POST   /api/templates              → create template { name, mode, snapshot }
    PUT    /api/templates/<id>         → update template
    DELETE /api/templates/<id>         → delete template
    POST   /api/templates/import       → import JSON array of templates
    GET    /api/templates/export       → export all templates as JSON
    ```
    
    ## UI Components
    
    | Component | Location | Description |
    |-----------|----------|-------------|
    | `DraftRestoreToast` | `PublishPage` mount | Toast with restore/clear actions |
    | `TemplateChipRow` | `PublishPage` below form header | Horizontal scrollable chip list |
    | `SaveTemplateDialog` | `PublishPage` "保存为模板" button | Name input + save |
    | `ManageTemplatesDialog` | Settings or template row "管理" | Edit/delete/export/import |
    | `ClearConfirmDialog` | VideoForm/NoteForm "清空" button | AlertDialog |
    
    ## Acceptance Criteria
    
    - [ ] Fill form → refresh page → draft restored with toast
    - [ ] Save template → see it in chip row → click to apply → form filled
    - [ ] TasksPage → click "重发" → navigated to publish with prefilled form
    - [ ] "清空" button with ≥ 2 fields → confirmation dialog shown
    - [ ] Export templates → JSON file downloaded → Import → templates restored
    
