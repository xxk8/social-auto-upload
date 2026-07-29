# docs/dev — Index

> **One-page hub** for every file under `docs/dev/`, grouped by audience. Read top-to-bottom by your role, or jump straight to your audience section.

This is the **first stop** for any operator, contributor, or new hire looking for in-depth engineering context. Surface docs (`README.md`, `CLAUDE.md`, `docs/install.md`, `docs/web-shell.md`) link back here for the deep cuts.

## Discoverability-on-arrival contract

A future dev adding a new file under `docs/dev/` **must** do all five of the following. This rule keeps the hub accurate as the doc surface grows:

1. **Pick 1–2 audiences** from `{Operators, Contributors, Onboarding}` and add the file to those tables below.
2. **One-line description** per entry — phrased as "**what you'd read this for**".
3. **Filename is kebab-case `.md`**, no leading numeric prefixes, no SCREAMING-KEBAB (unless mirroring an existing file like `FRONTEND-UI-UPGRADE.md`).
4. **Hub backlink** in the sub-doc so a cold reader can hop back here.
5. **Only list files that exist in this tree** — never link a freebuff/worktree-only doc without also shipping the file.

---

## Contributors — writing code, merging PRs

| Doc | What you'd read it for |
|---|---|
| [FRONTEND-UI-UPGRADE](FRONTEND-UI-UPGRADE.md) | Ant Design → shadcn/ui migration record; component inventory + theme variables |
| [VALUE-UPGRADE](VALUE-UPGRADE.md) | Quick-win product-value uplift (confetti, preview, progress) — status table tracks delivery |
| [skill-distribution](skill-distribution.md) | How Claude skills get distributed; read before adding a skill under `skills/` |
| [web-shell-architecture-lock](web-shell-architecture-lock.md) | **LOCKED**：Web Shell = TanStack Router SPA + Flask；不上 Start/SSR/`createServerFn` |
| [LOCALE-JSON-MUTATION-RULES](LOCALE-JSON-MUTATION-RULES.md) | Locale JSON edit rule: `python json.load/dump` or `write_file`; never multi-line `str_replace`. Read before touching `sau_web/frontend/src/locales/`. |
| [tanstack-start-gap-analysis](tanstack-start-gap-analysis.md) | Historical Start gap catalogue — **reference only**, migration stopped |
| [tanstack-start-migration-plan](tanstack-start-migration-plan.md) | Historical Start plan — **reference only** |
| [08-toast-context-case-mismatch](second-batch-tickets/08-toast-context-case-mismatch.md) | Casing accident post-mortem; use lowercase `components` paths |

---

## Onboarding — first-week reading list

**Recommended reading order**:

1. **[VALUE-UPGRADE](VALUE-UPGRADE.md)** — product polish framing and what's already shipped.
2. **[web-shell-architecture-lock](web-shell-architecture-lock.md)** — stack boundaries before you touch routing or axios.
3. **[docs/web-shell.md](../web-shell.md)** — how to run the React + Flask shell.
4. **[docs/CLI.md](../CLI.md)** — `sau` CLI entrypoints.

| Doc | What you'd read it for |
|---|---|
| [VALUE-UPGRADE](VALUE-UPGRADE.md) | Product-value framing + delivered uplift checklist |
| [web-shell-architecture-lock](web-shell-architecture-lock.md) | SPA + Flask lock; what not to reintroduce |

---

## Quick-reference table — by file

| File | Contributors | Onboarding |
|---|---|---|
| `FRONTEND-UI-UPGRADE.md` | ✅ | — |
| `VALUE-UPGRADE.md` | ✅ | ✅ |
| `skill-distribution.md` | ✅ | — |
| `web-shell-architecture-lock.md` | ✅ | ✅ |
| `LOCALE-JSON-MUTATION-RULES.md` | ✅ | — |
| `tanstack-start-gap-analysis.md` | ✅ | — |
| `tanstack-start-migration-plan.md` | ✅ | — |
| `second-batch-tickets/*` | ✅ | — |

> **Note:** Ops runbooks (`postgres-getting-started`, `VALUE-STRATEGY`, monitor/cron docs, etc.) may live in other worktrees; they are **not** shipped on this branch until copied into `docs/dev/`.

---

## Adding or removing docs from this index

**Adding a doc**: write the file under `docs/dev/`, then edit the audience tables + quick-reference row.

**Removing a doc**: delete the file, then strip its row from every table above.
