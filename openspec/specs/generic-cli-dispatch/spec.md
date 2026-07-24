# generic-cli-dispatch Specification

## Purpose

配置驱动的通用 CLI 平台分发机制，通过 `PLATFORM_HANDLERS` 字典和 `_dispatch_platform()` 通用函数替代 7 个重复的 `_dispatch_*` 函数。

## Requirements

### Requirement: PLATFORM_HANDLERS configuration

The system SHALL maintain a `PLATFORM_HANDLERS` dictionary that maps each platform name to a handler configuration containing login/check/upload_video/upload_note function references, request classes, publish strategy mapping, and platform-specific argument builders.

#### Scenario: All seven platforms are registered
- **WHEN** CLI dispatch resolves a platform name
- **THEN** `PLATFORM_HANDLERS` SHALL include configuration for douyin, kuaishou, xiaohongshu, bilibili, tencent, tiktok, and baijiahao

### Requirement: Generic platform dispatch

The system SHALL provide `_dispatch_platform(args, handler)` that handles login, check, upload-video, and upload-note for any registered platform. `dispatch(args)` SHALL look up `PLATFORM_HANDLERS` and call `_dispatch_platform`.

#### Scenario: Existing CLI commands keep behavior
- **WHEN** a user runs `sau douyin login` or `sau bilibili upload-video` (or any existing `sau <platform> <action>`)
- **THEN** behavior SHALL match the pre-refactor platform-specific dispatchers

#### Scenario: Platform-specific flags still work
- **WHEN** platform-specific args such as `--product-link`, `--tid`, `--draft`, or `--short-title` are provided
- **THEN** they SHALL be injected via extra builders and processed as before

### Requirement: Adding a platform is config-only

Adding a new platform SHALL require only (1) `cli/platforms/<platform>.py` and (2) one entry in `PLATFORM_HANDLERS`, without new per-platform `_dispatch_*` functions. External CLI syntax and `cli/parser.py` / platform module signatures SHALL remain unchanged.

## Acceptance Criteria

- [x] `cli/dispatchers.py` 行数从 378 行减少到 <200 行
- [x] 7 个 `_dispatch_*` 函数合并为 1 个 `_dispatch_platform` 函数
- [x] 所有现有 CLI 命令行为不变
- [x] 平台特有参数仍然正常工作
- [x] Implementation complete (pytest verify locally)
