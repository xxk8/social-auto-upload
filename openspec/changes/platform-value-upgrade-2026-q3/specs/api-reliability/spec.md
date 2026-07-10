## ADDED Requirements

### Requirement: API Reliability (openspec delta-format stub — see archived content below)
The `API Reliability` capability is added by openspec change `platform-value-upgrade-2026-q3`. This file is currently a delta-format stub created during a wholesale `## 概述 → ## ADDED Requirements` migration; the authoritative pre-migration specification is preserved verbatim as an indented code block at the bottom of this file. Domain experts should backfill proper Requirement / Scenario entries by reading that archived content. The system MUST satisfy this contract per the change's proposal.md and design.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `API Reliability` workflow is invoked per `openspec/changes/platform-value-upgrade-2026-q3/design.md`
- **THEN** the system MUST satisfy the behavioral contract documented in the archived pre-migration specification below

<Archived pre-migration specification; preserved as a 4-space-indented code block so `## headings` inside it do NOT re-trigger the openspec delta detector>

    # api-reliability (Delta) Specification
    
    ## Overview
    
    Modifications to the existing `api-reliability` capability: per-platform concurrency limits in the task executor, persistent scheduled tasks, composite database indexes, and the scheduled task reschedule endpoint.
    
    ## Changes
    
    ### C1: Per-platform concurrency limits
    
    - **Current**: Fixed `ThreadPoolExecutor(max_workers=8)` with no per-platform control
    - **New**: Platform-specific semaphores controlling max concurrent uploads per platform
    - **Default limits**:
      ```python
      PLATFORM_CONCURRENCY = {
          'douyin': 2,      # aggressive anti-bot
          'kuaishou': 2,
          'xiaohongshu': 2,
          'bilibili': 3,     # more lenient
          'tencent': 2,
          'tiktok': 2,
          'baijiahao': 2,
      }
      ```
    - **Config**: Overridable via env vars: `SAU_CONCURRENT_DOUYIN=3`
    - **Implementation**: `threading.Semaphore` per platform, acquired before task execution, released after completion
    
    ### C2: Priority task queue
    
    - **Current**: Tasks processed in submission order (FIFO)
    - **New**: `queue.PriorityQueue` with priority levels:
      - `0` = scheduled tasks (lowest — execute at their scheduled time)
      - `1` = normal tasks
      - `2` = retried tasks (highest — user explicitly requested retry)
    - **Supervisor thread**: Single thread polling queue every 1 second, checking if scheduled tasks are due
    
    ### C3: Persistent scheduled tasks
    
    - **Current**: `threading.Timer` schedules are lost on process restart
    - **New**: Scheduled tasks stored in DB with `scheduled_at` column. On startup, supervisor loads all `status='pending' AND scheduled_at IS NOT NULL AND scheduled_at <= now` tasks into the queue.
    - **DB change**:
      ```sql
      ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN scheduled_at TIMESTAMP;
      CREATE INDEX idx_tasks_pending_scheduled ON tasks(status, scheduled_at)
        WHERE status = 'pending' AND scheduled_at IS NOT NULL;
      ```
    
    ### C4: Composite analytics index
    
    - **Purpose**: Support fast GROUP BY queries for analytics dashboard
    - **SQL**:
      ```sql
      CREATE INDEX idx_tasks_analytics ON tasks(platform, status, created_at);
      ```
    
    ### C5: Scheduled task reschedule endpoint
    
    ```
    POST /api/tasks/reschedule
    Request: { task_id: string, new_scheduled_at: string }  // ISO 8601
    Response: { success: true, task: { ...updated task... } }
    Errors:
      - 400: new_scheduled_at is in the past
      - 404: task_id not found
      - 409: task is not in 'pending' status
    ```
    
    ## Migration
    
    - Add `priority` and `scheduled_at` columns with defaults — no data migration needed
    - Create indexes — online DDL, no downtime
    - Existing `ThreadPoolExecutor` code replaced by new executor — same external interface (`submit_task()`, `retry_task()`)
    
    ## Acceptance Criteria
    
    - [ ] Submit 5 Douyin tasks simultaneously → only 2 run concurrently → rest queue
    - [ ] Schedule task for future → restart server → task still executes at scheduled time
    - [ ] Retry task → gets priority over normal queue
    - [ ] Analytics query with 10K tasks → returns in < 100ms (index hit)
    
