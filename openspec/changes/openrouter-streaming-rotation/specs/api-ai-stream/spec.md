# api-ai-stream · ADDED Requirements

## ADDED Requirements

### Requirement: OpenRouter 429 key-rotation streaming contract
The AI streaming endpoint SHALL rotate the API key from the next available row in the `ai_api_keys` table on HTTP 429 responses. Retries emit partial-response SSE `data:` events; once all keys have returned 429, the system MUST emit a terminal `data: {"error": "exhaustion"}` event.

#### Scenario: Single 429 with next available key
- **WHEN** OpenRouter returns HTTP 429 on key K[0]
- **THEN** the system retries with key K[1] (next in `ai_api_keys` rotation order)
- **AND** the SSE stream emits a partial-content event before the retry boundary

#### Scenario: All keys 429 (exhaustion)
- **WHEN** OpenRouter returns HTTP 429 on every key K[0] through K[N-1]
- **THEN** the SSE stream emits exactly one terminal `data: {"error": "exhaustion: all keys 429"}` event
- **AND** HTTP response status remains 200 (SSE convention; error lives inside the stream)

#### Scenario: 401 (auth fail) does NOT rotate
- **WHEN** OpenRouter returns HTTP 401 on key K[0]
- **THEN** the SSE stream emits `data: {"error": "auth: invalid key"}`
- **AND** the system does NOT retry with K[1] (auth failures don't trigger rotation)

#### Scenario: 500 internal error emits error event
- **WHEN** OpenRouter returns HTTP 500 on key K[0]
- **THEN** the SSE stream emits `data: {"error": "upstream: 500"}`
- **AND** no rotation is attempted (5xx is not retryable per key-rotation policy)

#### Scenario: Connection error emits error event
- **WHEN** `requests.post` raises `requests.exceptions.ConnectionError` on key K[0]
- **THEN** the SSE stream emits `data: {"error": "connection: <reason>"}`
- **AND** no rotation is attempted

#### Scenario: No keys available
- **WHEN** `ai_api_keys` table is empty
- **THEN** the SSE stream emits `data: {"error": "no_keys_available"}` BEFORE any OpenRouter call
- **AND** HTTP response status is 200 (SSE convention)

#### Scenario: key_info event ordering
- **WHEN** the SSE stream begins
- **THEN** the FIRST emitted event is `data: {"key_info": {"idx": i, "masked": "sk-...xxxx"}}`
- **AND** subsequent events are content chunks `data: {"content": "..."}`

#### Scenario: model param passed through
- **WHEN** request body has `model: "anthropic/claude-3-opus"` (or any OpenRouter model id)
- **THEN** the request to OpenRouter includes the `model` query/body parameter unmodified

#### Scenario: max_tokens and temperature passed through
- **WHEN** request body has `max_tokens: 4096` and `temperature: 0.7`
- **THEN** the OpenRouter request body includes `max_tokens: 4096` and `temperature: 0.7`

#### Scenario: Default max_tokens and temperature
- **WHEN** request body has no `max_tokens` and no `temperature`
- **THEN** the OpenRouter request body includes the project defaults (1000 / 1.0 per `cli/platforms/ai.py`)

#### Scenario: connect_timeout is a tuple
- **WHEN** the AI streaming helper constructs `requests.post(url, ..., timeout=...)`
- **THEN** the `timeout` keyword argument is `(connect_timeout, read_timeout)` — a 2-tuple — not a scalar
