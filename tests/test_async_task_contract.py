"""round-OPT-async-202 — 202 Accepted + Location/Retry-After contract tests.

Covers the round's headline changes (web_runner/utils.py::_make_accepted_response
+ web_runner/executor.py::load_pending_tasks + web_runner/routes/upload.py +
web_runner/routes/tasks.py) and pins the five guarantees the round made to
the fire-and-forget surface:

  1. /api/upload/video returns HTTP 202 + ``Location`` + ``Retry-After``
  2. /api/upload/note returns HTTP 202 + ``Location`` + ``Retry-After``
  3. /api/tasks/add + retry + reschedule + copy return HTTP 202
  4. GET /api/tasks?task_id=X single-task filter (the polling URL the
     202 ``Location`` header advertises) returns exactly the right row
  5. PlatformExecutor.load_pending_tasks recovers pending tasks that have
     ``scheduled_at IS NULL`` (the pre-OPT-async-202 restart-loss gap)
     AND continues to skip future-scheduled tasks

Requires a reachable PG via DATABASE_URL. The executor's submit /
execute paths are monkeypatched (no real chromium / sau_cli subprocess
is spawned) so the suite stays fast and CI-friendly.

Run: ``python3 -m pytest tests/test_async_task_contract.py -v``
"""

from __future__ import annotations

import io
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

# Ensure repo root on path so `from web_runner.utils import ...` resolves
# consistently regardless of pytest invocation cwd.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


# ── Test data isolation ──────────────────────────────────────────────

_TEST_PREFIX = "test-async-202-"


def _purge_test_tasks() -> None:
    from web_runner.db import get_database

    get_database().execute(
        "DELETE FROM tasks WHERE task_id LIKE ?",
        (f"{_TEST_PREFIX}%",),
    )


@pytest.fixture(autouse=True)
def _isolate_test_tasks():
    """Clean up tasks created during the test (round-OPT-async-202 hotfix).

    Pre-hotfix version only deleted ``task_id LIKE 'test-async-202-%'``,
    which leaked route-generated tasks (the upload + tasks routes
    call ``_new_task_id(action)`` which builds UUID-based IDs that
    do NOT start with the test prefix). The new strategy records
    ``datetime.now()`` before yield and deletes every row inserted
    at-or-after that timestamp, so UUID-style task_ids get caught
    too. The LIKE clause still runs as a belt-and-suspenders sweep
    for direct ``_db_insert_task(task_id="test-async-202-...")``
    calls (e.g. the executor recovery tests).

    Tests run sequentially by default (pytest doesn't parallelize
    without ``-n``) so the timestamp window stays clean. The fix
    is automatic — no test cooperation required.
    """
    from web_runner.db import get_database

    _purge_test_tasks()
    db = get_database()
    before = datetime.now().isoformat(timespec="seconds")
    yield
    db.execute("DELETE FROM tasks WHERE created >= ?", (before,))
    _purge_test_tasks()


# ── Flask app fixture ───────────────────────────────────────────────
# Minimal app — we don't need the full create_app() (which initializes
# the auth gate, registers the notification worker, etc.) to verify the
# 202 + Location + Retry-After contract on the upload + task routes.
# Mounting just the two relevant blueprints is enough.


@pytest.fixture
def app():
    from flask import Flask
    from web_runner.routes.upload import bp as upload_bp
    from web_runner.routes.tasks import bp as tasks_bp

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024
    app.register_blueprint(upload_bp)
    app.register_blueprint(tasks_bp)
    return app


@pytest.fixture
def client(app):
    return app.test_client()


# ── 1. /api/upload/video returns 202 + Location + Retry-After ────────


def test_upload_video_returns_202_with_location_and_retry_after(client, monkeypatch):
    """POST /api/upload/video → 202 + Location + Retry-After + body task_id.

    Pinned invariants:
      * Status code 202 (not the legacy 200). A 200 here would imply
        "upload is complete" which is a lie for a queue-backed route.
      * Location header points to /api/tasks?task_id=<id>.
      * Retry-After: 2 (matches useTasks' 3s poll cadence).
      * Body data has status="pending" (additive over legacy shape).
    """
    # MIN_UPLOAD_BYTES is 10240 — provide 15KB to clear the floor with
    # a comfortable margin so the future MIN_UPLOAD_BYTES bump
    # (if any) doesn't silently break this fixture.
    file_content = b"x" * (15 * 1024)

    # Capture the executor submission without actually running the
    # subprocess. The upload route uses the legacy `task_executor`
    # (not the new PlatformExecutor) — see web_runner/utils.py ::
    # ``task_executor = ThreadPoolExecutor(max_workers=8, ...)``.
    from web_runner.utils import task_executor

    captured: list[tuple] = []
    monkeypatch.setattr(
        task_executor,
        "submit",
        lambda fn, *args, **kwargs: captured.append((fn, args, kwargs)),
    )

    response = client.post(
        "/api/upload/video",
        data={
            "platform": "douyin",
            "account": "test-acct",
            "title": "Test Video",
            "tags": "tag1,tag2",
            "desc": "test desc",
            "file": (io.BytesIO(file_content), "test.mp4"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 202, f"expected 202, got {response.status_code}: {response.data!r}"
    assert response.headers.get("Location", "").startswith(
        "/api/tasks?task_id="
    ), f"Location header missing or wrong: {response.headers!r}"
    assert (
        response.headers.get("Retry-After") == "2"
    ), f"Retry-After should be '2', got {response.headers.get('Retry-After')!r}"
    body = response.get_json()
    assert body["success"] is True
    assert "task_id" in body["data"], f"task_id missing from body: {body!r}"
    assert body["data"]["status"] == "pending", f"status should be 'pending', got {body['data']!r}"

    # The first arg to _run_sau is the task_id — verify it matches the
    # task_id in the response body so the executor submission is
    # consistent with the 202 contract.
    assert len(captured) == 1
    assert (
        captured[0][1][0] == body["data"]["task_id"]
    ), f"executor.submit task_id {captured[0][1][0]!r} != response task_id {body['data']['task_id']!r}"


# ── 2. /api/upload/note returns 202 + Location + Retry-After ────────


def test_upload_note_returns_202_with_location_header(client, monkeypatch):
    """POST /api/upload/note → 202 + Location + Retry-After + body task_id.

    Note uploads hit a separate blueprint method but share the same
    _make_accepted_response helper, so the contract is identical.
    The 'note' action exercises a different code path (multi-image
    form fields, NOT the platform-specific video flags) so a regression
    here would NOT be caught by the video test above.
    """
    image_content = b"x" * (15 * 1024)

    from web_runner.utils import task_executor

    captured: list[tuple] = []
    monkeypatch.setattr(
        task_executor,
        "submit",
        lambda fn, *args, **kwargs: captured.append((fn, args, kwargs)),
    )

    response = client.post(
        "/api/upload/note",
        data={
            "platform": "xiaohongshu",
            "account": "test-acct",
            "title": "Test Note",
            "note": "body text",
            "tags": "tag1",
            "images_0": (io.BytesIO(image_content), "test.jpg"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 202, f"expected 202, got {response.status_code}: {response.data!r}"
    assert response.headers.get("Location", "").startswith("/api/tasks?task_id=")
    assert response.headers.get("Retry-After") == "2"

    body = response.get_json()
    assert body["data"]["status"] == "pending"
    assert len(captured) == 1
    assert captured[0][1][0] == body["data"]["task_id"]


# ── 3. /api/tasks/add + retry return 202 + Location ─────────────────


def test_tasks_add_returns_202_with_location_header(client, monkeypatch):
    """POST /api/tasks/add → 202 + Location + body task_id.

    The add route uses the new PlatformExecutor.submit (not the
    legacy task_executor). Mock the executor's submit method to
    capture the submission without actually running it.
    """
    from web_runner.executor import get_executor

    captured: list = []
    monkeypatch.setattr(
        get_executor(),
        "submit",
        lambda fn, *args, **kwargs: captured.append(kwargs.get("task_id")),
    )

    response = client.post(
        "/api/tasks/add",
        json={
            "platform": "douyin",
            "action": "upload-video",
            "account": "test-acct",
            "argv": [
                "douyin",
                "upload-video",
                "--account",
                "test-acct",
                "--title",
                "Test",
            ],
        },
    )

    assert response.status_code == 202, f"expected 202, got {response.status_code}: {response.data!r}"
    assert response.headers.get("Location", "").startswith("/api/tasks?task_id=")
    assert response.headers.get("Retry-After") == "2"

    body = response.get_json()
    assert body["data"]["status"] == "pending"
    assert (
        body["data"]["task_id"] in captured
    ), f"task_id {body['data']['task_id']!r} not submitted to executor (captured: {captured!r})"


def test_tasks_retry_returns_202_with_new_task_id(client, monkeypatch):
    """POST /api/tasks/retry → 202 + new task_id (not the source task_id).

    Pins:
      * retry creates a NEW task row + submits it (not a re-run of the
        source — the source stays in 'failed' state for the audit trail)
      * 202 contract applies to the new task_id, not the source
    """
    from web_runner.utils import _db_insert_task
    from web_runner.executor import get_executor

    source_id = f"{_TEST_PREFIX}retry-source"
    now = datetime.now().isoformat(timespec="seconds")
    _db_insert_task(
        task_id=source_id,
        status="failed",
        platform="douyin",
        action="upload-video",
        account="test-acct",
        created=now,
        argv=["douyin", "upload-video", "--account", "test-acct", "--title", "Test"],
    )

    captured: list = []
    monkeypatch.setattr(
        get_executor(),
        "submit",
        lambda fn, *args, **kwargs: captured.append(kwargs.get("task_id")),
    )

    response = client.post(
        "/api/tasks/retry",
        json={"task_id": source_id},
    )

    assert response.status_code == 202
    body = response.get_json()
    new_task_id = body["data"]["task_id"]
    assert new_task_id != source_id, f"retry should create a NEW task_id, got same as source {source_id!r}"
    assert (
        response.headers.get("Location") == f"/api/tasks?task_id={new_task_id}"
    ), f"Location header should point to NEW task_id, got {response.headers.get('Location')!r}"
    assert new_task_id in captured


# ── 4. /api/tasks?task_id=X filter returns just that row ────────────


def test_get_tasks_supports_task_id_filter(client):
    """GET /api/tasks?task_id=X returns exactly the row matching task_id.

    Pinned because the 202 ``Location`` header advertises this exact
    URL shape; a regression here would silently break the polling
    client even though the 202 itself still looks correct.
    """
    from web_runner.utils import _db_insert_task

    target_id = f"{_TEST_PREFIX}filter-target"
    other_id = f"{_TEST_PREFIX}filter-other"
    now = datetime.now().isoformat(timespec="seconds")
    _db_insert_task(
        task_id=target_id,
        status="pending",
        platform="douyin",
        action="upload-video",
        account="a",
        created=now,
    )
    _db_insert_task(
        task_id=other_id,
        status="pending",
        platform="bilibili",
        action="upload-video",
        account="b",
        created=now,
    )

    response = client.get(f"/api/tasks?task_id={target_id}")
    assert response.status_code == 200
    body = response.get_json()
    assert len(body["data"]) == 1, f"expected 1 row for task_id filter, got {len(body['data'])}: {body['data']!r}"
    assert body["data"][0]["task_id"] == target_id


# ── 5. PlatformExecutor.load_pending_tasks — restart recovery ────────


def _mock_executor_submit(monkeypatch):
    """Replace PlatformExecutor.submit with a list-append capture.

    Bypasses the supervisor thread entirely so we can inspect what
    load_pending_tasks would have queued, deterministically, without
    racing the 1-second supervisor poll cycle.
    """
    from web_runner.executor import get_executor

    captured: list[str] = []
    monkeypatch.setattr(
        get_executor(),
        "submit",
        lambda fn, *args, **kwargs: captured.append(kwargs.get("task_id", "")),
    )
    return captured


def test_load_pending_tasks_picks_up_unscheduled_pending(monkeypatch):
    """HEADLINE FIX of the round: pending task with ``scheduled_at IS NULL``
    must be recovered on startup.

    Pre-OPT-async-202 the loader SQL was::

        WHERE status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= ?

    which silently DROPPED the much larger class of unscheduled
    pending tasks (the common case from /api/upload/* + /api/tasks/add).
    A server restart in the window between accept and execute would
    lose the work. The new SQL is::

        WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?)

    This test pins the fix by inserting a pending task with NULL
    scheduled_at, calling load_pending_tasks, and asserting the
    task was submitted to the executor.
    """
    from web_runner.utils import _db_insert_task

    captured = _mock_executor_submit(monkeypatch)
    task_id = f"{_TEST_PREFIX}unscheduled-recovery"
    _db_insert_task(
        task_id=task_id,
        status="pending",
        platform="douyin",
        action="upload-video",
        account="test-acct",
        created=datetime.now().isoformat(timespec="seconds"),
    )

    from web_runner.executor import get_executor

    get_executor().load_pending_tasks()

    assert task_id in captured, (
        f"unscheduled pending task {task_id!r} should be recovered on startup, "
        f"got captured: {captured!r}. A regression here means a server restart "
        f"loses the most common task class — the round's headline bug."
    )


def test_load_pending_tasks_ignores_future_scheduled(monkeypatch):
    """Pending task with scheduled_at in the future must NOT be recovered.

    Regression guard: the broader SQL is more permissive (it now
    matches ``scheduled_at IS NULL``), but the future-scheduled branch
    is the same as before. If a future refactor drops the ``<= ?``
    half by accident, this test catches it.
    """
    from web_runner.utils import _db_insert_task, _db_update_task

    captured = _mock_executor_submit(monkeypatch)
    task_id = f"{_TEST_PREFIX}future-scheduled"
    future = (datetime.now() + timedelta(hours=2)).isoformat(timespec="seconds")
    _db_insert_task(
        task_id=task_id,
        status="pending",
        platform="douyin",
        action="upload-video",
        account="test-acct",
        created=datetime.now().isoformat(timespec="seconds"),
    )
    _db_update_task(task_id, scheduled_at=future)

    from web_runner.executor import get_executor

    get_executor().load_pending_tasks()

    assert task_id not in captured, (
        f"future-scheduled task {task_id!r} should NOT be recovered now, "
        f"got captured: {captured!r}. A future-scheduled task picked up "
        f"prematurely would publish before its window opens."
    )


def test_load_pending_tasks_picks_up_due_scheduled(monkeypatch):
    """Pending task with scheduled_at in the past SHOULD be recovered.

    Pairs with the previous test: a due-scheduled task is the original
    use case load_scheduled_tasks was designed for; the broader
    unscheduled-recovery addition must NOT regress this.
    """
    from web_runner.utils import _db_insert_task, _db_update_task

    captured = _mock_executor_submit(monkeypatch)
    task_id = f"{_TEST_PREFIX}due-scheduled"
    past = (datetime.now() - timedelta(minutes=5)).isoformat(timespec="seconds")
    _db_insert_task(
        task_id=task_id,
        status="pending",
        platform="douyin",
        action="upload-video",
        account="test-acct",
        created=datetime.now().isoformat(timespec="seconds"),
    )
    _db_update_task(task_id, scheduled_at=past)

    from web_runner.executor import get_executor

    get_executor().load_pending_tasks()

    assert task_id in captured, (
        f"due-scheduled task {task_id!r} should be recovered on startup, " f"got captured: {captured!r}"
    )
