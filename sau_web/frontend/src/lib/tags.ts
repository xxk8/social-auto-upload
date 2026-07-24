/**
 * Tag-domain utilities — single source of truth for the canonical
 * `#tag` representation shared between `Components/ui/tag-input.tsx`
 * (UI), `stores/publishWizardStore.ts` (state), `lib/chat/chatFormBridge.ts`
 * (chat pipeline), and `api.uploadVideo`/`api.uploadNoteMultipart`
 * (wire-format boundary).
 *
 * Path C refactor: `content.tags` is natively `string[]` everywhere
 * except the HTTP wire boundary (which still expects the
 * comma-joined string the backend `web_runner/routes/inbox.py`
 * already parses). This module is the ONLY place that knows about
 * the boundary. Adding a 3rd representation later (e.g. JSON
 * array on the wire for richer unicode normalisation) requires
 * touching `serializeTags` and the backend parser — no caller
 * changes.
 */

// Tag token: starts with `#` followed by 1 or more chars. Anything
// matching this regex is the canonical form `normalizeTag` returns;
// `parseTags` collapses to this shape on the way in.
const TAG_TOKEN_RX = /^[#,，\s]+/
const INNER_COMMA_RX = /,/g
const LEADING_HASH_RX = /^#+/
const SPLIT_RX = /[,，]+/

/**
 * Canonicalize a raw user-typed tag into the `#text` form.
 *
 * Trims whitespace, strips any leading mix of `#` / `,` / `，` / whitespace,
 * removes inner commas, then prepends a single `#`. Empty / pure-noise
 * input returns `''`, which callers use as a "no-op" sentinel.
 */
export function normalizeTag(raw: string): string {
  const cleaned = raw.trim().replace(TAG_TOKEN_RX, '').replace(INNER_COMMA_RX, '')
  return cleaned ? `#${cleaned}` : ''
}

/**
 * Strip the canonical `#` prefix for display purposes (e.g. inside a
 * chip's tool-tip or the rendered chip text).
 */
export function tagText(tag: string): string {
  return tag.replace(LEADING_HASH_RX, '')
}

/**
 * Parse `content.tags` source material into a canonical dedupe'd
 * `string[]` of normalized `#tag` entries.
 *
 * Accepts either a wire-format string (`"#foo,#bar"` / `"#foo，#bar"`)
 * OR an already-array shape (`["#foo", "#bar"]`) — the latter is the
 * post-Path-C native representation. Null / undefined / non-string-non-
 * array returns `[]` so callers don't have to dispatch on shape.
 *
 * The output is **stable**: same input → same reference (after the
 * initial Set → Array.from pass). Array contents are deduped by
 * canonical form so `'foo'` and `'#foo'` collapse to one entry.
 *
 * Used by:
 *   - `stores/publishWizardStore.ts` `setContent({ tags })` to
 *     accept legacy string drafts and array form alike;
 *   - `lib/chat/chatFormBridge.ts::safeGetFormSnapshot` to migrate
 *     legacy `FormSnapshot.tags: string` payloads on read;
 *   - `Pages/PublishPage.tsx::handleApplyVariant` to safely accept
 *     `ContentVariant.tags` which can be either string or array.
 */
export function parseTags(
  input: string | readonly string[] | null | undefined,
): string[] {
  if (input == null) return []
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((t) => normalizeTag(String(t))).filter(Boolean)))
  }
  if (typeof input !== 'string') return []
  return Array.from(
    new Set(
      input
        .split(SPLIT_RX)
        .map((t) => normalizeTag(t))
        .filter(Boolean),
    ),
  )
}

/**
 * Serialize `string[]` tags to the wire-format comma-joined string,
 * normalized through `parseTags` so a no-op round-trip is canonical.
 *
 * Single source of truth for the `tag-as-wire-string` contract used by
 * `api.uploadVideo({ tags })` and `api.uploadNoteMultipart({ tags })`.
 * Returns `''` for empty / null / undefined input.
 *
 * Caller responsibility: if the receiving form-data channel needs
 * `undefined` when no tags exist (rather than empty string), apply the
 * `|| undefined` pattern at the call site, e.g.
 *   `tags: serializeTags(content.tags) || undefined`.
 */
export function serializeTags(tags: readonly string[] | null | undefined): string {
  if (!tags) return ''
  return parseTags(Array.from(tags)).join(',')
}
