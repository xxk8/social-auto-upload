# YouTube Web Shell SSE Bridge — Protocol Contract

> Stage 1b SSE event protocol for the Web Shell ↔ headed-Chrome ↔ backend login bridge after the YouTube interactive path shipped in PR-A + PR-B. Read this before adding a new platform to `INTERACTIVE_LOGIN_PLATFORMS`, before changing an event name, or before extending `LoginProgressModal.tsx` with new SSE-handler surface.

## Why this exists

Stage 1a closed the CLI / Skill split for the YouTube login flow (verified at 8-platform end-to-end), but the Web Shell was still driving YouTube through its QR-mocked single-slot pipeline (`web_runner/routes/accounts.py::_run_login` original branch consumed `qrcode_callback` for every platform). YouTube doesn't expose a QR sign-in path on its web OAuth — it requires a headed Chromium + operator-driven Google-account + 2FA interaction — so the QR slot was a dead end for the Web Shell user.

TBF-032 split the workaround into four sub-PRs:

- **PR-A (shipped)** — `web_runner/utils.py::_INTERACTIVE_LOGIN_PLATFORMS = {"youtube"}` registry + `_run_login` per-platform dispatch branch that pushes `event: headed_chrome_ready` before calling `cli/platforms/youtube.py:login` with `headless=False`.
- **PR-B (shipped)** — `sau_web/frontend/src/api/types.ts::INTERACTIVE_LOGIN_PLATFORMS` + `isInteractivePlatform` predicate + `LoginProgressModal.tsx` 3-branch render (QR / interactive / manual CLI fallback) that consumes the protocol.
- **PR-C (open)** — `uploader/youtube_uploader/main.py::youtube_cookie_gen` audit for the `progress_callback` injection point — no consumer change; just confirm the polled-state-to-event translation is sufficient so the SSE `progress` event can fan out without splitting the CLI signature.
- **PR-D (this doc)** — single-source-of-truth for the SSE event contract so the next contributor can wire a new platform (Google OAuth internal, or any future headed-Chrome flow) without re-deriving the protocol from code archaeology.

This doc is the SSOT for all four events, payloads, family routing, and the cross-section mirror invariant. If you change an event name, a payload field, or the dispatch branch, this doc must change in the same PR.

## Prereqs

- Read Stage 1a + Stage 1b PR-A retrospective (don't need to read all of `docs/dev/VALUE-STRATEGY.md` — the §3.2.2 TBF-032 decision summary is enough).
- Read `web_runner/routes/accounts.py::_run_login` end-to-end once (it's ~120 lines; event producer).
- Read `sau_web/frontend/src/Components/LoginProgressModal.tsx` 3-branch render block (event consumer; keyed off `currentStep.key === 'scan_qr'` for QR / `currentStep.key === 'switch_to_browser'` for interactive).
- Have a real Chrome instance available — `patchright install chromium` from the repo root, since the headed-Chrome path requires the Chromium browser binary (not just the headless-shell variant).

## SSE endpoint anatomy

The bridge exposes exactly one SSE endpoint, served by `web_runner/routes/accounts.py::login_account_sse`:

```
GET /api/accounts/login/sse
  ?platform={douyin|kuaishou|xiaohongshu|tencent|bilibili|tiktok|baijiahao|youtube|...}
  &account={account_name_cookies_filename_stem}
  &headless={true|false}     # ignored for interactive platforms (always runs headed)
  Cookie: sau_session=...    # when SAU_AUTH_ENABLED=true (production)
  Authorization: Bearer ...  # optional alternative; sse_token query param also accepted
```

Response is `text/event-stream` with the canonical SSE padding (`: <4096 spaces>\n\n`) to defeat nginx-buffer-on-keep-alive quirks, then a stream of `event: <name>` `data: <json>` pairs until the producer thread exits.

**Auth skip**: `SAU_MOCK_AUTHORIZE=true` env var returns a synthetic SVG-as-data-URL `qrcode` event for QR platforms or a `Platform requires CLI login` `error` event for non-QR platforms. Useful for manual browser testing without spinning up the headed Chromium — *do NOT enable in production*.

## Event taxonomy

The backend producer (`_run_login`) pushes events into a `queue.Queue`; the SSE generator in `login_account_sse` blocks 2s on `q.get(timeout=2)` and yields `: ping\ndata: {ts: ...}` heartbeats while the worker thread is still alive or the queue is non-empty.

**Heartbeat rationale**: nginx's `proxy_read_timeout` defaults to 60s — a bare `q.get(block=True)` would let an idle SSE connection sit behind the proxy until the proxy kills it. The 2s timeout + `ping` event keeps the proxy buffer warm so the connection survives the operator's 30-60s Google OAuth interaction. Mirror this in `uploader/youtube_uploader/main.py::youtube_cookie_gen` if you ever emit `progress` events on a slower cadence (Stage 1b PR-C).

| Event | Families | Payload shape (`data`) | Producer site | Consumer site |
|---|---|---|---|---|
| `qrcode` | QR only | `{image_path: string, image_data_url: string}` (`image_data_url` is the data-URL form consumed by the `<img>`; `image_path` kept for tooling parity) | `_qrcode_callback()` closure inside `_run_login` | `LoginProgressModal.tsx` QR branch (mounts `<img src={image_data_url}>`) |
| `challenge_detected` | QR + interactive (forward-defense slot — interactive not yet emitted) | `{type: "iframe"\|"geetest"\|"text_fallback"\|other, hint: string, matched_probe: string, timeout_seconds: number}` | `_challenge_callback()` closure inside `_run_login` (currently only Douyin emits; others reserved for the same 1.0 lineage) | `LoginProgressModal.tsx` QR branch (renders 风控挑战 banner) |
| `headed_chrome_ready` | Interactive only | `{platform: string, account: string}` | `_run_login` interactive branch (immediately before `asyncio.run(login_fn(...))`) | `LoginProgressModal.tsx` interactive branch (mounts headed-Chrome guidance surface + sets `currentStepIndex = 2`) |
| `progress` | Interactive (Stage 1b PR-C will define precisely) | TBD per PR-C, expected shape: `{phase: string, index?: number, total?: number, account: string, platform: string}` | `uploader/youtube_uploader/main.py::youtube_cookie_gen` `L.CHANNEL_URL_FRAGMENT` polling tick (PR-C) | `LoginProgressModal.tsx` interactive branch (advance progress bar; minor UX upgrade, not load-bearing) |
| `result` | QR + interactive | `{success: boolean, status?: string (LOGIN_RESULT_STATUSES), message?: string, ...uploader-specific fields}` | `_run_login` after `asyncio.run(login_fn(...))` returns; payload echoes the login-fn dict verbatim | `LoginProgressModal.tsx` `result` handler (advances to verifying → saving → complete, calls `confirmAuthorize`, fires `onComplete`) |
| `error` | QR + interactive (route-level rejection only) | `{message: string}` | `_run_login` validation / unsupported platform path | `LoginProgressModal.tsx` global error banner |
| `ping` | All (`text/event-stream` keep-alive) | `{ts: ISO datetime}` | SSE generator heartbeat | EventSource auto-handles (no JS listener required) |
| `done` | Batch endpoints only (`/api/accounts/refresh-stale`) — NOT the login SSE | `{succeeded: number, failed: number, total: number}` | Batch sweep endpoints | (LoginProgressModal does NOT consume — batch-only) |

> **Naming caveat**: the user-facing shorthand sometimes refers to "`login_progress`"; the actual SSE event name is `progress`. If you grep for either, both should land on this doc.

## Per-family dispatch — what events each platform actually sees

### QR family — 7 platforms

`web_runner/utils.py::_QR_LOGIN_PLATFORMS = {"douyin", "kuaishou", "xiaohongshu", "tencent", "tiktok", "baijiahao"}` (7 entries — 6 base + tencent).

| Event | Observed? |
|---|---|
| `qrcode` | ✅ emitted on every poll cycle until user scans |
| `challenge_detected` | ✅ emitted when `_challenge_callback` triggered (Douyin-only as of Stage 1b; family-wide reserved) |
| `progress` | ❌ not emitted (CLI's polling is local, not SSE-relevant) |
| `result` | ✅ emitted at end of `asyncio.run(login_fn(...))` |
| `error` | ✅ emitted on unsupported platform / route-level rejection |
| `ping` | ✅ every 2s while worker alive |

CLI callsite: `login_fn(account, headless=headless, qrcode_callback=_qrcode_callback, challenge_callback=_challenge_callback)` — both QR + challenge callbacks are wired.

### Interactive family — 1 platform today (YouTube)

`web_runner/utils.py::_INTERACTIVE_LOGIN_PLATFORMS = {"youtube"}` (1 entry; symmetric invariant with the frontend registry `sau_web/frontend/src/api/types.ts::INTERACTIVE_LOGIN_PLATFORMS = ['youtube']`).

| Event | Observed? |
|---|---|
| `qrcode` | ❌ intentionally NOT emitted (YouTube doesn't expose web QR sign-in) |
| `challenge_detected` | forward-defense slot (callback plumbed but no producer currently emits) — Stage 1b PR-C will decide whether to re-introduce 2FA inline detection from `youtube_cookie_gen` |
| `progress` | ❌ not yet emitted (PR-C will add via `progress_callback` injection) |
| `headed_chrome_ready` | ✅ emitted exactly once, immediately before `asyncio.run(login_fn(...))` |
| `result` | ✅ emitted at end of `asyncio.run(login_fn(...))` |
| `error` | ✅ emitted on unsupported platform / route-level rejection |
| `ping` | ✅ every 2s while worker alive |

CLI callsite: `login_fn(account, headless=False, challenge_callback=_challenge_callback)` — `headless=False` is forced (the interactive family requires headed Chromium unconditionally), `qrcode_callback` is intentionally NOT passed (Stage 1a deleted it from `cli/platforms/youtube.py:login`).

### Forbidden platforms

Any platform not in `(_QR_LOGIN_PLATFORMS ∪ _INTERACTIVE_LOGIN_PLATFORMS)` returns a 400 envelope immediately, NEVER opens an SSE stream:

```json
{
  "success": false,
  "message": "Platform {platform} does not support Web-Shell login. Please use CLI: sau {platform} login --account {account}"
}
```

This is enforced at line 327 of `web_runner/routes/accounts.py::login_account_sse`. The frontend's `LoginProgressModal` falls through to the manual CLI branch (`<CliCommandBlock>` + verify button) when this 400 fires.

## Cross-section mirror invariant — READ THIS before adding a new platform

Three registries MUST stay in lockstep:

| Layer | Registry | Location |
|---|---|---|
| Backend (Python) | `_INTERACTIVE_LOGIN_PLATFORMS` | `web_runner/utils.py` |
| Backend dispatch map | `_LOGIN_FN_MAP` inside `_run_login` | `web_runner/routes/accounts.py::_run_login` (closure-local to `_run_login`, line ~403) |
| Frontend (TypeScript) | `INTERACTIVE_LOGIN_PLATFORMS` + `isInteractivePlatform` | `sau_web/frontend/src/api/types.ts` (re-exported via `api/client.ts` barrel) |

**Symmetric invariant**: every CLI login-capable platform lives in **exactly one** of `_QR_LOGIN_PLATFORMS` or `_INTERACTIVE_LOGIN_PLATFORMS` (Python) / `QR_LOGIN_PLATFORMS` or `INTERACTIVE_LOGIN_PLATFORMS` (TypeScript). A future ticket that adds a 9th platform (e.g. Google OAuth internal, generic Twitter embedded browser) MUST update all four registries in the same PR.

Forward-defense diagnosis — if a frontend consumer renders the QR branch for a platform that the backend routed as interactive (or vice-versa), the symptom is "operator sees '扫码登录' but nothing happens"; the cause is one of: (1) frontend `INTERACTIVE_LOGIN_PLATFORMS` is missing the new entry, (2) backend `_INTERACTIVE_LOGIN_PLATFORMS` is missing the new entry, (3) frontend `INTERACTIVE_LOGIN_PLATFORMS` has the entry but `isInteractivePlatform` predicate short-circuits to false (typo / wrong key name). Grep `isInteractivePlatform\(` and `INTERACTIVE_LOGIN_PLATFORMS` cross-section to find the drift source.

## Stage 1b tracked changes (PR-A → PR-D)

| PR | File touched | Contract delta |
|---|---|---|
| **PR-A** | `web_runner/utils.py` (`_INTERACTIVE_LOGIN_PLATFORMS`) | Backend registry seeded with `{"youtube"}` — opens the family |
| **PR-A** | `web_runner/routes/accounts.py::_run_login` | Per-platform dispatch branch added; `_LOGIN_FN_MAP` gains `youtube` entry; `headed_chrome_ready` push site added |
| **PR-A** | `cli/platforms/youtube.py::login` | Signature widened to `(account_name, headless=True, challenge_callback=None)`; `headless=False` honored on the way in; `qrcode_callback` deliberately NOT re-added |
| **PR-B** | `sau_web/frontend/src/api/types.ts` | `INTERACTIVE_LOGIN_PLATFORMS: readonly string[]` + `isInteractivePlatform(p)` predicate |
| **PR-B** | `sau_web/frontend/src/api/client.ts` | Barrel re-export of `INTERACTIVE_LOGIN_PLATFORMS, isInteractivePlatform` |
| **PR-B** | `sau_web/frontend/src/Components/LoginProgressModal.tsx` | 3-branch render (QR / interactive / manual); `STEPS_FOR_PLATFORM` selector; `INTERACTIVE_STEPS` array; `headed_chrome_ready` `addEventListener` consumer |
| **PR-B** | `sau_web/frontend/src/locales/{zh-CN,en-US}.json` | `accounts.login.interactive_browser_handoff.{title, guidance_l{1,2,3}, cta_label, status_label, timeout_label}` (7 keys per locale) |
| **PR-B** | `sau_web/frontend/src/Components/LoginProgressModal.test.tsx` | 3 vitest specs (FakeEventSource double) — mount on event / don't mount before event / don't mount QR `<img>` for interactive |
| **PR-D** | `docs/dev/youtube-web-bridge.md` (this doc) | SSOT for events · payload · family routing · mirror invariant |

## Future PR-C slot

The `progress` event entry in the taxonomy above is **reserved**, not implemented. PR-C will resolve:

1. **Audit `uploader/youtube_uploader/main.py::youtube_cookie_gen` line 39-71** — confirm the existing `L.CHANNEL_URL_FRAGMENT` polling loop exposes a safe `progress_callback(state)` injection point at the 1-second tick boundary (`asyncio.sleep(1)`).
2. **Decide API surface**: keep the single-call `youtube.py:login` signature (Stage 1b PR-A decision 4 in §3.2.2) and translate polling-state into SSE `progress` events from `_run_login`'s side of the integration layer, OR split the CLI signature into `start_youtube_login` + `verify_youtube_login` two-phase. The first option is preferred (CLI compatibility) — second is the fallback if `youtube_cookie_gen`'s internal polling is too tightly coupled to its CLI invocation pattern to expose a callback cleanly.
3. **Heartbeat + heartbeat-on-idle guard**: per §3.2.2 decision 4, "long idle phases" (N consecutive 1-second `asyncio.sleep` ticks with no state change) must emit `ping` events faster than 2s to keep the nginx proxy buffer warm. Default N=30 (was N=1 before Stage 1a polish to the polling wrap); document the chosen `N` in the heartbeat section after PR-C lands.

If PR-C chooses the first option, the SSE event taxonomy table in this doc gains a 6th consumer-side entry (`LoginProgressModal.tsx` named step with `progress` listener) without any backend signature change. If PR-C chooses the second option, this doc grows a "split-CLI signature" §appendix backward-compatibility section.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Modal hangs forever after "请切换 headed Chrome" | Backend never pushed `result`; `youtube.py:login` blocked in `L.CHANNEL_URL_FRAGMENT` polling forever | Check `.sau-logs/backend.log` for `[youtube_cookie_gen]` polling progression; if `heart_beat` stopped firing, the SSE connection is dead — re-launch authorization from the Web Shell |
| Operator gets `qrcode` event JSON parse error on the QR branch | SSE generator emitted a `qrcode` event whose `image_data_url` is malformed (rare; usually a Douyin edge case where the platform's QR endpoint returned an empty body) | Check `_qrcode_callback` invocation site in `uploader/douyin_uploader/main.py`; add an empty-payload guard if missing — most likely pre-existing TBF-NNN work |
| Modal closes before `result` (operator sees no "授权完成" toast, but the cookie IS saved on disk) | The `result` event arrived after the 5-min safety timeout already fired — stale-ES interaction from React StrictMode double-mount running `result` handler on a ref-cleared ES. Check `eventSourceRef.current === eventSource` guard sequence | Audit `LoginProgressModal.tsx` `result` handler stale-ES guard — must close the stale ES before any state write |
| `error` event fires immediately on a fresh authorization | Platform is in neither registry — verify `isInteractivePlatform(platform)` returns true on the frontend; if frontend says false, the platform wasn't added to `sau_web/frontend/src/api/types.ts::INTERACTIVE_LOGIN_PLATFORMS` for this PR | Add to both registries symmetrically per invariant |
| `headed_chrome_ready` fires but headed-Chrome surface doesn't render | React class failure on `motion.div` `key="headed-chrome-section"` re-entering after `t.goToStep(2)` — usually a stale React state reference holding onto `qrCodeUrl` from a prior render cycle | All-clear; the surface mounts on the next render cycle — but if the issue persists, file a follow-up TBF-NNN with reproduction steps |

## Cross-references

- **Source-of-truth dispatcher**: `web_runner/routes/accounts.py::_run_login` (lines 395-470 — closure def + dispatch branch).
- **Backend registry**: `web_runner/utils.py::_INTERACTIVE_LOGIN_PLATFORMS` (line ~882) and `_QR_LOGIN_PLATFORMS` (line ~880) — symmetric invariant per platform add.
- **Backend `_LOGIN_FN_MAP`** (closure-local): `web_runner/routes/accounts.py::_run_login` closure def, line ~403.
- **CLI signature**: `cli/platforms/youtube.py::login` (signature `(account_name, headless=True, challenge_callback=None)`; `qrcode_callback` deliberately absent).
- **Frontend registry**: `sau_web/frontend/src/api/types.ts::INTERACTIVE_LOGIN_PLATFORMS` (line ~73) and `isInteractivePlatform` predicate (line ~95).
- **Frontend consumer**: `sau_web/frontend/src/Components/LoginProgressModal.tsx::addEventListener('headed_chrome_ready', ...)` (~line 308).
- **Stage 1b decision narrative**: `docs/dev/VALUE-STRATEGY.md` §3.2.2 — TBF-032 splits into 4 sub-PRs; PR-A + PR-B + PR-D shipped; PR-C open.
- **TBF-032 ticket**: `docs/bug-tickets/test-app-bugfix-tickets-2026q3.md` — design rationale + 4-PR split + open-question list.
- **Vitest spec (render surface)**: `sau_web/frontend/src/Components/LoginProgressModal.test.tsx` — 3 tests pinning the `headed_chrome_ready` event handler's UI mount surface.
- **i18n bundle**: `sau_web/frontend/src/locales/{zh-CN.en-US}.json` under `accounts.login.interactive_browser_handoff.*` — 7 keys per locale.
- **Heartbeat rationale**: §3.2.2 TBF-032 decision 4 (N=30 below nginx `proxy_read_timeout 60s`).
- **Hub**: [docs/dev/INDEX.md#contributors](docs/dev/INDEX.md#contributors) — Contributors (writing code, merging PRs).

> **Discoverability for future contributors**: this doc sits in the **Contributors** audience row of `docs/dev/INDEX.md`, NOT in **Onboarding** (PR-A + PR-B + PR-D are already in the codebase; the doc is targeted at future contributors adding platforms, not first-week readers). Stage 1b PR-C lands will retain this doc as the SSOT — if PR-C introduces the `progress` event, update the Event taxonomy table row inline rather than duplicating into a sibling doc.
