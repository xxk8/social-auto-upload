## MODIFIED Requirements

### Requirement: dispatch() SHALL use table-driven dispatch
The `dispatch()` function in `cli/dispatchers.py` SHALL use a `PLATFORM_REGISTRY` dictionary mapping platform names to async handler functions. Each handler function SHALL accept an `argparse.Namespace` and return an `int` exit code.

#### Scenario: Adding a new platform
- **WHEN** a new platform handler function is added to `PLATFORM_REGISTRY`
- **THEN** `dispatch()` SHALL route to the new handler without modifying the dispatch function body

#### Scenario: Unknown platform
- **WHEN** an unknown platform name is provided in `args.platform`
- **THEN** `dispatch()` SHALL raise `RuntimeError` with a message listing valid platforms from `PLATFORM_REGISTRY.keys()`

#### Scenario: All 7 platforms are registered
- **WHEN** the CLI starts
- **THEN** `PLATFORM_REGISTRY` SHALL contain entries for: `douyin`, `kuaishou`, `xiaohongshu`, `bilibili`, `tencent`, `tiktok`, `baijiahao`

## ADDED Requirements

### Requirement: All request models SHALL default `debug` to `False`
Every dataclass in `cli/models.py` that has a `debug` field SHALL default it to `False`. This includes `DouyinVideoUploadRequest`, `DouyinNoteUploadRequest`, `KuaishouVideoUploadRequest`, `KuaishouNoteUploadRequest`, `XiaohongshuVideoUploadRequest`, `XiaohongshuNoteUploadRequest`, `BilibiliNoteUploadRequest`, `TencentVideoUploadRequest`, `TencentNoteUploadRequest`, `TiktokVideoUploadRequest`, `BaijiahaoVideoUploadRequest`.

#### Scenario: Default upload runs without debug
- **WHEN** a `DouyinVideoUploadRequest` is created without specifying `debug`
- **THEN** `request.debug` SHALL be `False`

#### Scenario: Explicit debug flag overrides default
- **WHEN** a `DouyinVideoUploadRequest` is created with `debug=True`
- **THEN** `request.debug` SHALL be `True`

### Requirement: `BilibiliVideoUploadRequest` SHALL have `debug` and `headless` fields
The `BilibiliVideoUploadRequest` dataclass SHALL include `debug: bool = False` and `headless: bool = True` fields, matching all other video upload request models.

#### Scenario: Bilibili video upload with debug and headless flags
- **WHEN** `sau bilibili upload-video --account test --file test.mp4 --title test --desc test --tid 249 --debug --headed` is executed
- **THEN** the `BilibiliVideoUploadRequest` SHALL receive `debug=True` and `headless=False`

#### Scenario: Bilibili video upload defaults
- **WHEN** `BilibiliVideoUploadRequest` is created with only required fields
- **THEN** `debug` SHALL be `False` and `headless` SHALL be `True`
