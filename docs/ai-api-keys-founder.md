# AI API Keys — Founder-Gated Management

**Round:** `ai-api-keys-founder`
**Audience:** Operators / on-call (whoever can rotate keys)

This document describes how AI model API keys (OpenRouter and any
future provider) are managed under the founder-gated model: only the
project founder — not all admins, not regular users — can add / list
/ delete / batch-import / transfer-founding-keys operations.

## Threat model

Before this round, the AI-key management surface had three leaks:

| Endpoint | Pre-feature gate | Post-feature outcome |
|---|---|---|
| `POST /api/ai/config` (add single key) | `@login_required` only — any logged-in user could insert a key | Founder only |
| `DELETE /api/ai/config` (single by id) | `@login_required` only — anyone could delete | Founder only |
| `DELETE /api/ai/config` (no key_id → bulk) | `@login_required` + admin on bulk; single path was unjustly open | Founder only |
| `GET /api/ai/keys` (masked list) | unauthenticated | Founder only |
| `POST /api/ai/keys/batch` (bulk import) | admin only | Founder only |

Even though the masked list returns only `sk-or-v1-001****5e4f`-style
prefix+tail pairs, the prefix alone is enough to correlate rate-limit
behaviour with a key (a non-founder adversary could rate-limit-trigger
specific keys and observe the rotation behaviour). Mutating endpoints
(insert / delete / bulk-import) were the bigger concern — a single
authenticated user was enough to evict or substitute the key pool.

## Roles

| Role | `role` column | `is_founder` | Can mutate AI keys? |
|---|---|---|---|
| Founder (project creator) | `admin` | `true` | Yes |
| Admin (other admin) | `admin` | `false` | No — sees AI status as "configured" but can't list/add/delete |
| Regular user | `user` | `false` | No — same as other-admin |

The founder role is **strictly narrower** than the admin role. A
deployment can have many admins (one of which is the founder). All
admins can read `/api/auth/me` and see who the founder is, but only
the founder can manage the AI-key pool.

## Identity persistence

`users.is_founder BOOLEAN NOT NULL DEFAULT FALSE` (PG) /
`INTEGER NOT NULL DEFAULT 0` (SQLite). Schema-level guard:

* `CREATE UNIQUE INDEX ... ON users (is_founder) WHERE is_founder = TRUE/1`
  — at most one founder system-wide. The transfer endpoint's
  atomic-swap transaction relies on this constraint to detect
  concurrent racing mutations cleanly.

**Cold-start backfill:** if no user is currently founder on a fresh
deploy, the lowest-id user is promoted to founder by a one-shot
UPDATE inside `init_db()`. The backfill is idempotent: re-running
against a deployment that already has a founder is a no-op.

## Endpoints

`POST /api/admin/founder/transfer` — atomic founder swap. Caller
must be the current founder. Body:
```json
{ "target_user_id": 42 }
```
Response on success:
```json
{
  "success": true,
  "data": {
    "prior_founder": {"id": 1, "email": "founder@old.com"},
    "new_founder":  {"id": 42, "email": "next@admin.com"},
    "transferred_at": "2026-07-09T..."
  }
}
```
An `admin_audit_log` row with `action='founder_transfer'` is written
AFTER the transaction commits so the audit log has a 1:1 mapping with
successful swaps.

The 4 founder-gated AI-key endpoints (`POST /api/ai/config`,
`DELETE /api/ai/config`, `GET /api/ai/keys`, `POST /api/ai/keys/batch`)
now query `_check_founder_gate()` inline. Errors:
- 401 if not logged in.
- 403 with message "仅项目创始人可执行此操作" if logged in but not founder.

Each successful mutation also writes a `admin_audit_log` row:
- `action='ai_key_add'`         on `POST /api/ai/config`
- `action='ai_key_delete'`      on `DELETE /api/ai/config` (single or all)
- `action='ai_key_list'`        on `GET /api/ai/keys`
- `action='ai_key_batch'`       on `POST /api/ai/keys/batch`

## Operator runbook

### Rotating AI keys (founder only)

1. Login as the founder (the cold-start first user, or the address
   that received a recent transfer).
2. Open the AI sidebar → Settings popover → 添加 Key.
3. Paste the new `sk-or-v1-...` key. The endpoint returns 200 with
   `{key_id, masked, configured}`.
4. Repeat for batch imports via the 批量导入 textarea.

### Transferring founder role (business-continuity)

Use case: founder leaves the team / rotates ownership.

1. As the current founder, navigate to `/dashboard/admin/users`
   (`AdminUsersPage`).
2. Pick the target user, click 移交 Founder 身份 in the row's
   dropdown.
3. Confirm via the dialog.
4. The endpoint atomically swaps `users.is_founder`; the prior
   founder immediately loses the AI-key surface (refresh the page to
   see the read-only banner). The new founder sees the
   添加 Key / 批量导入 / 查看 Key 列表 / 删除全部 Key controls.

### Recovering if founder lost

If the founder is unable to act (account locked, forgot credentials),
the recovery path is direct DB:

```sql
-- Inspect current founder
SELECT id, email, role, is_founder FROM users WHERE is_founder = TRUE;

-- Reassign to a known admin
UPDATE users SET is_founder = FALSE WHERE is_founder = TRUE;
UPDATE users SET is_founder = TRUE  WHERE email = 'next-founder@example.com';
```

The partial-unique index ensures only one row can carry
`is_founder = TRUE` at any moment. Manual SQL is appropriate for
break-glass but should be followed by a database migration tooling
PR so the audit log (`admin_audit_log`) reflects the change. The
runtime endpoint at `POST /api/admin/founder/transfer` is the
preferred path for routine transfers.

## Frontend wiring

The frontend `AuthUser` type carries `is_founder?: boolean`. The
AI-sidebar `AiSettingsPopover` reads it via `useAuth()` and gates the
add/batch/list/delete menu:

- Founder: full menu visible (current behaviour).
- Non-founder: read-only "AI API Key 由项目创始人管理" banner instead
  of the menu. `useAiKeys(enabled = isFounder)` short-circuits the
  network request for non-founders so the dashboard doesn't burn
  retry cycles on a 403 the user can't act on.

The admin dashboard's `AdminUsersPage` renders a separate "Founder"
pill column and exposes the 移交 Founder 身份 action via
`adminApi.transferFounder(targetUserId)`.

## Defining the founder

The tier is set by being the first user on a cold deploy (auto
backfill) or by receiving a transfer call from the current founder.
There's no admin-gui to bootstrap-pick a different founder at
deploy-time; the cold-start promotion rule means **the first person
to log into a fresh deployment becomes the founder.** This is
intentional — it maps to the conventional "creator of the project is
its founder" model — but operators should lock this down by
pre-seeding `users` rows + manually marking one as
`is_founder = TRUE` if the deployment pre-stages humans before the
first login flow.

## Where the code lives

| Layer | Path | Purpose |
|---|---|---|
| Schema | `web_runner/db.py::alteration_statements` (PG) / `alterations` (SQLite) | `is_founder` column + partial unique index + cold-start backfill |
| Decorator | `web_runner/routes/auth.py::founder_required` + `_current_user_is_founder` | Founder-gate primitive; mirrors `admin_required` |
| Serialization | `web_runner/routes/auth.py::_serialize_user` | Surfaces `is_founder` in `/api/auth/me` and login responses |
| AI gate | `web_runner/routes/ai.py::_check_founder_gate` + `_audit_ai_key_action` | Inline founder-check + audit log; applied to 4 DB-mutating endpoints |
| Transfer | `web_runner/routes/founder.py::transfer_founder` | Atomic swap + post-commit audit log |
| Registration | `web_runner/__init__.py::create_app` | `app.register_blueprint(founder_bp)` between `admin_bp` and `accounts_bp` |
| Frontend type | `sau_web/frontend/src/features/auth/authApi.ts::AuthUser.is_founder` | Wire-shape carrier |
| Frontend gate | `sau_web/frontend/src/features/ai-assistant/AiSettingsPopover.tsx` | Read-only banner for non-founders |
| Frontend transfer | `sau_web/frontend/src/features/admin/adminApi.ts::transferFounder` + `AdminUsersPage.tsx` | Founder-transfer UI surface |
| Tests | `tests/test_ai_routes.py` + `tests/test_founder.py` | Gate contract + transfer endpoint |

## See also

* `docs/DESIGN-admin-dashboard.md` — admin dashboard design (founder-badge column parallels the role pill here).
* `docs/web-shell.md` — auth shape and routing conventions; `_serialize_user` is the canonical source-of-truth for the user row wire shape.
* `docs/install.md` — dependency / migration guidance. The `is_founder` column is created by `init_db()` with no operator action needed — backfill runs automatically when no founder exists.
