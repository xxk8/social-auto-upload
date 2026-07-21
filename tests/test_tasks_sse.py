"""Tests for ``GET /api/tasks/stream`` SSE endpoint.

Covers the Server-Sent Events stream that pushes task status updates
to the dashboard, replacing the previous 3-second polling loop.

Requires a reachable PG via DATABASE_URL.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

import pytest

pytest.importorskip("psycopg")

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from web_runner import create_app  # noqa: E402
from web_runner.db import get_database  # noqa: E402
from tests._login_helpers import _login_as  # noqa: E402


@pytest.fixture
def app():
    """Flask test client with the full app."""
    application = create_app()
    application.config["TESTING"] = True
    application.config["SECRET_KEY"] = "test-secret-key-tasks-sse"
    with application.test_client() as client:
        yield client


@pytest.fixture(autouse=True)
def _clean_tasks():
    """Wipe tasks table before and after each test."""
    db = get_database()
    db.execute("DELETE FROM tasks WHERE task_id LIKE 'test-sse-%%'")
    yield
    db.execute("DELETE FROM tasks WHERE task_id LIKE 'test-sse-%%'")


def _parse_sse_events(text: str) -> list[tuple[str, dict | list]]:
    """Parse raw SSE text into (event_name, data) tuples."""
    events = []
    current_event = "message"
    current_data = []
    for line in text.splitlines():
        if line.startswith("event:"):
            current_event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            current_data.append(line[len("data:"):].strip())
        elif line == "" and current_data:
            try:
                payload = json.loads("".join(current_data))
            except json.JSONDecodeError:
                payload = None
            events.append((current_event, payload))
            current_data = []
    return events


class TestTasksSSE:
    """GET /api/tasks/stream — Server-Sent Events for task status."""

    def test_stream_returns_sse_headers(self, app):
        """SSE endpoint returns correct Content-Type and cache headers."""
        _login_as(app, "tasks_sse_headers@test.com")
        resp = app.get("/api/tasks/stream")
        assert resp.status_code == 200
        assert resp.mimetype == "text/event-stream"
        assert resp.headers.get("Cache-Control") == "no-cache"
        assert resp.headers.get("X-Accel-Buffering") == "no"

    def test_stream_emits_initial_event(self, app):
        """SSE stream starts with an ``initial`` event carrying the task list."""
        _login_as(app, "tasks_sse_initial@test.com")
        resp = app.get("/api/tasks/stream")
        # Consume the generator until we get the first batch of events.
        # Flask's test client returns a generator; iterating yields bytes.
        chunks = []
        for chunk in resp.response:
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
            if "event: initial" in "".join(chunks):
                break
        text = "".join(chunks)
        events = _parse_sse_events(text)
        assert any(event == "initial" and isinstance(payload, list) for event, payload in events)

    def test_stream_initial_event_contains_seeded_task(self, app):
        """The ``initial`` event includes tasks already in the database."""
        _login_as(app, "tasks_sse_initial_seed@test.com")
        db = get_database()
        db.execute(
            "INSERT INTO tasks (task_id, status, platform, action, account, created) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("test-sse-initial-1", "pending", "douyin", "upload-video", "acc", datetime.now().isoformat(timespec="seconds")),
        )

        resp = app.get("/api/tasks/stream")
        chunks = []
        for chunk in resp.response:
            chunks.append(chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk)
            if "event: initial" in "".join(chunks):
                break

        text = "".join(chunks)
        events = _parse_sse_events(text)
        initial_events = [payload for event, payload in events if event == "initial"]
        assert len(initial_events) == 1
        assert any(task.get("task_id") == "test-sse-initial-1" for task in initial_events[0])

    def test_stream_closes_when_no_running_tasks(self, app):
        """When no tasks are pending/running, the stream emits ``done`` and closes."""
        _login_as(app, "tasks_sse_done@test.com")
        resp = app.get("/api/tasks/stream")
        text = "".join(
            chunk.decode("utf-8") if isinstance(chunk, bytes) else chunk
            for chunk in resp.response
        )
        events = _parse_sse_events(text)
        assert any(event == "done" for event, _ in events)

    def test_stream_unauth_returns_401(self, app):
        """Unauthenticated requests receive 401."""
        resp = app.get("/api/tasks/stream")
        assert resp.status_code == 401
