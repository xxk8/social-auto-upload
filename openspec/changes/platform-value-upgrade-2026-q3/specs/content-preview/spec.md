## ADDED Requirements

### Requirement: FormPreviewData canonical snapshot type

The system SHALL define a `FormPreviewData` type in `sau_web/frontend/src/features/publish/previewTypes.ts` as the canonical pre-publish form snapshot shape. The type SHALL include `title` (string), `desc` (string), `tags` (string[]), `fileUrls` (string[]), and `fileType` ('video' | 'image' | null). The type SHALL be importable from a stable path outside the wizard package so legacy forms (`VideoForm`, `NoteForm`, `ContentStep`) can use it without depending on wizard internals.

#### Scenario: FormPreviewData shape

- **WHEN** a consumer imports `FormPreviewData` from `previewTypes.ts`
- **THEN** the type SHALL include `title: string`, `desc: string`, `tags: string[]`, `fileUrls: string[]`, and `fileType: 'video' | 'image' | null`

#### Scenario: Tags are native string array

- **GIVEN** the `tags` field in `FormPreviewData`
- **THEN** live-preview consumers SHALL read `tags` as-is (native `string[]`, not wire-form comma string)

### Requirement: Video preview card in ReviewStep

The ReviewStep (Step 3 of the Publish Wizard) SHALL render a video preview card showing the uploaded video file, title, description, tags, and schedule. The video SHALL be rendered in a `<video>` element with `controls`, `preload="metadata"`, and a max height of 200px.

#### Scenario: Video preview with file

- **GIVEN** the user uploaded a video file and reached step 2
- **WHEN** ReviewStep renders
- **THEN** a `<video>` element SHALL display the first preview URL with `controls` and `preload="metadata"`
- **AND** the video SHALL be constrained to `max-h-[200px]` with `object-contain`

#### Scenario: Video preview title display

- **GIVEN** the user entered a title in step 1
- **WHEN** ReviewStep renders the content summary
- **THEN** the title SHALL be displayed with a `FileText` icon and label "标题"

#### Scenario: Video description with line clamp

- **GIVEN** the user entered a description
- **WHEN** ReviewStep renders the body field
- **THEN** the description SHALL be displayed with label "视频简介" and `line-clamp-4` (truncated at 4 lines)

#### Scenario: Empty title placeholder

- **GIVEN** the user did not enter a title
- **WHEN** ReviewStep renders the title field
- **THEN** the value SHALL display "（未填写）"

### Requirement: Note preview card in ReviewStep

The ReviewStep SHALL render a note preview card showing uploaded images in a 4-column grid, title, note body, tags, and schedule. The image grid SHALL display a maximum of 4 images with a "+N" overflow indicator for additional images.

#### Scenario: Note image grid with 4 or fewer images

- **GIVEN** the user uploaded 3 images in note mode
- **WHEN** ReviewStep renders the media preview
- **THEN** a 4-column grid SHALL display each image with `object-cover` and `h-[88px]`

#### Scenario: Note image grid with more than 4 images

- **GIVEN** the user uploaded 6 images
- **WHEN** ReviewStep renders the media preview
- **THEN** the first 4 images SHALL be displayed
- **AND** a "+2" overflow indicator SHALL appear showing `ImageIcon` + the remaining count

#### Scenario: Note body label

- **GIVEN** the user is in note mode
- **WHEN** ReviewStep renders the body field
- **THEN** the label SHALL be "图文正文" (not "视频简介") with `line-clamp-4`

### Requirement: Tag chip display

The ReviewStep SHALL render tags as `Badge` components with `variant="outline"` in a flex-wrap row. Tags SHALL have the canonical `#` prefix stripped for display. The tag row SHALL be hidden entirely when no tags are present.

#### Scenario: Tags rendered as chips

- **GIVEN** `content.tags = ['旅行', '美食']`
- **WHEN** ReviewStep renders
- **THEN** each tag SHALL be displayed in a `Badge` with `variant="outline"` and `h-5 px-1.5 text-[10px]`
- **AND** the `#` prefix SHALL be stripped via `t.replace(/^#+/, '')`

#### Scenario: Empty tags hide the row

- **GIVEN** `content.tags = []`
- **WHEN** ReviewStep renders
- **THEN** the tag row SHALL NOT be rendered (hidden entirely, not an empty row)

### Requirement: Schedule badge display

The ReviewStep SHALL display a schedule field with a `Clock` icon and label "定时发布" when `content.schedule` is non-empty. The schedule field SHALL be hidden when no schedule is set.

#### Scenario: Schedule displayed

- **GIVEN** `content.schedule = "2026-07-15 10:00"`
- **WHEN** ReviewStep renders
- **THEN** a `Clock` icon SHALL appear with label "定时发布" and the schedule value

#### Scenario: No schedule hides the field

- **GIVEN** `content.schedule = ""`
- **WHEN** ReviewStep renders
- **THEN** the schedule field SHALL NOT be rendered

### Requirement: Target platform display

The ReviewStep SHALL display the selected target platforms with platform icons and labels in a rounded container. A summary line SHALL show "将发布到 N 个平台". If the platform list is empty, a defensive warning banner SHALL appear.

#### Scenario: Platforms displayed with icons

- **GIVEN** `groupSelection.platforms = ['douyin', 'bilibili']`
- **WHEN** ReviewStep renders the target platforms section
- **THEN** each platform SHALL be rendered with a `PlatformIcon` and its label from the `PLATFORMS` config
- **AND** a summary line SHALL show "将发布到 2 个平台"

#### Scenario: Empty platform list shows warning

- **GIVEN** `groupSelection.platforms = []`
- **WHEN** ReviewStep renders
- **THEN** a warning banner SHALL appear with "未选择发布平台"
- **AND** the banner SHALL advise the user to return to step 1 and select at least one platform

### Requirement: Real-time preview data flow

The preview data SHALL flow from `UploadStep` → `PublishWizard` → `ReviewStep` via the `onFormChange` callback, passing `previewUrls` (string[]) and `previewFileType` ('video' | 'image' | null). All content fields (title, desc, note, tags, schedule) SHALL be read directly from `usePublishWizardStore` — no API calls SHALL be made for preview rendering.

#### Scenario: Preview URLs flow from upload step

- **GIVEN** the user uploaded a video file in step 0
- **WHEN** `UploadStep` calls `onFormChange(urls, 'video')`
- **THEN** `PublishWizard` SHALL store the URLs in `previewUrls` state and pass them to `ReviewStep` as props

#### Scenario: Content fields read from store

- **WHEN** ReviewStep renders
- **THEN** `content.title`, `content.desc`, `content.note`, `content.tags`, and `content.schedule` SHALL be read from `usePublishWizardStore` via selector subscriptions
- **AND** no API calls SHALL be made to fetch preview data

### Requirement: Empty and placeholder states

The ReviewStep SHALL display placeholder text for missing fields and hide optional sections when their data is empty. Missing title and body SHALL show "（未填写）", empty tags SHALL hide the tag row, and empty schedule SHALL hide the schedule field.

#### Scenario: No file uploaded shows no media preview

- **GIVEN** `previewUrls` is empty
- **WHEN** ReviewStep renders
- **THEN** the media preview section SHALL NOT be rendered

#### Scenario: Missing title shows placeholder

- **GIVEN** `content.title` is empty
- **WHEN** ReviewStep renders the title field
- **THEN** the value SHALL be "（未填写）"

#### Scenario: Missing body shows placeholder

- **GIVEN** `content.desc` is empty (video mode) or `content.note` is empty (note mode)
- **WHEN** ReviewStep renders the body field
- **THEN** the value SHALL be "（未填写）"
