## ADDED Requirements

### Requirement: Migrate SQLite to PostgreSQL 20 (openspec delta-format stub)
The `Migrate SQLite to PostgreSQL 20` capability is added by openspec change `migrate-sqlite-to-postgresql-20`. This file is a delta-format stub; the full behavior contract is in the change's `tasks.md` (SAVEPOINT-backed nested transactions + pool tuning). The system MUST satisfy this contract per the change's tasks.md.

#### Scenario: Standard execution path (stub)
- **WHEN** the `Migrate SQLite to PostgreSQL 20` workflow is invoked per `openspec/changes/migrate-sqlite-to-postgresql-20/tasks.md`
- **THEN** the system MUST satisfy the behavioral contract documented in `openspec/changes/migrate-sqlite-to-postgresql-20/tasks.md`
