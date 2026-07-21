## ADDED Requirements

### Requirement: Three-step wizard navigation

The system SHALL replace the single long publish form with a 3-step guided wizard: Step 0 (Upload), Step 1 (Content), Step 2 (Review & Submit). The wizard SHALL render a `StepIndicator` at the top showing all 3 steps with numbered circles, and a `WizardNav` at the bottom with "上一步" (back) / "下一步" (next) buttons. A `GroupPublishSelector` SHALL be always visible above the step content so the user can change target platforms at any point.

#### Scenario: Initial render at step 0

- **WHEN** the user navigates to `/dashboard/publish`
- **THEN** the wizard SHALL render at step 0 (Upload)
- **AND** the StepIndicator SHALL show step 0 as active, steps 1 and 2 as future
- **AND** WizardNav SHALL show "上一步" (disabled) and "下一步" buttons

#### Scenario: Step navigation forward

- **GIVEN** the user is at step 0 with a valid group selection and file uploaded
- **WHEN** the user clicks "下一步"
- **THEN** `nextStep()` SHALL advance `currentStep` from 0 to 1
- **AND** the ContentStep component SHALL render with an animated transition

#### Scenario: Step navigation backward

- **GIVEN** the user is at step 1
- **WHEN** the user clicks "上一步"
- **THEN** `prevStep()` SHALL decrement `currentStep` from 1 to 0
- **AND** all previously entered data SHALL be preserved

#### Scenario: Step indicator click-back

- **GIVEN** the user has reached step 2 (maxVisitedStep = 2)
- **WHEN** the user clicks the step 0 circle in the StepIndicator
- **THEN** the wizard SHALL navigate directly to step 0
- **AND** the click SHALL be rejected if the target step exceeds `maxVisitedStep`

#### Scenario: URL deep-linking

- **WHEN** the user navigates to `/dashboard/publish?step=2`
- **THEN** the wizard SHALL initialize at step 2
- **AND** subsequent step changes SHALL update the URL via `setSearchParams` with `replace: true`

#### Scenario: Browser back navigates wizard steps

- **GIVEN** the user is at step 2 with URL `?step=2`
- **WHEN** the user presses the browser back button
- **THEN** the searchParams effect SHALL detect the URL change and call `setStep` to navigate to the previous step

### Requirement: Per-step validation gate

The `canProceed()` function SHALL return `false` when the current step's required fields are not filled. The `proceedReason()` function SHALL return a human-readable reason string when `canProceed()` is `false`, and `null` when ready. WizardNav SHALL display `proceedReason` as the `title` tooltip on the disabled next button.

#### Scenario: Step 0 requires group + file

- **GIVEN** the user is at step 0 with no group selected
- **THEN** `canProceed()` SHALL return `false`
- **AND** `proceedReason()` SHALL return `"请先在上方选择发布账号组"`

#### Scenario: Step 0 video mode requires main file

- **GIVEN** the user is at step 0 in video mode with a group selected but no file
- **THEN** `canProceed()` SHALL return `false`
- **AND** `proceedReason()` SHALL return `"请上传视频文件"`

#### Scenario: Step 0 note mode requires at least one image

- **GIVEN** the user is at step 0 in note mode with a group selected but no images
- **THEN** `canProceed()` SHALL return `false`
- **AND** `proceedReason()` SHALL return `"请至少添加一张图片"`

#### Scenario: Step 1 requires non-empty title

- **GIVEN** the user is at step 1 with `content.title` being empty or whitespace-only
- **THEN** `canProceed()` SHALL return `false`
- **AND** `proceedReason()` SHALL return `"请填写标题"`

#### Scenario: Step 2 always proceedable

- **GIVEN** the user is at step 2
- **THEN** `canProceed()` SHALL return `true` (the submit button is the final action)

#### Scenario: Group with zero platforms blocks progression

- **GIVEN** the user has selected a group with `platforms.length === 0`
- **THEN** `canProceed()` SHALL return `false` at all steps
- **AND** `proceedReason()` SHALL return `"请至少勾选一个发布平台"`

### Requirement: Zustand state management via publishWizardStore

The wizard state SHALL be managed by a Zustand store `usePublishWizardStore` with a `currentStep` (0 | 1 | 2), `mode` ('video' | 'note'), `files` (WizardFile), `content` (WizardContent), and `groupSelection` (GroupSelection | null). The store SHALL provide `setStep`, `nextStep`, `prevStep`, `canProceed`, `proceedReason`, and `reset` methods.

#### Scenario: Reset clears all state

- **WHEN** `reset()` is called
- **THEN** `currentStep` SHALL be set to 0, `mode` to `'video'`, `files` to empty, `content` to empty, and `groupSelection` to `null`

#### Scenario: Mode switch clears files

- **WHEN** `setMode('note')` is called after files were set in video mode
- **THEN** `mode` SHALL be set to `'note'`
- **AND** `files` SHALL be reset to the empty state (switching mode invalidates prior file selections)

#### Scenario: Tags maintain reference stability

- **GIVEN** the store has `content.tags = ['foo', 'bar']`
- **WHEN** the user types in the title field (triggering `setContent({ title: 'new' })`)
- **THEN** the `content.tags` array reference SHALL NOT change (Zustand's strict-equality check prevents re-render of tag subscribers)

#### Scenario: Adding a duplicate tag is a no-op

- **GIVEN** `content.tags = ['foo']`
- **WHEN** `addTag('foo')` is called
- **THEN** `content.tags` SHALL remain `['foo']` with the same array reference (no new allocation)

#### Scenario: setContent accepts both string[] and string for tags

- **WHEN** `setContent({ tags: 'foo,bar,baz' })` is called (legacy wire-form string)
- **THEN** the store SHALL normalize via `parseTags` and store `['foo', 'bar', 'baz']` as a `string[]`

### Requirement: Step 0 — Upload step

The UploadStep SHALL provide a video/note mode toggle, a file dropzone, and thumbnail upload (video mode) or multi-image upload (note mode). The mode toggle SHALL clear files when switching modes.

#### Scenario: Video mode file upload

- **GIVEN** the wizard is in video mode at step 0
- **WHEN** the user drops a video file into the dropzone
- **THEN** `setFiles({ file: <File> })` SHALL be called
- **AND** `canProceed()` SHALL return `true` (if a group is selected)

#### Scenario: Note mode image upload

- **GIVEN** the wizard is in note mode at step 0
- **WHEN** the user adds 2 images
- **THEN** `setFiles({ images: [img1, img2] })` SHALL be called
- **AND** `canProceed()` SHALL return `true` (if a group is selected)

#### Scenario: Mode toggle clears files

- **GIVEN** the user uploaded a video file in video mode
- **WHEN** the user switches to note mode
- **THEN** the `files` state SHALL be reset to empty (the video file is no longer relevant)

### Requirement: Step 1 — Content step

The ContentStep SHALL render title, description, tags (TagInput), optional schedule picker, and platform-specific advanced fields in a collapsible Accordion. All field values SHALL be synced to `usePublishWizardStore.content` so ReviewStep can render a preview without re-querying.

#### Scenario: Title entry

- **WHEN** the user types "我的第一个视频" in the title field
- **THEN** `setContent({ title: '我的第一个视频' })` SHALL be called
- **AND** `canProceed()` SHALL return `true` at step 1

#### Scenario: Platform-specific fields shown as accordion

- **GIVEN** the selected group includes Bilibili
- **WHEN** ContentStep renders
- **THEN** a Bilibili-specific section (tid field) SHALL appear in the advanced Accordion
- **AND** the Accordion SHALL auto-expand when the GroupPublishSelector's "N 项平台专属待配置" chip is clicked

#### Scenario: Tag input normalization

- **WHEN** the user enters "#旅行 #美食" in the TagInput
- **THEN** `parseTags` SHALL normalize to `['旅行', '美食']` (stripping `#` prefix, deduplicating)

### Requirement: Step 2 — Review & submit step

The ReviewStep SHALL render a content preview (thumbnail/title/tags/description), a compact summary of Step 1 + Step 2 choices, and the final submit button. The submit handler SHALL be exposed via a ref so WizardNav's final-step button can trigger it imperatively.

#### Scenario: Review renders preview

- **GIVEN** the user has uploaded a video and entered title + tags in prior steps
- **WHEN** the user reaches step 2
- **THEN** ReviewStep SHALL display the file name, title, tag chips, and selected platforms

#### Scenario: Submit triggers from WizardNav

- **GIVEN** the user is at step 2
- **WHEN** the user clicks the "发布" button in WizardNav
- **THEN** `handleNext()` SHALL detect `currentStep === 2` and call `submitRef.current()`
- **AND** the submitting state SHALL show a Loader2 spinner on the button

#### Scenario: Successful submit resets wizard

- **GIVEN** the submit handler completes successfully
- **WHEN** `handleSubmit` is called with the result info
- **THEN** `reset()` SHALL be called to return to step 0
- **AND** `maxVisitedStep` SHALL be reset to 0
- **AND** the `?step` URL parameter SHALL be removed

### Requirement: WizardNav button labels and states

The WizardNav SHALL show "上一步" on the left (disabled at step 0), a step counter "N / 3" in the center, and "下一步" on the right (steps 0–1) or "发布" (step 2). The next/submit button SHALL be disabled when `!canProceed || submitting`. The disabled button SHALL display `proceedReason` as its `title` tooltip.

#### Scenario: Step counter display

- **GIVEN** the user is at step 1
- **THEN** WizardNav SHALL display "2 / 3" in the center

#### Scenario: Submitting state overrides disabled reason

- **GIVEN** the user clicks "发布" and the request is in-flight (`submitting = true`)
- **THEN** the button SHALL show a spinner and the `title` SHALL be "发布中…" (not the stale `disabledReason`)

#### Scenario: First step hides back button

- **GIVEN** the user is at step 0
- **THEN** the "上一步" button SHALL have `opacity-0` and `pointer-events-none` (visually hidden but accessible)

### Requirement: Mode-dependent group selection reset

The wizard SHALL reset `groupSelection` to `null` when the mode switches between video and note, but NOT on initial mount. This prevents a user who pre-selected accounts from losing their pick on first render.

#### Scenario: Mode switch resets group selection

- **GIVEN** the user has selected a group in video mode
- **WHEN** the user switches to note mode
- **THEN** `groupSelection` SHALL be set to `null`
- **AND** the GroupPublishSelector SHALL show the empty state

#### Scenario: Initial mount does not reset group selection

- **GIVEN** the wizard mounts in video mode with a pre-existing `groupSelection` (e.g., from a deep link)
- **WHEN** the component mounts
- **THEN** the `modeHasMounted` ref gate SHALL skip the first effect run
- **AND** `groupSelection` SHALL be preserved
