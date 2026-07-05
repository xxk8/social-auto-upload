# content-preview Specification

## Overview

Real-time preview panel in PublishPage showing how the video/note will look before submission. Displays title layout, cover image, tags, and description truncation in a card mimicking the target platform's post layout.

## Requirements

### R1: Preview panel location

- **Desktop**: Right side of PublishPage, below or beside the AI sidebar. Toggle between AI panel and preview panel via tab buttons.
- **Mobile**: Bottom sheet triggered by "预览" button (eye icon) in the form toolbar.
- **Default state**: Preview visible on desktop, hidden on mobile.

### R2: Video preview card

- **Cover image**: Display uploaded thumbnail or first frame placeholder
- **Title**: Form title field, truncated at 2 lines with ellipsis
- **Description**: Form description, truncated at 3 lines
- **Tags**: Rendered as chip row below description
- **Platform indicators**: Small platform icons showing which platforms will receive this content
- **Schedule badge**: If schedule is set, show "定时: MM-DD HH:MM" badge

### R3: Note preview card

- **Image carousel**: Display uploaded images in a horizontal scrollable row (max 4 visible, "+N" for overflow)
- **Title**: Form title, single line with ellipsis
- **Content/Note**: Form note field, truncated at 4 lines
- **Tags**: Chip row
- **Layout**: Mimics Xiaohongshu-style image grid + text below

### R4: Real-time sync

- **Binding**: Preview updates on every form field change (no debounce — instant visual feedback)
- **Source**: Read from Zustand publish store directly (no API calls)
- **Performance**: Use `useDeferredValue` for preview rendering to avoid blocking form input

### R5: Empty/placeholder states

- **No file uploaded**: Show dashed border area with "上传文件后预览" text
- **No title**: Show placeholder text "输入标题..." in muted color
- **No tags**: Hide tag row entirely

## UI Components

| Component | Location | Description |
|-----------|----------|-------------|
| `ContentPreview` | PublishPage right panel | Main preview container |
| `VideoPreviewCard` | Inside ContentPreview | Video-style preview card |
| `NotePreviewCard` | Inside ContentPreview | Note-style preview card |
| `PreviewToggle` | PublishPage toolbar | Switch between AI panel / Preview |
| `MobilePreviewSheet` | Mobile only | Bottom sheet with preview |

## Data Source

All data from Zustand publish store — no API calls, no new backend endpoints.

## Acceptance Criteria

- [ ] Type title in form → preview updates instantly
- [ ] Upload thumbnail → preview shows cover image
- [ ] Add tags → chips appear in preview
- [ ] Switch video/note mode → preview card style changes
- [ ] No file uploaded → placeholder shown
- [ ] Mobile → "预览" button opens bottom sheet
- [ ] Preview does not block form input (lag-free typing)
