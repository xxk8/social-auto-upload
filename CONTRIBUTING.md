# Contributing Guide

## Table of Contents

1. [Branching Strategy](#branching-strategy)
2. [Development Workflow](#development-workflow)
3. [Commit Convention](#commit-convention)
4. [Git .gitignore Rules](#git-gitignore-rules)
5. [Pull Request Process](#pull-request-process)
6. [Release Process](#release-process)
7. [FAQ](#faq)

---

## Branching Strategy

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

| Branch | Purpose | Created from | Merges into | Lifetime |
|--------|---------|-------------|-------------|----------|
| `main` | Production — deployable at all times | — | — | Permanent |
| `dev` | Active development | `main` | `main` | Permanent |
| `feat/*` | New feature | `dev` | `dev` | Short-lived (days) |
| `fix/*` | Bug fix | `dev` | `dev` | Short-lived (days) |
| `chore/*` | Maintenance, refactoring, tooling | `dev` | `dev` | Short-lived (days) |
| `docs/*` | Documentation-only changes | `dev` | `dev` | Short-lived (days) |
| `hotfix/*` | Emergency production fix | `main` | `main` → `dev` | Hours |

> **Rule**: Feature/fix branches must live no longer than a few days. Long-lived branches defeat continuous integration and increase merge conflict risk.

---

## Development Workflow

### 1. Start from `dev`

```bash
git checkout dev
git pull origin dev
```

### 2. Create a feature branch

```bash
git checkout -b feat/my-feature
# or: fix/ chore/ docs/
```

Branch names must be meaningful:
- ✅ `feat/dark-mode`, `fix/login-redirect`, `chore/upgrade-deps`
- ❌ `assorted-alphabet`, `experiment-42`, `freebuff/new-thread-xyz`

### 3. Develop and commit

```bash
git add -A
git commit -m "feat: add dark mode toggle"
```

See [Commit Convention](#commit-convention) for message format.

### 4. Push and create a Pull Request

```bash
git push origin feat/my-feature
```

Create a PR targeting the **`dev`** branch. The PR must:
- Describe **what** changed and **why**
- Include **screenshots** for UI changes (but don't commit them to the repo — upload to GitHub directly)
- Reference any related issues

### 5. Merge into `dev`

| Scenario | Strategy | Effect |
|----------|----------|--------|
| Small / trivial | Squash and merge | Single clean commit on `dev` |
| Larger feature | Merge commit | Preserves full branch topology |

After merging, delete the feature branch:

```bash
git branch -D feat/my-feature
git push origin --delete feat/my-feature
```

---

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>

[optional body]
```

| Type | Usage |
|------|-------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `chore` | Maintenance, refactoring, tooling |
| `docs` | Documentation-only changes |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration changes |

Examples:

```
feat: add dark mode toggle
fix: resolve login redirect on token expiry
chore: upgrade dependencies to latest
docs: update README with new API endpoints
```

---

## Git .gitignore Rules

### Global patterns (`.gitignore` at project root)

These files/directories **must never be committed**:

#### Do not commit

| Pattern | Reason |
|---------|--------|
| `dashboard-*.png` | UI development screenshots |
| `publish-ai-before.png` | UI development screenshots |
| `.sau/` | Local API smoke-test snapshots |
| `output/` | Playwright test screenshots |
| `media/thumbs/` | Auto-generated video thumbnails |
| `media/studio/*.zip` | Remotion render packages |
| `media/uploads/` | Test media uploads |
| `videos/*.mp4` | Demo / test videos |
| `.sau_secret_key` | **Secret key** — never commit |
| `.mimocode/` | AI agent runtime artifacts |
| `.freebuff/` | AI agent worktrees |
| `.kilo/`, `.kilocode/`, `.omo/`, `.opencode/` | AI agent tool artifacts |
| `.playwright-mcp/` | Playwright MCP cache |
| `_run_verify_task.sh` | Local dev scripts |
| `_verify_models_task1.py` | Local dev scripts |
| `dev-web.sh` | Local dev scripts |
| `start-win.bat` | Local dev scripts |
| `/package.json` | Root-level package.json (the real one is at `sau_web/frontend/`) |
| `/pnpm-lock.yaml` | Root-level pnpm lock (only `sau_web/frontend/` should have one) |
| `/pnpm-workspace.yaml` | Root-level pnpm workspace (only `sau_web/frontend/` should have one) |
| `/remotion_studio/` | Root-level remotion studio copy (real one at `sau_web/remotion_studio/` or `sau_web/frontend/remotion_studio/`) |

#### Do not accidentally re-add

The following files were **removed from git tracking** during cleanup. They are now in `.gitignore`:

- 12 UI screenshots (`dashboard-*.png`, `publish-ai-before.png`)
- 29 API smoke-test snapshots (`.sau/api-smoke/`)
- 16 Playwright screenshots (`output/playwright/`)
- 14 video thumbnails (`media/thumbs/`)
- 4 render zip packages (`media/studio/*.zip`)
- 6 local scripts (`_run_verify_task.sh`, etc.)
- `.sau_secret_key`, `package.json`, `remotion_studio/presets.ts`

If you run a command that creates files matching these patterns, **verify they are not staged** before committing.

### Frontend-specific patterns (`sau_web/frontend/.gitignore`)

| Pattern | Reason |
|---------|--------|
| `node_modules/` | Installed dependencies |
| `dist/`, `dist-ssr/` | Build output |
| `.tanstack/` | TanStack router cache |
| `remotion_studio/` | Local Remotion studio renders |
| `content/` | Generated content |
| `*.log` | Development logs |

### If you add a new secret or local-only file

1. Add the pattern to `.gitignore` **before** committing
2. If already committed, stop and fix it immediately — removing secrets from git history is painful

---

## Pull Request Process

1. **Create PR** targeting `dev` branch
2. **Write a clear description**: what, why, how to test
3. **Attach screenshots** for UI changes (upload to GitHub, don't commit image files)
4. **Verify CI passes** — all tests must be green
5. **Request review** from at least one other contributor
6. **Merge** after approval (squash for small changes, merge commit for larger work)
7. **Delete the branch** immediately after merge

---

## Release Process

When `dev` is stable and ready for production:

```bash
git checkout main
git pull origin main
git merge dev --no-ff -m "release: merge dev into main"
git push origin main
git checkout dev
```

Use `--no-ff` to create a merge commit, preserving the fact that a release happened.

### Hotfix procedure

For production issues that cannot wait for the next release:

```bash
git checkout main
git checkout -b hotfix/critical-issue
# fix, commit, test
git checkout main
git merge hotfix/critical-issue
git push origin main
git branch -D hotfix/critical-issue
# Sync back to dev
git checkout dev
git merge main
git push origin dev
```

---

## FAQ

**Q: Can I commit directly to `dev`?**
A: Yes, for trivial changes (typo, one-line config). For anything larger, use a branch + PR.

**Q: How often should we merge `dev` → `main`?**
A: At least once per sprint / milestone. Daily is better if CI is green.

**Q: What about the `upstream` remote?**
A: This repo tracks the original project at `dreammis/social-auto-upload` as `upstream`. The `upstream/main` branch is read-only and synced manually when incorporating upstream changes into `dev`.

**Q: I accidentally committed a file I shouldn't have. What do I do?**
A: If it's a non-secret file, just add it to `.gitignore` and run `git rm --cached <file>` to stop tracking it. If it's a secret (key, password), it needs to be removed from git history entirely — contact the maintainer.

**Q: Can I use an AI coding assistant?**
A: Yes, but do not let AI tools create branches automatically. All branches must follow the naming convention (`feat/`, `fix/`, `chore/`, `docs/`, `hotfix/`). Delete AI-generated ephemeral branches immediately.
