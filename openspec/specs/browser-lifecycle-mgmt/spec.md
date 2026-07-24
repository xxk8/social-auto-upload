# browser-lifecycle-mgmt Specification

## Purpose

在 `uploader/common.py` 中提供 `managed_browser()` 异步上下文管理器，统一各 uploader 的 patchright 浏览器启动、cookie 加载、stealth JS 注入和关闭流程。

## Requirements

### Requirement: managed_browser context manager

The system SHALL provide `managed_browser(...)` that launches patchright Chromium, creates a context with storage_state, injects stealth via `set_init_script()`, yields the context, and on exit closes context and browser.

#### Scenario: Upload uses managed browser
- **WHEN** an uploader runs `async with managed_browser(...) as context`
- **THEN** cookie-backed context is available and resources are released when the block ends

### Requirement: managed_browser_for_login variant

The system SHALL provide `managed_browser_for_login(...)` that does not load cookies and yields `(context, browser)` so login can save cookies after success.

#### Scenario: Login without prior cookie
- **WHEN** a login flow uses `managed_browser_for_login`
- **THEN** a fresh context is provided without loading an existing account file

### Requirement: Gradual uploader migration

Uploaders SHALL migrate to `async with managed_browser(...)` without changing page-interaction logic or cookie file format. Cleanup SHALL run so exceptions still close the browser.

#### Scenario: At least douyin and kuaishou migrated
- **WHEN** the capability is archived as implemented
- **THEN** at least douyin and kuaishou uploaders use `managed_browser()`

## Acceptance Criteria

- [x] `uploader/common.py` 新增 `managed_browser()` 和 `managed_browser_for_login()` 函数
- [x] 至少 2 个 uploader（douyin、kuaishou）迁移使用 `managed_browser()`
- [x] 浏览器异常退出可清理
- [x] Implementation complete (pytest verify locally)
