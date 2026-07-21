## ADDED Requirements

> **Backfill scope (round-AI-paywall-v1 + v2)**: this file is the single source-of-truth for the metering-layer **enforcement contract** — daily-quota middleware, AI tier-block, AI utility-paths skip, 402 envelope shape, `/api/usage/quota` structured response, env-var override, tier classification, and auth-disabled bypass.
>
> **Test coverage status (round-AI-paywall-v2 snapshot)**: 19 of the 32 Scenarios below are pinned by 20 dedicated test cases in `tests/test_ai_tier_block.py`. The remaining 13 Scenarios are forward-looking contract — they will be pinned by future test PRs but currently rely on inline-code-level guarantees.
>
> **Out of scope for this backfill** (will be backfilled into the corresponding sibling stubs per the `docs/dev/INDEX.md §6` ratchet process — none of which is currently ratified):
> - `usage_logs` table schema + log-after-success call-site contract
> - `check_account_quota()` current-count check (not daily)
> - Frontend `QuotaIndicator` / `QuotaBanner` / `QuotaCheckDialog` UX contract
> - `inbox` action daily-quota contract (R1 covers the middleware wiring; the inbox-specific log/counter contract is a future spec)
> - `log_action(uid, action)` public helper call-site contract
>
> The pre-migration R1-R5 prose from this stub's archived code block is preserved in this file's git history (commit pre-ratchet); not duplicated inline here to avoid scope drift.

### Requirement: Per-action daily quota enforcement (metering)

The `before_request` middleware in `web_runner/middleware/usage_metering.py::register_usage_middleware` MUST enforce daily per-action usage caps for the three metered action classes (`publish` · `ai_generate` · `inbox`) plus the account-count quota (a current-count check, not daily). On `used >= limit` the middleware MUST return HTTP 429 with a `quota_exceeded` envelope.

#### Scenario: Daily quota exceeded → 429 quota_exceeded

- **WHEN** a non-utility path under `/api/upload/`, `/api/ai/`, or `/api/inbox/` is requested AND the user's `_count_actions(user_id, action)` since today UTC midnight is `>= TIER_LIMITS[user_tier][action]`
- **THEN** the middleware MUST return HTTP **429** with body `{ "success": false, "error": "quota_exceeded", "action": <action>, "limit": <n>, "used": <n>, "reset_at": <tomorrow UTC ISO>, "message": "已达到今日{action}配额上限 ({n}次)，升级 Pro 解锁无限额度" }`
- **AND** the request MUST NOT reach the route handler

#### Scenario: Unlimited tier (limit == -1) bypasses daily check

- **WHEN** the user's tier is `pro` or `legacy` (where `TIER_LIMITS[<tier>][action] == -1`) AND they hit any metered path
- **THEN** the middleware MUST skip the daily-quota check and pass through to the route handler

#### Scenario: SSE and progress endpoints are skipped

- **WHEN** the request path contains `/sse` or `/progress` (e.g. `/api/ai/generate/stream` response body delivery)
- **THEN** the middleware MUST short-circuit and return `None` BEFORE consulting the daily counter (streaming responses are not discrete countable actions)

### Requirement: AI tier-block for free tier (round-AI-paywall-v1)

For the nine user-facing AI paths in `_AI_FEATURE_BLOCKED_FOR_FREE`, the middleware MUST short-circuit a free-tier caller with an HTTP 402 + Stripe-style `tier_required` envelope BEFORE the daily-quota check fires. Pro and legacy tiers pass through unchanged. The nine paths are the canonical source-of-truth; the middleware MUST re-read them at every request (no module-level cache).

#### Scenario: free-tier POST /api/ai/generate → 402

- **WHEN** `tier == "free"` AND `path.rstrip("/") == "/api/ai/generate"`
- **THEN** the middleware MUST return HTTP **402** with `_tier_blocked_response("/api/ai/generate")` AND the route handler MUST NOT run

#### Scenario: free-tier POST /api/ai/generate/stream → 402 BEFORE SSE generator

- **WHEN** `tier == "free"` AND `path == "/api/ai/generate/stream"`
- **THEN** the middleware MUST return HTTP **402** with `Content-Type` ≠ `text/event-stream` AND body envelope `error: "tier_required"`, `blocked_action: "generate-stream"`
- **AND** the SSE generator MUST NOT have started (otherwise the user would see a 200 stream header with a 402-shaped first event — visually indistinguishable from a successful stream)

#### Scenario: free-tier POST /api/ai/generate/multi-platform → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/generate/multi-platform"`
- **THEN** HTTP **402** with `blocked_action: "generate-multi-platform"`

#### Scenario: free-tier POST /api/ai/generate/variants → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/generate/variants"`
- **THEN** HTTP **402** with `blocked_action: "generate-variants"`

#### Scenario: free-tier POST /api/ai/enhance-prompt → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/enhance-prompt"`
- **THEN** HTTP **402** with `blocked_action: "enhance-prompt"`

#### Scenario: free-tier POST /api/ai/search → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/search"`
- **THEN** HTTP **402** with `blocked_action: "search"`

#### Scenario: free-tier POST /api/ai/images/search → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/images/search"`
- **THEN** HTTP **402** with `blocked_action: "images-search"`

#### Scenario: free-tier POST /api/ai/recommend-images → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/recommend-images"`
- **THEN** HTTP **402** with `blocked_action: "recommend-images"`

#### Scenario: free-tier GET /api/ai/images/fetch → 402

- **WHEN** `tier == "free"` AND `path == "/api/ai/images/fetch"`
- **THEN** HTTP **402** with `blocked_action: "images-fetch"`

#### Scenario: pro / legacy tier bypasses the AI tier-block entirely

- **WHEN** `tier ∈ {"pro", "legacy"}` AND any of the nine blocked paths is hit
- **THEN** `_is_path_ai_blocked_for_tier(path, tier)` MUST return `False` AND the request MUST pass through (any non-402 downstream status is acceptable; only the 402 is forbidden)

### Requirement: AI utility-paths skip (round-AI-paywall-v2)

The three utility endpoint prefixes in `_AI_UTILITY_PATH_PREFIXES` MUST be skipped in the middleware BEFORE the per-action daily-quota check fires, so that `TIER_LIMITS["free"]["ai_generate"] = 0` (the bypass sentinel) does not regress free-tier access to model-picker / sidebar-status / key-list reads. The skip is purely a metering-layer short-circuit; admin authz on writes (POST/DELETE on `/api/ai/config`, POST on `/api/ai/keys/batch`) is enforced inline at the route handler via `session['role']` and is NOT weakened by this skip.

#### Scenario: free-tier GET /api/ai/models → 200 (utility)

- **WHEN** `tier == "free"` AND `path == "/api/ai/models"`
- **THEN** the middleware MUST return `None` (skip) AND the route handler MUST return 200 with `{success: true, data: <model list>}` — never 402, never 429

#### Scenario: free-tier GET /api/ai/config → 200 (utility)

- **WHEN** `tier == "free"` AND `path == "/api/ai/config"`
- **THEN** the middleware MUST return `None` AND the route handler MUST return 200 with `{success: true, data: {configured, key_count}}` — never 402, never 429

#### Scenario: free-tier GET /api/ai/keys → 200 (utility)

- **WHEN** `tier == "free"` AND `path == "/api/ai/keys"` (or any sub-path like `/api/ai/keys/batch`)
- **THEN** the middleware MUST return `None` AND the route handler MUST run (admin authz fires inline; non-admin gets 403, admin gets 200)

#### Scenario: utility-paths skip is prefix-match (not exact match)

- **WHEN** a path starts with one of `_AI_UTILITY_PATH_PREFIXES` (e.g. `/api/ai/keys/batch`)
- **THEN** the prefix-match skip MUST fire, regardless of the HTTP method

#### Scenario: utility-skip is checked BEFORE daily-quota lookup

- **WHEN** the user is on a utility path AND the bypass-sentinel `TIER_LIMITS["free"]["ai_generate"] = 0` is in effect
- **THEN** the middleware MUST NOT read `quotas["ai_generate"]` (which would otherwise return 429 due to `used >= 0`); the prefix-skip short-circuits FIRST

### Requirement: 402 tier_required envelope shape (Stripe-style)

The 402 response from `register_usage_middleware` MUST follow the Stripe-ecosystem convention: an `error: "tier_required"` discriminator that axios clients can branch on with one if/else. The envelope is identical to the existing `quota_exceeded` shape plus three tier-block extensions (`code` · `required_tier` · `upgrade_url`).

#### Scenario: 402 response body is exactly this shape

- **WHEN** the AI tier-block fires
- **THEN** the response body MUST equal:

  ```json
  {
    "success": false,
    "error": "tier_required",
    "code": "AI_TIER_REQUIRED",
    "required_tier": "pro",
    "blocked_action": "<path-derived-slug>",
    "message": "AI 功能仅向专业版及以上用户开放。升级专业版解锁 AI 内容生成、图片素材搜索等所有 AI 能力。",
    "upgrade_url": "/pricing?from=ai",
    "action": "ai_generate"
  }
  ```
- **AND** `blocked_action` MUST be derived by stripping the `/api/ai/` prefix, replacing `/` and `_` with `-` — e.g. `/api/ai/images/search` → `images-search`, `/api/ai/enhance-prompt` → `enhance-prompt`

#### Scenario: trailing-slash tolerance

- **WHEN** the request path is `/api/ai/generate/` (trailing slash) instead of `/api/ai/generate`
- **THEN** `_is_path_ai_blocked_for_tier` MUST still return `True` (the `rstrip("/")` normalization catches curl variants and proxy rewrites)

### Requirement: /api/usage/quota structured response

The `GET /api/usage/quota` endpoint MUST return a structured envelope per action that combines a **metering group** (daily-counter semantics) AND a **tier-classification group** (tier-block signals). React's `<TierBlockGate>` reads this WITHOUT first issuing a guarded `/api/ai/*` call, so the tier-classification fields are NOT redundant with the metering fields — they answer different questions ("can I still do this?" vs "should I show the upgrade CTA?").

#### Scenario: free-tier `ai_generate` entry shows tier-block + zero quota

- **WHEN** `tier == "free"` calls `GET /api/usage/quota`
- **THEN** `data.quotas.ai_generate` MUST equal `{limit: 0, used: 0, remaining: 0, resets_at: null, is_unlimited: false, can_upgrade: true, required_tier: "pro"}` — the `limit: 0` (NOT -1) is a deliberate sentinel that signals "tier-blocked, not unlimited"

#### Scenario: pro-tier `ai_generate` entry is unlimited

- **WHEN** `tier == "pro"` calls `GET /api/usage/quota`
- **THEN** `data.quotas.ai_generate` MUST equal `{limit: -1, used: 0, remaining: -1, resets_at: null, is_unlimited: true, can_upgrade: false, required_tier: null}`

#### Scenario: legacy-tier `ai_generate` entry is unlimited (grandfathered)

- **WHEN** `tier == "legacy"` calls `GET /api/usage/quota`
- **THEN** `data.quotas.ai_generate` MUST equal the same unlimited shape as pro

#### Scenario: free-tier `publish` entry is NOT tier-blocked

- **WHEN** `tier == "free"` calls `GET /api/usage/quota`
- **THEN** `data.quotas.publish` MUST show `can_upgrade: false` AND `required_tier: null` (publish is daily-metered, not tier-blocked — the AI paywall MUST NOT bleed into publish metering)

#### Scenario: unauthenticated request returns unlimited

- **WHEN** `SAU_AUTH_ENABLED == false` (dev mode) AND a request hits `/api/usage/quota`
- **THEN** the response MUST be 200 with all quotas `{limit: -1, used: 0, remaining: -1}` (auth-disabled bypasses both auth and tier-block)

#### Scenario: top-level `tier` field

- **WHEN** any request hits `/api/usage/quota` (authenticated)
- **THEN** the response MUST include a top-level `data.tier` string equal to one of `"free"` / `"pro"` / `"legacy"`

### Requirement: Env-var override for tier limits

Per-action free-tier limits MUST be overridable via `SAU_TIER_FREE_<ACTION>` env vars. The `SAU_TIER_FREE_AI` default is `0` (post round-AI-paywall-v2) as a grep-friendly "bypassed" signal — NOT as a "free tier gets 0 daily AI calls" semantic. Operators who want to revive a daily AI quota for free users MUST edit `_AI_FEATURE_BLOCKED_FOR_FREE` AND `_AI_UTILITY_PATH_PREFIXES`; raising `SAU_TIER_FREE_AI` alone does NOT restore the quota (the 402-tier-block and the utility-skip both short-circuit before the cell is ever read).

#### Scenario: env-var override for non-AI actions

- **WHEN** the operator sets `SAU_TIER_FREE_PUBLISH=20` (or any non-negative int)
- **THEN** `TIER_LIMITS["free"]["publish"]` MUST equal `int(os.environ.get("SAU_TIER_FREE_PUBLISH", "5"))` = 20

#### Scenario: `SAU_TIER_FREE_AI` default is `0` (bypass sentinel)

- **WHEN** the operator does NOT set `SAU_TIER_FREE_AI`
- **THEN** `TIER_LIMITS["free"]["ai_generate"]` MUST equal `0` — the visual signal that this cell is bypassed for user-facing AI (R2) AND never read for utility AI (R3). A grep for `SAU_TIER_FREE_AI=` MUST surface this bypass semantics immediately.

#### Scenario: env-var override for AI action is registered but ineffective under R2/R3

- **WHEN** the operator sets `SAU_TIER_FREE_AI=42`
- **THEN** `TIER_LIMITS["free"]["ai_generate"]` MUST equal 42
- **AND** the cell is still effectively dead code: the 9 blocked paths (R2) fire 402 first, AND the 3 utility paths (R3) skip before the lookup. A future reader MUST understand that flipping this value back to a positive number does NOT restore a daily AI quota for free users.

### Requirement: Tier classification from `users.license_tier`

`_get_user_tier(user_id)` MUST read `users.license_tier` from the DB. The default for a missing or empty `license_tier` MUST be `"legacy"` (so pre-existing accounts grandfathered at legacy retain their original unlimited access).

#### Scenario: license_tier read from DB on every request

- **WHEN** any metering decision fires
- **THEN** the middleware MUST call `_get_user_tier(user_id)` to read `users.license_tier` — no in-memory cache, no session-stored tier (a test changing the DB row in a request's middle MUST affect subsequent requests in the same session)

#### Scenario: missing/empty license_tier defaults to "legacy"

- **WHEN** a user row exists but `users.license_tier` is `NULL` or empty string
- **THEN** `_get_user_tier(user_id)` MUST return `"legacy"` AND the metering layer MUST treat them as unlimited (matching R1's unlimited-bypass)

### Requirement: Auth-disabled bypass (dev-mode semantics)

When `SAU_AUTH_ENABLED == false`, the metering layer MUST short-circuit without consulting the tier table. This is intentional dev-mode semantics: a self-hosted local install without email-code auth gets the same access as a pro user.

#### Scenario: SAU_AUTH_ENABLED=false bypasses auth + tier-block

- **WHEN** `SAU_AUTH_ENABLED == false` AND any request hits a path that would otherwise be 402 (e.g. `/api/ai/generate` for a hypothetical free-tier user)
- **THEN** the middleware MUST return `None` from the `_is_auth_enabled()` early-return guard
- **AND** `_is_path_ai_blocked_for_tier` MUST NOT be consulted
- **AND** the request MUST proceed to the route handler

---

## Cross-references

- **Middleware** — `web_runner/middleware/usage_metering.py::register_usage_middleware` + `get_quota` + `check_account_quota` + `log_action`. Constants: `TIER_LIMITS`, `_METERED_PREFIXES`, `_ENDPOINT_ACTION_MAP`, `_AI_FEATURE_BLOCKED_FOR_FREE`, `_AI_BLOCKED_PATHS_NORMALIZED`, `_AI_UTILITY_PATH_PREFIXES`, `_AI_GATED_ACTIONS`. Helpers: `_tier_blocked_response()`, `_is_path_ai_blocked_for_tier()`, `_is_action_ai_gated()`, `_get_user_tier()`, `_count_actions()`, `_log_usage()`, `_metering_enabled()`, `_resolve_action()`.
- **Tests** — `tests/test_ai_tier_block.py` (20 cases pinning the high-risk slice of the contract: 9 free-tier 402s, 3 utility-200s, 1 trailing-slash normalization, 2 pro/legacy bypass, 1 auth-disabled, 4 quota-shape). These tests pin 19 of the 32 Scenarios; the remaining 13 rely on inline-code-level guarantees.
- **Operator runbook** — `docs/ai-material-search.md` §"Operator key config vs. user tier gate" pins the cross-doc user mental model (operator key config ≠ user tier gate; two-layer gate semantics).
- **Install cross-reference** — `docs/install.md` 🪪 footer pins the public-facing free-vs-Pro cross-link.
- **Frontend gate** — `sau_web/frontend/src/Components/AiRightPanel/TierBlockGate.tsx` consumes the R5 structured response to render `<AiPaywallBanner />` without first issuing a guarded request.
- **Archive** — the pre-migration R1-R5 prose spec is preserved in this file's git history (commit pre-ratchet), no longer carried inline.
