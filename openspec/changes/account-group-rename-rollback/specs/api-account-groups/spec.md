# api-account-groups · ADDED Requirements

## ADDED Requirements

### Requirement: Account Group Rename Atomicity
The system SHALL perform an account group rename as a single atomic operation across filesystem and database state. When any filesystem rename step fails, the system MUST rollback all prior filesystem renames AND abort the database transaction, returning HTTP 409 with a structured message.

#### Scenario: Mid-flight permission error on second file rename
- **WHEN** a rename request affects 2 platforms' cookie files and the second `os.rename` raises `PermissionError`
- **THEN** the first `os.rename` MUST be reversed via `os.rename(new, old)`
- **AND** the database transaction MUST be aborted with no row writes
- **AND** HTTP response is 409 with `success: False` and a message identifying the interruption

#### Scenario: Happy-path rename across N platforms
- **WHEN** a rename request affects N platforms and all `os.rename` calls succeed
- **THEN** all filesystem renames complete in order
- **AND** the database `account_authorizations.cookie_file` rows are updated atomically
- **AND** HTTP response is 200 with `success: True` and updated `name` in `data`

#### Scenario: Rename with no authorizations
- **WHEN** a rename request targets a group with zero `account_authorizations` rows
- **THEN** no filesystem rename is performed
- **AND** the database `account_groups.name` row updates atomically
- **AND** HTTP response is 200

#### Scenario: Rename with non-QR (tiktok / baijiahao) ignored
- **WHEN** a rename request affects only tiktok / baijiahao cookie files (no QR-platform rows)
- **THEN** filesystem renames succeed for those paths
- **AND** the DB update atomically updates the affected rows
- **AND** HTTP response is 200
