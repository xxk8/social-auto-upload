# Branching Strategy — dev → main

## Overview

This project follows a **two-branch enterprise workflow**:

```
        ┌──────────────────┐
        │     dev          │  ← Active development, testing, feature integration
        └────────┬─────────┘
                 │
         PR / Merge
                 │
        ┌────────▼─────────┐
        │     main         │  ← Production — stable, deployable at all times
        └──────────────────┘
```

- **`dev`** — The single development branch. All feature work, bug fixes, experiments, and integration happen here. Must always compile and pass tests.
- **`main`** — The production branch. Only receives merges from `dev` when the team agrees the `dev` HEAD is release-ready. Every commit on `main` is considered deployable.

---

## Day-to-Day Workflow

### 1. Start from `dev`

```bash
git checkout dev
git pull origin dev          # ensure local is up to date
```

### 2. Create a short-lived feature / fix branch (optional but recommended)

For non-trivial work, branch off `dev`:

```bash
git checkout -b feat/my-feature    # or fix/ chore/ docs/
```

Naming convention:
| Prefix | Purpose |
|--------|---------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `chore/` | Maintenance, refactoring, tooling |
| `docs/` | Documentation-only changes |

### 3. Develop and commit locally

```bash
git add -A
git commit -m "feat: concise description of the change"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

### 4. Push and open a Pull Request into `dev`

```bash
git push origin feat/my-feature
```

Create a PR against the `dev` branch. The PR should:
- Describe what changed and why
- Include screenshots for UI changes
- Reference any related issues

### 5. Merge into `dev`

Use **Squash and Merge** for small / trivial changes.  
Use **Merge Commit** for larger feature work where individual commit history is valuable.

**After merging, delete the feature branch** both locally and remotely:

```bash
git branch -D feat/my-feature
git push origin --delete feat/my-feature
```

### 6. Release: merge `dev` into `main`

When `dev` is stable and ready for production:

```bash
git checkout main
git pull origin main
git merge dev
git push origin main
```

Use a **merge commit** (not squash) so the `main` history records exactly which set of commits from `dev` entered production.

---

## Branch Lifecycle

| Branch | Created from | Merges into | Lifetime |
|--------|-------------|-------------|----------|
| `main` | — | — | Permanent |
| `dev`  | `main` | `main` | Permanent |
| `feat/*` | `dev` | `dev` | Short-lived (days) |
| `fix/*` | `dev` | `dev` | Short-lived (days) |
| `chore/*` | `dev` | `dev` | Short-lived (days) |
| `docs/*` | `dev` | `dev` | Short-lived (days) |

> **Important**: Feature / fix branches should live no longer than a few days. Long-lived branches defeat the purpose of continuous integration and increase merge conflict risk.

---

## Guardrails

### Don't

- ❌ Push directly to `main` (except for emergency hotfixes — see below)
- ❌ Push directly to `dev` for non-trivial changes (use a branch + PR)
- ❌ Keep stale branches indefinitely — delete after merge
- ❌ Create long-lived personal or AI-agent branches (`assorted-alphabet`, `freebuff/*`, etc.)

### Do

- ✅ Always branch from `dev`
- ✅ Keep `main` in sync — merge `dev` → `main` regularly (weekly / per-sprint)
- ✅ Delete feature branches immediately after merge
- ✅ Use meaningful branch names: `feat/dark-mode` not `experiment-42`

---

## Emergency Hotfixes

In rare cases where a production issue must be fixed **before** `dev` is ready to release:

```bash
git checkout main
git checkout -b hotfix/critical-issue
# ... fix, commit, test ...
git checkout main
git merge hotfix/critical-issue
git push origin main
git branch -D hotfix/critical-issue
```

After the hotfix, merge `main` back into `dev` so the fix is carried forward:

```bash
git checkout dev
git merge main
git push origin dev
```

---

## Visual Summary

```
feat/xyz ──┐
fix/abc ───┤
chore/n ───┤
           │
           ▼
         dev  ──────────────────►  main
           │                        │
      (test, CI, review)        (deploy)
           │                        │
           └── ◄ ─ hotfix ─── ──────┘
```

---

## FAQ

**Q: Can I commit directly to `dev`?**  
A: Yes, for trivial changes (typo fix, one-line config tweak). For anything larger, use a branch + PR.

**Q: How often should we merge `dev` → `main`?**  
A: At least once per sprint / milestone. More frequently is better — daily if CI is green.

**Q: What about the `upstream` remote?**  
A: This repo tracks the original project at `dreammis/social-auto-upload` as `upstream`. The `upstream/main` branch is read-only and synced manually when we want to incorporate upstream changes into `dev`.
