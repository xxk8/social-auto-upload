# docs/dev — Index

> **One-page hub** for every file under `docs/dev/`, grouped by audience. Read top-to-bottom by your role, or jump straight to your audience section.

This is the **first stop** for any operator, contributor, or new hire looking for in-depth engineering context. Surface docs (`README.md`, `CLAUDE.md`, `docs/install.md`, `docs/web-shell.md`) link back here for the deep cuts.

## Discoverability-on-arrival contract

A future dev adding a new file under `docs/dev/` **must** do all five of the following. This rule keeps the hub accurate as the doc surface grows:

1. **Pick 1–2 audiences** from `{Operators, Contributors, Onboarding}` and add the file to those tables below. (For the backlink your sub-doc must cite, see Rule 5.) In the Quick-reference matrix at the bottom, the membership cell is the **literal `✅` glyph** — anything else (`—`, blank, typed-out `yes`, emoji like `👍`) is treated as excluded by Hard Invariant 5. Use `✅` consistently.
2. **One-line description** per entry — phrased as "**what you'd read this for**", not a title recap. Future readers should be able to land on the doc from the table without re-reading the link.
3. **Built-from-template**: new docs should mirror `postgres-getting-started.md`'s section ordering — `## Why this exists` (problem framing), `## Prereqs` (assumed dependencies), body sections (the meat), `## Cross-references` at the bottom (line-anchored links to source files), and a `## Troubleshooting` table near the end. Consistency buys scannability; skipping any of the four anchor sections yields a doc that's harder to grep.
4. **Filename is kebab-case `.md`**, no leading numeric prefixes, no SCREAMING-KEBAB (unless mirroring an existing file like `FRONTEND-UI-UPGRADE.md`).
5. **Hub backlink in `## Cross-references`**: every sub-doc must end with `- **Hub**: [docs/dev/INDEX.md#<audience>](docs/dev/INDEX.md#<audience>) — <Audience> (<subtitle>).` so a reader who lands on the sub-doc cold can hop back to the hub and discover siblings. Use the primary audience chosen in Rule 1 (dual-audience docs cite one anchor; readers scroll for the secondary). Enforced by [scripts/dev_docs_audit.py](../scripts/dev_docs_audit.py) Hard Invariant 4 — failing this rule breaks CI.

To fail this contract visibly: a future reviewer greps `docs/install.md` for a runbook keyword and can't find your doc, OR greps `docs/dev/<new>.md` and finds no `docs/dev/INDEX.md` backlink. The INDEX is the canonical lookup for "where's the runbook for X". Don't ship a dev doc without updating the row AND adding the hub backlink.

---

## Operators — on-call, system ops

You're on call. The backend is misbehaving, the cron didn't fire, the DB cluster is down. **Read here first.**

| Doc | What you'd read it for |
|---|---|
| [monitor-cdp-throttling-cron-ops](monitor-cdp-throttling-cron-ops.md) | TBF-018 cron deploy / verify / idempotent re-run / rollback / threshold-tune; paste-evidence discipline |
| [public-inbox-ops](public-inbox-ops.md) | public-inbox-monetization daily kill-criteria cron deploy / verify / 30-day trigger confirmation / threshold-tune / webhook delivery; next-business-day SLA |
| [ai-material-search](ai-material-search.md) | Pexels + Pixabay free-tier key onboarding for AI sidebar image search (`/app/publish` 「图片素材」Disclosure); signup URLs, `.env` PEXELS_API_KEY / PIXABAY_API_KEY, rate-limit warnings (Pexels 200/h + 20K/mo, Pixabay 100/60s), curl verify, T&C compliance (attribution + 不复制主体 + 不 hotlink) |
| [postgres-getting-started](postgres-getting-started.md) | First-time PostgreSQL cluster setup, cluster start/stop, smoke test, troubleshooting |

When in doubt, both files have a **Troubleshooting** table at the bottom — read that first.

---

## Contributors — writing code, merging PRs

You're planning a PR. You want to know **what not to redo**, **what trade-offs were already decided**, and **what quick-win product-uplift ideas** are queued.

| Doc | What you'd read it for |
|---|---|
| [optimization-checklist](optimization-checklist.md) | PR-review checklist for Web Shell publish + dashboard surfaces (V-1…V-5 visual, D/E/F/G/H/I/J interaction, N a11y, U/V/W/X/Y tech debt) |
| [hot-reload-philosophy](hot-reload-philosophy.md) | Why we picked C (custom `scripts/dev_watch.py`) over A (`importlib.reload`) / B (supervisord); read before changing the dev cycle |
| [FRONTEND-UI-UPGRADE](FRONTEND-UI-UPGRADE.md) | Ant Design → shadcn/ui migration record; component inventory + theme variables; read before touching shared UI primitives |
| [VALUE-UPGRADE](VALUE-UPGRADE.md) | Quick-win product-value uplift proposals (confetti, brand color, content preview) — pick low-effort-high-perceived-value PRs here |
| [skill-distribution](skill-distribution.md) | How Claude skills get distributed (PyPI vs. standalone repo vs. Docker); read before adding a new skill to `skills/` |

If your PR is going to touch **anything** in the Web Shell publish surface, start at `optimization-checklist.md` (it groups by ID and tracks ✅/⏳ per item).

---

## Onboarding — first-week reading list

You're new to the codebase. You want a product-mental-model first, then the **minimum setup commands**, then quick reference for the most-asked things.

**Recommended reading order**:

1. **[VALUE-STRATEGY](VALUE-STRATEGY.md)** — "what is this product, where is it going, what's the commercial framing" (Q3 2026 roadmap). Read this first to understand why each subsystem exists.
2. **[postgres-getting-started](postgres-getting-started.md)** — first-time DB cluster setup; get a real PG 19 cluster running locally so you can run the Web Shell backend end-to-end.
3. **[hot-reload-philosophy](hot-reload-philosophy.md)** — once you've saved a file and `lsof -ti:6001` is part of your muscle memory, read this to understand why the project doesn't just use Uvicorn `--reload`.
4. **[VALUE-UPGRADE](VALUE-UPGRADE.md)** — pair with STRATEGY for product-value context; cross-list with Contributors quick-win list.

| Doc | What you'd read it for |
|---|---|
| [VALUE-STRATEGY](VALUE-STRATEGY.md) | Q3 2026 product roadmap / commercial framing / "what is this" answer |
| [postgres-getting-started](postgres-getting-started.md) | First-time PostgreSQL setup, validation, smoke test |
| [hot-reload-philosophy](hot-reload-philosophy.md) | Dev-cycle design rationale, scripted restarts, why we don't use `importlib.reload` |
| [VALUE-UPGRADE](VALUE-UPGRADE.md) | Product-value framing — pairs with STRATEGY |

---

## Quick-reference table — by file

If you already know the document name and just want to know who reads it:

| File | Operators | Contributors | Onboarding |
|---|---|---|---|
| `monitor-cdp-throttling-cron-ops.md` | ✅ | — | — |
| `public-inbox-ops.md` | ✅ | — | — |
| `ai-material-search.md` | ✅ | — | — |
| `postgres-getting-started.md` | ✅ | — | ✅ |
| `hot-reload-philosophy.md` | — | ✅ | ✅ |
| `optimization-checklist.md` | — | ✅ | — |
| `FRONTEND-UI-UPGRADE.md` | — | ✅ | — |
| `VALUE-UPGRADE.md` | — | ✅ | ✅ |
| `VALUE-STRATEGY.md` | — | — | ✅ |
| `skill-distribution.md` | — | ✅ | — |

A doc that fits **two** audiences appears in both table rows and in both audience sections above — that's by design (e.g. `postgres-getting-started.md` is on-call-relevant AND onboarding-essential).

---

## Adding or removing docs from this index

**Adding a doc**: write the file, then edit **one** of the three audience tables above + the cross-reference quick-reference table. The contract section reinforces why this matters.

**Removing a doc**: delete the file, then strip its row from each table it appears in. Verify the surface docs that link here no longer dangle.

**Renaming a doc**: `git mv docs/dev/<old>.md docs/dev/<new>.md`, then update every link in this INDEX (3 places per audience table + 1 row in the quick-reference table). Grep `docs/dev/<old>.md` across the repo before committing — leftover links will 404.
