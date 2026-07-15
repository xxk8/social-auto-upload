# multi-platform-generate Specification

## Purpose
Multi-platform structured content generation — input a topic, receive adapted title/description/tags for each target platform.

## Requirements
### Requirement: Multi-platform structured content generation endpoint

The system SHALL expose a `POST /api/ai/generate/multi-platform` endpoint that accepts a topic and a list of target platforms, and returns structured content (title, description, tags) for each platform.

#### Scenario: Successful multi-platform generation

- **WHEN** the client POSTs `{ "topic": "Python爬虫教程", "platforms": ["douyin", "xiaohongshu"], "model": "google/gemma-4-26b-a4b-it:free" }`
- **THEN** the endpoint returns an SSE stream
- **AND** each platform receives an `event: platform_result` with `data: { "platform": "<name>", "title": "...", "description": "...", "tags": ["..."] }`
- **AND** a final `event: done` is sent with `data: { "results": { "douyin": {...}, "xiaohongshu": {...} } }`

#### Scenario: Platform-specific style adaptation

- **WHEN** the client requests generation for `"platforms": ["douyin", "xiaohongshu"]`
- **THEN** the douyin result SHALL use short, punchy copy style (简洁有力，有 hook)
- **AND** the xiaohongshu result SHALL use seed/recommendation style (种草风格，有真实感)

#### Scenario: Partial platform failure does not block others

- **WHEN** generation for one platform fails (API error, JSON parse failure)
- **THEN** the failed platform receives an `event: platform_error` with `data: { "platform": "<name>", "error": "..." }`
- **AND** other platforms continue generating normally
- **AND** the final `event: done` includes results for successful platforms only

#### Scenario: Empty platforms list is rejected

- **WHEN** the client POSTs with `"platforms": []`
- **THEN** the endpoint returns `400` with `{ "success": false, "message": "At least one platform is required" }`

#### Scenario: Unsupported platform is rejected

- **WHEN** the client POSTs with `"platforms": ["unknown_platform"]`
- **THEN** the endpoint returns `400` with `{ "success": false, "message": "Unsupported platform: unknown_platform" }`

### Requirement: Platform style prompt templates

The system SHALL maintain a mapping of platform-specific system prompts that instruct the LLM to generate content in that platform's native style.

#### Scenario: Prompt template covers all supported platforms

- **WHEN** a generation request arrives for any platform in `["douyin", "xiaohongshu", "kuaishou", "bilibili", "tencent", "tiktok", "baijiahao"]`
- **THEN** a platform-specific system prompt SHALL be used
- **AND** platforms without a specific prompt SHALL fall back to `DEFAULT_SYSTEM_PROMPT`

#### Scenario: Prompt instructs JSON output format

- **WHEN** the system constructs the messages array for any platform
- **THEN** the system prompt SHALL include instructions to return a JSON object with keys `title`, `description`, `tags`
- **AND** the system prompt SHALL specify that `tags` is an array of strings

### Requirement: JSON response parsing with fallback

The system SHALL parse the LLM's text response as JSON, with a fallback strategy for non-JSON responses.

#### Scenario: Clean JSON response

- **WHEN** the LLM returns `{"title": "标题", "description": "描述", "tags": ["tag1", "tag2"]}`
- **THEN** the result is returned as-is

#### Scenario: JSON embedded in text

- **WHEN** the LLM returns text containing a JSON block (e.g., wrapped in ```json code fences or preceded by explanation text)
- **THEN** the system SHALL extract the JSON object using regex pattern `\{[\s\S]*\}`
- **AND** parse the extracted JSON

#### Scenario: Unparseable response fallback

- **WHEN** the LLM response cannot be parsed as JSON after all fallback attempts
- **THEN** the system SHALL return `{ "title": "", "description": "<raw_response>", "tags": [], "parseError": true }`

### Requirement: Concurrent platform generation

The system SHALL generate content for multiple platforms concurrently using a thread pool, bounded by a configurable concurrency limit.

#### Scenario: Parallel execution for multiple platforms

- **WHEN** the client requests generation for 4 platforms
- **THEN** all 4 platform generations SHALL execute concurrently (up to semaphore limit)
- **AND** results stream back as each platform completes (not waiting for all)

#### Scenario: Concurrency limit

- **WHEN** more platforms are requested than the semaphore allows (default 4)
- **THEN** excess platforms SHALL queue and execute as earlier ones complete
