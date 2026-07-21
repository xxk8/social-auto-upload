## ADDED Requirements

### Requirement: Sensitive runtime files SHALL NOT be tracked in Git
The following files and directories SHALL NOT be present in `git ls-files`:
- `database.db` (root-level SQLite database)
- `conf.py` (local configuration with potential secrets)
- `.kilocode/`, `.opencode/`, `.omo/`, `.kilo/`, `.playwright-mcp/` (AI agent session data)
- `skills-lock.json` (local lock file)
- `console.publish.log` (runtime log)
- `.sau-logs/` (runtime log directory)

The `.gitignore` file SHALL contain rules matching all of the above paths.

#### Scenario: Fresh clone has no sensitive files tracked
- **WHEN** a developer runs `git clone` on the repository
- **THEN** `git ls-files` SHALL NOT include `database.db`, `conf.py`, `.kilocode/`, `.opencode/`, `.omo/`, or any AI agent session files

#### Scenario: Local sensitive files are preserved after git rm --cached
- **WHEN** `git rm --cached database.db conf.py` is executed
- **THEN** the files SHALL remain on disk but SHALL be removed from Git tracking
- **AND** subsequent `git status` SHALL show them as untracked (or ignored if `.gitignore` matches)

#### Scenario: New sensitive files cannot be accidentally added
- **WHEN** a developer runs `git add .` in a working directory that contains `database.db`
- **THEN** `database.db` SHALL NOT be staged due to `.gitignore` rules

### Requirement: `.gitignore` SHALL cover all runtime and IDE artifacts
The `.gitignore` SHALL include rules for:
- Python bytecode (`__pycache__/`, `*.py[cod]`)
- Virtual environments (`.venv/`, `venv/`)
- IDE settings (`.idea/`, `.vscode/`)
- Database files (`*.db`, `db/database.db`)
- Cookie files (`cookies/`)
- Upload temp files (`.sau_uploads/`)
- Node.js artifacts (`node_modules/`, `dist/`)
- AI agent tools (`.kilo/`, `.kilocode/`, `.omo/`, `.opencode/`, `.agents/`, `.playwright-mcp/`)
- Lock files (`skills-lock.json`, `package-lock.json` exception: `package-lock.json` SHOULD be tracked)
- Runtime logs (`*.log`, `.sau-logs/`, `console.publish.log`)

#### Scenario: `.gitignore` prevents `node_modules` from being tracked
- **WHEN** `npm install` creates `node_modules/` in `sau_web/frontend/`
- **THEN** `git add .` SHALL NOT stage any files under `node_modules/`

#### Scenario: `package-lock.json` IS tracked
- **WHEN** `npm install` generates `sau_web/frontend/package-lock.json`
- **THEN** `git add .` SHALL stage `package-lock.json` (it must NOT be in `.gitignore`)
