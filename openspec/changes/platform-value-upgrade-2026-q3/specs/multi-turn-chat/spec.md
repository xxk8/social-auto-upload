# multi-turn-chat (Delta) Specification

## Overview

Modifications to the existing `multi-turn-chat` capability: AI call tier gating and quota enforcement.

## Changes

### C1: AI tier gating

- **Current**: All users share community OpenRouter keys, no limits
- **New**: Free tier users share community key with rate limits. Pro tier users can configure their own OpenRouter key (unlimited).

**Behavior**:
- Free tier: Uses existing `ai_api_keys` table keys. Quota: 10 AI generations per day (via usage-metering).
- Pro tier: Can add personal OpenRouter key in settings. No quota. Key stored in `ai_api_keys` with `user_id` binding.
- Legacy tier: Same as Pro.

### C2: AI quota check in generation endpoints

- **Middleware**: Same `usage_metering` middleware as publish, but checks `ai_generate` action
- **Endpoints affected**: `POST /api/ai/generate`, `POST /api/ai/generate/stream`
- **429 response**: `{ success: false, error: "quota_exceeded", action: "ai_generate", limit: 10, used: 10 }`

### C3: Personal key management for Pro users

- **Settings page**: "AI 配置" section showing:
  - Current key status (community / personal)
  - "添加个人 Key" button (Pro only)
  - Key input field + "保存" button
  - Existing key management UI (OPT-J improved version: collapsed into Popover)
- **Storage**: Personal keys stored in `ai_api_keys` with `user_id` binding
- **Priority**: If user has personal key, use it first. Fall back to community keys.

### C4: Free tier model restrictions

- **Current**: All free models available (Gemma 4, DeepSeek V3, Qwen3)
- **New**: Free tier limited to 2 models (e.g., Gemma 4, Qwen3). Pro tier gets all models including DeepSeek V3.
- **Config**: `FREE_TIER_MODELS = ['google/gemma-4-27b-it:free', 'qwen/qwen3-235b-a22b:free']`
- **Frontend**: Model selector shows lock icon on restricted models for free users

## API Changes

```
GET /api/ai/models
Response change: {
  models: [
    { id: "...", name: "...", tier: "free" | "pro" },
    ...
  ]
}
```

## Database

No schema changes. Uses existing `ai_api_keys` table and `usage_logs` (from usage-metering spec).

## Acceptance Criteria

- [ ] Free user generates 10 AI responses → 11th returns 429 → frontend shows upgrade prompt
- [ ] Pro user with personal key → unlimited AI → uses personal key first
- [ ] Free user → model selector shows 2 models → Pro user sees all models
- [ ] Pro user removes personal key → falls back to community keys
- [ ] AI sidebar shows quota indicator for free tier: "今日剩余: 7/10"
