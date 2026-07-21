import { request } from './request'

const baseURL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : 'http://localhost:6001')

export interface StudioProject {
  id: number
  title: string
  synopsis: string
  style: string | null
  /**
   * Visual Style Preset envelope (round-OPT-presets-v1). The page
   * picker writes `{ preset, version: 1 }`; the catalog is the
   * authoritative source of valid `preset` ids, but the row keeps
   * the user's pick verbatim server-side (option B3) so a future
   * catalog-renamed preset can be surfaced as "未识别 · 回退到
   * Classic" instead of silently switching classes.
   *
   * `version: number` (not literal `1`) keeps the contract forward-
   * compatible: a backend bump to v2 schema only requires a
   * discriminated-union upgrade on the read side, not a type
   * change here. Mutation input on the PATCH side still uses
   * `version: 1` literal — the literal-to-number widening is
   * allowed by TS subtyping.
   */
  render_config?: { preset: string; version: number } | null
  status: 'draft' | 'generating' | 'ready' | 'exported'
  owner_user_id: number
  created_at: string
  updated_at: string
}

export interface StudioEpisode {
  id: number
  project_id: number
  episode_no: number
  act: '起' | '承' | '转' | '合'
  title: string
  scenes: unknown[]
  dialogues: unknown[]
  status: 'draft' | 'generating' | 'complete'
  created_at: string
}

/**
 * Mirrors the ``_VALID_ACTS = {'起', '承', '转', '合'}`` whitelist in
 * ``web_runner/routes/studio.py``. Backend rejects any other value at the
 * `_validate_create_episode_item` boundary with a Chinese 400 — surfacing
 * the literal server error here is preferred (a "Pick one of 起 / 承 /
 * 转 / 合" wording is opt-in via the dropdown, so this type just keeps
 * the picker state narrowly typed).
 *
 * **Derived** from ``StudioEpisode['act']`` — a future spec change
 * (``v0.4 add '伏' act`` for flashback framing, say) flows to both the
 * picker and the read-side type without a parallel literal to keep
 * in sync. The backend's ``sorted(_VALID_ACTS)`` is the definitive
 * ground-truth whitelist; this TS literal is a surface mirror.
 */
export type StudioAct = StudioEpisode['act'] // '起' | '承' | '转' | '合'

/**
 * Body shape for a single item in
 * ``POST /api/studio/projects/<id>/episodes``.
 *
 * Mirrors ``_validate_create_episode_item`` server-side: ``act`` is the
 * only required key; ``title`` is optional and capped at 200 chars; the
 * two JSON-array fields are optional and accept any list-of-dicts (the
 * server canonicalises via ``json.dumps(ensure_ascii=False,
 * separators=(",", ":"))`` — byte-equivalent round-trip per the canvas
 * endpoint's contract).
 */
export interface StudioEpisodeCreateInput {
  title?: string
  act: StudioAct
  scenes_json?: unknown[]
  dialogues_json?: unknown[]
}

export interface StudioAsset {
  id: number
  project_id: number
  kind: 'character' | 'scene' | 'prop'
  code: string
  name: string
  prompt: string
  ref_image_url: string | null
  created_at: string
}

/** Per-action quota slot returned by ``GET /api/usage/quota``.
 *
 * Mirror of the backend ``quotas[<action>]`` envelope in
 * ``web_runner/middleware/usage_metering.py::get_quota``
 * (post round-OPT-MONETIZE-v1). All four fields are required so the
 * StudioDetailPage pill can render without a `?? 0` fallback — a
 * contract regression here would surface as a TS type error at the
 * useQuery site rather than silent-zero render rot.
 *
 *   * ``limit``      -1 (unlimited) | 0 (tier-blocked) | N (limit)
 *   * ``used``       today's row count in ``usage_logs``
 *   * ``remaining``  max(0, limit - used) | -1 when unlimited
 *   * ``resets_at``  ISO UTC midnight | null when unlimited/tier-blocked
 *   * ``is_unlimited`` limit == -1
 *   * ``can_upgrade``  true ↔ free-tier at-limit (Studio) / always-blocked (AI)
 *   * ``required_tier`` "pro" | null
 */
export interface StudioQuotaSlot {
  limit: number
  used: number
  remaining: number
  resets_at: string | null
  is_unlimited: boolean
  can_upgrade: boolean
  required_tier: string | null
}

/** Top-level envelope of ``GET /api/usage/quota``. */
export interface StudioQuotaEnvelope {
  tier: 'free' | 'pro' | 'legacy'
  quotas: {
    publish: StudioQuotaSlot
    ai_generate: StudioQuotaSlot
    accounts: StudioQuotaSlot
    studio_render: StudioQuotaSlot
  }
}

export interface StudioApiEnvelope<T> {
  success: boolean
  data: T
  message?: string
}

export const studioApi = {
  listProjects() {
    return request
      .get<StudioApiEnvelope<StudioProject[]>>('/api/studio/projects')
      .then((r) => r.data)
  },
  createProject(input: { title: string; synopsis: string; style?: string | null }) {
    return request
      .post<StudioApiEnvelope<StudioProject>>('/api/studio/projects', input)
      .then((r) => r.data)
  },
  updateProject(
    id: number,
    input: { title?: string; synopsis?: string; style?: string | null },
  ) {
    return request
      .patch<StudioApiEnvelope<StudioProject>>(`/api/studio/projects/${id}`, input)
      .then((r) => r.data)
  },
  getProject(id: number) {
    return request
      .get<
        StudioApiEnvelope<
          StudioProject & { episodes: StudioEpisode[]; assets: StudioAsset[] }
        >
      >(`/api/studio/projects/${id}`)
      .then((r) => r.data)
  },
  deleteProject(id: number) {
    return request
      .delete<StudioApiEnvelope<{ id: number }>>(`/api/studio/projects/${id}`)
      .then((r) => r.data)
  },
  renderProject(id: number) {
    return request
      .post<StudioApiEnvelope<{
        url: string
        captions_ass: string
        captions_srt: string
        duration: number
        width: number
        height: number
      }>>(`/api/studio/projects/${id}/render`)
      .then((r) => r.data)
  },
  /**
   * POST /api/studio/projects/<id>/episodes — append one or more
   * episodes to a project. Accepts EITHER a single item OR a
   * list-of-items (the canonical 「起/承/转/合」 mass-insert path
   * for `_resolve_scene_videos` to pick up). Server auto-assigns
   * ``episode_no`` at append time (``COALESCE(MAX(episode_no), 0)
   * + i + 1``) inside ``with db.transaction() as tx:`` so
   * concurrent appends cannot race past each other's MAX reads
   * and the inserted set is atomic.
   *
   * Mirrors the single-shipped surface from
   * ``web_runner.routes.studio.create_project_episodes`` (post
   * ``round-OPT-T2-follow-up``). Validation errors short-circuit
   * the entire batch — no partial-write surprises.
   *
   * Returns ``{ success, data: [StudioEpisode, ...] }`` so the
   * caller can either invalidates-queries (most callers) or
   * optimistically merges the returned IDs into a local cache
   * (future v0.2 streaming paths will).
   */
  appendEpisodes(
    projectId: number,
    input: StudioEpisodeCreateInput | StudioEpisodeCreateInput[],
  ) {
    return request
      .post<StudioApiEnvelope<StudioEpisode[]>>(
        `/api/studio/projects/${projectId}/episodes`,
        input,
      )
      .then((r) => r.data)
  },

  /**
   * GET /api/studio/tts/health — surfaces edge-tts CLI availability
   * so StudioDetailPage can render the warning pill beside the
   * "渲染成片" button. The route is auth-gated like every other
   * studio endpoint, but cost is one `shutil.which` syscall so
   * polling on every page mount is fine.
   *
   * Pairs with the silent-degrade helper in
   * `web_runner.routes.studio._resolve_scene_voiceovers`: when
   * `available === false`, the next render will produce an MP4
   * WITHOUT the voiceover track and the operator gets the pill
   * explanation instead of a mystery-silent video.
   *
   * `staleTime: 5 * 60 * 1000` on the useQuery side keeps the
   * round-trip cheap — voice id only changes with a restart, not
   * mid-session.
   *
   * Discriminated union (round-2 review fix): `reason` is
   * NON-OPTIONAL under ``available === false`` so the JSX can
   * read ``ttsHealth.data.reason`` without a `??` fallback. The
   * backend guarantees ``reason === '未安装 edge-tts CLI'``
   * (populated in the route when ``available=False``), so the
   * optional ``?`` on the TS type would have produced
   * "配音暂不可用:undefined" if a future round breaks that
   * contract. Discriminated union is the shape that lets TS
   * narrow ``reason`` to ``string`` after `!available`. Read it
   * directly to surface contract regressions loudly through
   * "undefined" appearing in the rendered pill instead of silent
   * fallback rot.
   */
  ttsHealth() {
    return request
      .get<
        StudioApiEnvelope<
          | {
              available: true
              voice: string
              default_voice: string
              install_hint: string
            }
          | {
              available: false
              voice: string
              default_voice: string
              install_hint: string
              reason: string
            }
        >
      >('/api/studio/tts/health')
      .then((r) => r.data)
  },

  /**
   * GET /api/usage/quota — daily per-action counters for the
   * current user. Powers ``StudioRenderQuotaPill`` at the top of
   * /dashboard/studio/:id so the "今日已渲染 N / M 次" pill
   * mirrors the live `used/limit` from the DB without a render
   * round-trip.
   *
   * Round-OPT-MONETIZE-v1: the `quotas.studio_render` slot is the
   * soft-paywall surface — `can_upgrade: true` is the discriminator
   * that triggers ``StudioUpsellModal``. Pro tier at-limit (50/50)
   * surfaces `can_upgrade: false` (no enterprise upsell, the
   * honest answer is "wait until tomorrow").
   *
   * Cost: one SELECT per ``studio_render`` slot via
   * ``usage_logs`` + one SELECT per ``accounts`` slot (current
   * count, not daily). Cache for 60 s — the per-user
   * quota-can_upgrade flag flips at UTC midnight, which is far
   * outside the staleness window for a UI badge.
   */
  getQuota() {
    return request
      .get<StudioApiEnvelope<StudioQuotaEnvelope>>('/api/usage/quota')
      .then((r) => r.data)
  },

  /**
   * POST /api/studio/projects/<id>/generate — AI 生成四幕分集。
   *
   * 这是一个 SSE 端点，调用方应使用 `readSSEStream` 直接消费流。
   * 流结束后，后端会自动把生成的 episodes 写入 DB。
   *
   * Example:
   * ```ts
   * const url = studioApi.generateEpisodes(projectId)
   * await readSSEStream(url, {}, {
   *   onChunk: (text) => setProgress(text),
   *   onGenerationDone: () => queryClient.invalidateQueries(...),
   *   onError: (msg) => toast.error(msg),
   * })
   * ```
   */
  generateEpisodes(projectId: number) {
    return `${baseURL}/api/studio/projects/${projectId}/generate`
  },

  /**
   * GET /api/studio/projects/<id>/episodes/<no>/export — Seedance 2.0
   * markdown export for ONE episode. Returns the markdown body as a
   * Blob with `text/markdown` MIME so the caller can either:
   *   * `.text()` the blob → copy to clipboard
   *   * `URL.createObjectURL(blob)` → save as `<title>.md`
   *
   * Backend (round-OPT-seedance-export) builds a byte-exact mirror
   * of the open-source `liangdabiao/Seedance2-Storyboard-Generator`
   * template so the operator can paste the markdown directly into
   * Seedance 2.0's prompt input without reformatting.
   */
  exportEpisodeText(projectId: number, episodeNo: number) {
    return request
      .get<string>(
        `/api/studio/projects/${projectId}/episodes/${episodeNo}/export`,
        { responseType: 'text', transformResponse: [(d) => d] },
      )
      .then((r) => r.data)
  },
  exportEpisode(projectId: number, episodeNo: number) {
    return request
      .get<Blob>(
        `/api/studio/projects/${projectId}/episodes/${episodeNo}/export`,
        { responseType: 'blob' },
      )
      .then((r) => r.data)
  },

  /**
   * GET /api/studio/projects/<id>/export — whole-project zip export.
   * Server emits `_剧本.md` + per-episode `E0X_<title>_分镜.md`
   * inside an in-memory zip (Python `zipfile.ZipFile`; no on-disk
   * residue). Returns Blob with `application/zip` MIME.
   */
  exportProject(projectId: number) {
    return request
      .get<Blob>(
        `/api/studio/projects/${projectId}/export`,
        { responseType: 'blob' },
      )
      .then((r) => r.data)
  },
}
