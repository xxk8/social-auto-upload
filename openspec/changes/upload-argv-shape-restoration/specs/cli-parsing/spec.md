# cli-parsing · ADDED Requirements

## ADDED Requirements

### Requirement: Web publish argv shape parity with CLI parser
The Web API publish route SHALL build a `sau <platform> upload-video ...` argv that is accepted by `cli/parser.py::build_parser(platform, action)`. Every flag the parser declares as supported SHALL be passed through the Web route when the corresponding request body field is set; no flag the parser doesn't accept SHALL be passed.

#### Scenario: Bilibili publish with --tid, --tags, --headless
- **WHEN** POST `/api/upload/video` carries platform=bilibili, account=test, file=test.mp4, title=foo, tags=[a,b], tid=99999, headless=true
- **THEN** the spawned CLI argv is `["sau", "bilibili", "upload-video", "--account", "test", "--file", "test.mp4", "--title", "foo", "--tags", "a,b", "--tid", "99999", "--headless"]`

#### Scenario: Tencent with product-link and product-title
- **WHEN** platform=tencent and request body has `product_link` and `product_title` set
- **THEN** the spawned argv includes `--product-link <link>` AND `--product-title <title>`

#### Scenario: Tencent with empty product fields
- **WHEN** platform=tencent and request body has neither `product_link` nor `product_title` set
- **THEN** the spawned argv MUST NOT include either `--product-link` or `--product-title`

#### Scenario: Douyin + Tencent dual thumbnail
- **WHEN** platform=douyin OR platform=tencent and request body has `thumbnail_url` and `dynamic_cover`
- **THEN** the spawned argv includes BOTH `--thumbnail-url <url>` AND `--dynamic-cover <url>`

#### Scenario: Kuaishou never gets dual thumbnail
- **WHEN** platform=kuaishou and request body has `thumbnail_url` set
- **THEN** the spawned argv does NOT include `--thumbnail-url`
- **AND** the spawned argv does NOT include `--dynamic-cover`

#### Scenario: Empty thumbnail is not passed
- **WHEN** platform=douyin and request body has `thumbnail` field set to empty string
- **THEN** the spawned argv does NOT include `--thumbnail`

#### Scenario: Browser platforms get --headless by default
- **WHEN** platform is in `requires_browser: true` set (`{bilibili, tencent, douyin, kuaishou, xiaohongshu, tiktok}`) and request body has no `headless` key
- **THEN** the spawned argv includes `--headless`

#### Scenario: --headless absent when not sent for non-browser platforms
- **WHEN** platform is `baijiahao` and request body has no `headless` key
- **THEN** the spawned argv does NOT include `--headless`

#### Scenario: Missing required field returns 400
- **WHEN** request body is missing `platform` OR `account` OR `title` OR `file`
- **THEN** HTTP response is 400 with `success: False` and a Chinese message identifying the missing field
- **AND** no CLI subprocess is spawned

#### Scenario: Schedule timestamp in the past runs immediately
- **WHEN** request body has `schedule` set to a past `YYYY-MM-DD HH:MM` value
- **THEN** the spawned argv includes `--schedule <past>` (no special-casing; CLI decides)

#### Scenario: Baseline parity (no extras)
- **WHEN** request body has only the minimum required fields
- **THEN** the spawned argv contains exactly `--account <a> --file <f> --title <t>` plus platform-mandated flags
