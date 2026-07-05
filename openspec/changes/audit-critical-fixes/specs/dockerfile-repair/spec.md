## ADDED Requirements

### Requirement: Dockerfile SHALL use correct entry point
The Dockerfile `CMD` SHALL reference `run.py` (the actual Flask entry point), not `web_runner.py` (which does not exist).

#### Scenario: Docker container starts successfully
- **WHEN** `docker build -t sau . && docker run -p 6001:6001 sau` is executed
- **THEN** the Flask server SHALL start and respond to `GET /health` with `{"status": "ok"}`

#### Scenario: Docker container does not crash on startup
- **WHEN** the container starts
- **THEN** `python run.py` SHALL NOT raise `ModuleNotFoundError` or `FileNotFoundError`

### Requirement: Dockerfile SHALL install dependencies from pyproject.toml
The Dockerfile SHALL use `uv pip install -e ".[web]"` to install the project and its web dependencies from `pyproject.toml`, instead of `pip install -r requirements.txt`.

#### Scenario: Web dependencies are available in container
- **WHEN** the container starts
- **THEN** `flask`, `flask-cors`, and `aiohttp` SHALL be importable

#### Scenario: Core dependencies are available in container
- **WHEN** the container starts
- **THEN** `patchright`, `loguru`, `Pillow`, and `PyYAML` SHALL be importable

### Requirement: Dockerfile SHALL install patchright browser
The Dockerfile SHALL run `patchright install chromium` (not `playwright install chromium-headless-shell`) to install the browser automation driver.

#### Scenario: Browser automation works in container
- **WHEN** a login or upload task is executed inside the container
- **THEN** patchright SHALL be able to launch a Chromium browser without errors

### Requirement: `.dockerignore` SHALL exclude unnecessary files
The `.dockerignore` SHALL exclude: `.venv/`, `.git/`, `node_modules/`, `__pycache__/`, `*.egg-info/`, `.pytest_cache/`, `tests/`, `database.db`, `cookies/`, `.sau_uploads/`, `logs/`, `.sau-logs/`, `*.log`, `.kilo/`, `.kilocode/`, `.omo/`, `.opencode/`, `.agents/`, `videos/`, `media/`, `legacy-snapshots/`.

#### Scenario: Docker build context is minimal
- **WHEN** `docker build` is executed
- **THEN** the build context SHALL NOT include `node_modules/`, `tests/`, `database.db`, or `cookies/`

#### Scenario: Source code IS included in build context
- **WHEN** `docker build` is executed
- **THEN** the build context SHALL include `web_runner/`, `uploader/`, `cli/`, `utils/`, `sau_cli.py`, `run.py`, `pyproject.toml`
