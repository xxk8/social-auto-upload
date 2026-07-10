## ADDED Requirements

### Requirement: Publish Wizard (openspec delta-format stub — see archived content below)
The `Publish Wizard` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Publish Wizard` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # publish-wizard Specification
    
    ## Overview
    
    Replace the single long publish form with a 3-step guided wizard. Each step focuses on one concern (Upload → Content → Review & Submit), reducing cognitive load and improving mobile usability.
    
    ## Requirements
    
    ### R1: Step navigation
    
    - **Steps**: 1 (Upload), 2 (Content), 3 (Review & Submit)
    - **Step indicator**: Horizontal stepper bar at top with numbered circles + labels, connected by lines
    - **Active step**: Filled circle with brand color, bold label
    - **Completed steps**: Checkmark icon, clickable to go back
    - **Future steps**: Outlined circle, grayed label, clickable only if all prior steps valid
    - **Navigation buttons**: "上一步" (back) / "下一步" (next) at bottom of each step
    - **Keyboard**: `Alt+←` / `Alt+→` to navigate steps
    
    ### R2: Step 1 — Upload
    
    - **Content type toggle**: Video / Note radio or segmented control
    - **File upload**: Dropzone (same as current VideoForm/NoteForm file input)
    - **Thumbnail**: Video mode → thumbnail upload. Note mode → image upload (multiple)
    - **Validation**: Must have at least 1 file uploaded to proceed
    
    ### R3: Step 2 — Content
    
    - **Fields**: Title, Description/Note, Tags (TagInput), Schedule (optional)
    - **AI sidebar**: Collapsible panel on right (same as current)
    - **Platform-specific fields**: Bilibili tid, Douyin product link, Tencent draft mode — shown as Accordion below main fields, auto-expanded when relevant platform is selected
    - **Auto-save**: Draft saved to localStorage on every field change (see draft-templates spec)
    - **Validation**: Title required. Tags ≤ platform limit.
    
    ### R4: Step 3 — Review & Submit
    
    - **Content preview**: Full preview card (see content-preview spec)
    - **Platform selection**: GroupPublishSelector showing selected group's platforms with validity indicators
    - **Schedule**: Final schedule picker if not set in Step 2
    - **Submit button**: Large "发布到 N 个平台" button
    - **Summary**: Compact summary of Step 1 + Step 2 choices (file name, title, tags, platforms)
    
    ### R5: State management
    
    - **Store**: Zustand `publishWizardStore`
    - **Shape**:
      ```typescript
      interface PublishWizardState {
        currentStep: 1 | 2 | 3
        mode: 'video' | 'note'
        files: File[]
        thumbnail: File | null
        images: File[]  // note mode
        // ... form data from existing publishStore
        selectedGroupId: string | null
        canProceed: () => boolean
        next: () => void
        back: () => void
        setStep: (n: number) => void
        reset: () => void
      }
      ```
    - **Integration**: Existing `publishStore` continues to hold form field values. Wizard store manages navigation + file state.
    
    ### R6: URL state
    
    - **Query param**: `?step=2` in URL for deep linking
    - **Browser back**: Navigates wizard step back (intercept `popstate`)
    - **Direct URL**: `/publish?step=3` → opens wizard at Step 3 (if prior steps have data)
    
    ### R7: Mobile layout
    
    - **Steps**: Vertical stepper on left side (compact)
    - **Navigation**: Fixed bottom bar with "上一步" / "下一步" buttons
    - **AI panel**: Bottom sheet triggered by FAB (existing behavior)
    - **Preview**: Bottom sheet triggered by eye icon
    
    ## UI Components
    
    | Component | Location | Description |
    |-----------|----------|-------------|
    | `PublishWizard` | `/publish` route | Main wizard container |
    | `StepIndicator` | Top of wizard | Horizontal stepper |
    | `UploadStep` | Step 1 | File dropzone + type toggle |
    | `ContentStep` | Step 2 | Form fields + AI sidebar |
    | `ReviewStep` | Step 3 | Preview + platform selection + submit |
    | `WizardNav` | Bottom of wizard | Back/Next/Submit buttons |
    | `StepSummary` | ReviewStep | Compact summary of previous steps |
    
    ## Integration with Existing Components
    
    - `VideoForm` and `NoteForm` fields are extracted into `ContentStep` (reuse form logic, not the full component)
    - `GroupPublishSelector` reused in `ReviewStep`
    - `AiPanel` reused in `ContentStep`
    - `PublishSuccessBanner` shown after successful submit (existing behavior)
    - Confetti animation on success (existing, per VALUE-UPGRADE #2)
    
    ## Acceptance Criteria
    
    - [ ] Open `/publish` → see 3-step indicator → Step 1 active
    - [ ] Upload file → click "下一步" → Step 2 with fields
    - [ ] Fill title + tags → click "下一步" → Step 3 with preview
    - [ ] Click step indicator circle → navigate directly to that step
    - [ ] Back button → returns to previous step with data preserved
    - [ ] Mobile → vertical stepper, bottom navigation bar
    - [ ] URL shows `?step=2` → direct link opens at Step 2
    - [ ] Submit → success banner + confetti → wizard resets to Step 1
    
