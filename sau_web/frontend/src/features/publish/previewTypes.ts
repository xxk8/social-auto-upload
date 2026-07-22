/**
 * `FormPreviewData` is the canonical pre-publish form snapshot shape
 * used by light-weight live-preview consumers.
 *
 * Originally lived in `PublishPreview.tsx` next to the (now deleted)
 * `PublishPreview` component. After the wizard pipeline absorbed the
 * full preview surface into `wizard/ReviewStep`, the standalone
 * publish preview was retired and the type was migrated here so:
 *   1. callers that still want `onFormChange: (data: FormPreviewData) => void`
 *      (currently the orphan `VideoForm` / `NoteForm` / `ContentStep`)
 *      keep a single canonical shape imported from one place; and
 *   2. future live-preview surfaces can re-import this type without
 *      standing up a `PublishPreview` component.
 *
 * **Why not colocate with `wizard/ContentStep`**: keeping this type
 * OUTSIDE the wizard package means `VideoForm`/`NoteForm` (legacy
 * forms with their own `onFormChange?` prop) can keep importing
 * from a stable relative path independent of wizard internals.
 */
export type FormPreviewData = {
  title: string
  desc: string
  /** Path C: native `string[]`. Live preview consumers read this as-is. */
  tags: string[] | string
  fileUrls: string[]
  fileType: 'video' | 'image' | null
}
