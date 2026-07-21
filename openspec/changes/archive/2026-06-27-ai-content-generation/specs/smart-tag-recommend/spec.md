## ADDED Requirements

### Requirement: Tag recommendation from content

The system SHALL provide a mechanism to generate tag recommendations based on a title and optional description, using the existing AI streaming infrastructure.

#### Scenario: Generate tags from title only

- **WHEN** the frontend calls the tag recommendation hook with `title: "Python爬虫3分钟学会"`
- **THEN** the hook constructs a prompt asking the LLM to recommend 5-10 relevant tags for the given title
- **AND** streams the response via the existing `/api/ai/generate/stream` endpoint
- **AND** parses the response as a JSON array of tag strings

#### Scenario: Generate tags from title and description

- **WHEN** the frontend calls the tag recommendation hook with `title: "..."` and `description: "..."`
- **THEN** both title and description are included in the prompt context
- **AND** the LLM generates tags relevant to the full content

#### Scenario: Platform-aware tag recommendation

- **WHEN** the frontend specifies a `platform` (e.g., `"xiaohongshu"`)
- **THEN** the prompt SHALL include platform-specific tag style guidance (e.g., xiaohongshu uses hashtags with emoji, douyin uses short keywords)

#### Scenario: Parse JSON array from LLM response

- **WHEN** the LLM returns `["标签1", "标签2", "标签3"]`
- **THEN** the hook extracts the array and returns it as `string[]`

#### Scenario: Parse JSON array embedded in text

- **WHEN** the LLM returns text containing a JSON array (e.g., wrapped in code fences)
- **THEN** the hook SHALL extract the array using regex pattern `\[[\s\S]*\]`
- **AND** parse the extracted array

#### Scenario: Unparseable response fallback

- **WHEN** the LLM response cannot be parsed as a JSON array
- **THEN** the hook SHALL return an empty array `[]`

### Requirement: Tag chip UI with click-to-add

The frontend SHALL display recommended tags as clickable chips that add the tag to the form's tag input.

#### Scenario: Tags displayed as chips after recommendation

- **WHEN** tag recommendation completes with tags `["python", "教程", "编程"]`
- **THEN** three chip components are rendered below the tag input
- **AND** each chip displays the tag text

#### Scenario: Click chip adds tag to form

- **WHEN** the user clicks a chip with text `"python"`
- **THEN** `"python"` is added to the form's tag list (if not already present)
- **AND** the chip is visually marked as "selected" (e.g., different background color)

#### Scenario: Click selected chip removes tag

- **WHEN** the user clicks a chip that is already selected
- **THEN** the tag is removed from the form's tag list
- **AND** the chip returns to unselected state

#### Scenario: Loading state during recommendation

- **WHEN** tag recommendation is in progress
- **THEN** a loading indicator (skeleton chips or spinner) is displayed
- **AND** the "recommend tags" button is disabled

### Requirement: Tag recommendation trigger

The tag recommendation SHALL be triggered manually by the user, not automatically.

#### Scenario: Manual trigger via button

- **WHEN** the user clicks the "推荐标签" button next to the tag input
- **THEN** tag recommendation starts using the current title and description values
- **AND** existing recommended chips are replaced with new results

#### Scenario: Button disabled when title is empty

- **WHEN** the title input is empty
- **THEN** the "推荐标签" button is disabled
