## ADDED Requirements

### Requirement: Upload Result Event Emission
The system MUST emit a structured `UploadEvent` at the single result-decision point in `web_runner/utils.py:_run_sau()` so that upload outcomes are observable by the notification subsystem.

The event MUST be emitted from the existing branches in `_run_sau` (web_runner/utils.py:554-560 for `returncode == 0`, web_runner/utils.py:558-570 for non-zero, web_runner/utils.py:571-589 for `TimeoutExpired` / `OSError` / `ValueError`), NOT from a separate wrapper.

#### Scenario: Successful upload emits upload.success
- **WHEN** `_run_sau` subprocess returns `returncode == 0`
- **THEN** the system emits `UploadEvent(event_type="upload.success", task_id=<task_id>, platform=<tasks.platform>, account=<tasks.account>, title=<from [UPLOAD_RESULT]>, status="success", error_message=None)`
- **AND** `platform`/`account`/`title` are taken from the `tasks` row (web_runner/db.py:1088 `tasks` table has `platform`/`account`) and the parsed `[UPLOAD_RESULT]<json>` stdout via `web_runner/utils.py:_parse_upload_result()`

#### Scenario: Failed upload emits upload.failed
- **WHEN** `_run_sau` subprocess returns non-zero `returncode`
- **THEN** the system emits `UploadEvent(event_type="upload.failed", status="failed", error_message=<stderr or stdout truncated to 500 chars>)`
- **AND** the `error_message` length is capped at 500 characters

#### Scenario: Timed-out or errored upload emits upload.failed
- **WHEN** `_run_sau` raises `subprocess.TimeoutExpired` (web_runner/utils.py:571) or `OSError`/`ValueError` (web_runner/utils.py:581)
- **THEN** the system emits `UploadEvent(event_type="upload.failed", status="error", error_message="Task timed out after 600 seconds" | str(exc))`

#### Scenario: Cookie expiry emits cookie.expired on check
- **WHEN** the `sau <platform> check --account <name>` command (cli/dispatchers.py:58-61, `await <platform>.check(account)`) determines the cookie is invalid (returns False / exit code 1)
- **THEN** the system emits `UploadEvent(event_type="cookie.expired", platform=<platform>, account=<name>)`
- **AND** this event is emitted on the `check` path, independent of the upload-result channel

### Requirement: Webhook Dispatch with Platform Adapters
The system MUST deliver emitted events to configured webhook endpoints using platform-specific adapters (Feishu / DingTalk / WeWork / custom), selected by routing rules.

#### Scenario: Feishu delivery with signed interactive card
- **WHEN** an event is routed to a Feishu webhook (`SAU_FEISHU_WEBHOOK_URL` or a `webhooks_config` row with `platform`/`account` match)
- **THEN** the system POSTs an `interactive` card (`msg_type":"interactive"`) with `header.template` per status (green=success, red=failed) and `timestamp` (ms) + `sign = base64(HMAC-SHA256(key=timestamp+secret, msg=timestamp+"\n"+secret))`
- **AND** requests are sent over HTTPS only

#### Scenario: DingTalk delivery with query-signature
- **WHEN** an event is routed to a DingTalk webhook (`SAU_DINGTALK_WEBHOOK_URL`)
- **THEN** the system POSTs `msgtype":"markdown"` with `timestamp` (ms) and `sign` appended as URL query params (`sign = urlencode(HMAC-SHA256(key=secret, msg=timestamp+"\n"+secret))`)
- **AND** the signature is in the query string, not the body

#### Scenario: WeWork delivery without signature
- **WHEN** an event is routed to a WeWork webhook (`SAU_WEWORK_WEBHOOK_URL`)
- **THEN** the system POSTs `msgtype":"markdown"` / `"text"` with the URL as credential (no signature)
- **AND** the URL is treated as a secret and never returned in full by any API

#### Scenario: Routing by platform/account
- **WHEN** multiple `webhooks_config` rows exist
- **THEN** the most specific match wins: `account+platform` > `platform` > global
- **AND** `.env` values are used as baseline only when no DB row matches

#### Scenario: HTTPS enforced
- **WHEN** a configured webhook URL uses `http://`
- **THEN** the system rejects the delivery and logs an error, without sending the payload

### Requirement: Delivery Reliability
The system MUST guarantee at-least-once delivery with idempotency, retry/backoff, dead-letter, and rate limiting.

#### Scenario: Retry with exponential backoff
- **WHEN** a webhook POST fails (non-2xx or platform `errcode != 0`)
- **THEN** the system retries up to 3 times with exponential backoff (1s → 2s → 4s)
- **AND** `retry_count` is incremented and `delivered`/`delivered_at` updated in the same transaction (notifications table)

#### Scenario: Dead-letter after exhausted retries
- **WHEN** all 3 retries fail
- **THEN** the system sets `final_failed = 1` on the notification row
- **AND** generates an internal `system.webhook_failed` notification visible in the notification center (not sent externally)

#### Scenario: Idempotent deduplication
- **WHEN** the same `(task_id, event_type)` is emitted more than once (e.g. executor retry / concurrency)
- **THEN** the system delivers only once; subsequent emits are skipped if an existing row has `delivered = 1`

#### Scenario: Rate limiting and failure aggregation
- **WHEN** more than the per-channel token-bucket limit (default 20/min, configurable via `SAU_WEBHOOK_AGG_WINDOW`) of `upload.failed` events arrive in the aggregation window (default 60s)
- **THEN** the system aggregates them into a single summary card ("近 N 分钟 M 个任务失败，涉及账号 …")
- **AND** does not send one card per failure

#### Scenario: Replay protection via timestamp
- **WHEN** a signed webhook request's `timestamp` deviates from server time beyond the platform window (Feishu ±3600s)
- **THEN** the system refuses to send and logs the rejection

### Requirement: Delivery Audit Trail
The system MUST record every external webhook delivery in the audit log.

#### Scenario: Delivery recorded
- **WHEN** a notification reaches `delivered = 1` or `final_failed = 1`
- **THEN** the system writes an audit entry recording channel, event_type, task_id, and timestamp
- **AND** the audit entry does NOT include the webhook secret or full URL
