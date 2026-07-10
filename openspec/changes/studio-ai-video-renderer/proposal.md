# AI Video Generation Backend (Companion to Visual Style Presets)

## Why

The companion PR (`studio-visual-presets`) ships 3 local-render
Visual Style Presets via the existing Remotion Node bridge. That
PR is **bounded** to producer-side parameterisation — palette,
typography, motion — but **not** to the underlying pixel content
itself.

Operators still need to extend the catalog with **real generative
video**: shots written by
**Kling (可灵)** / **Sora** / **Veo 3** / **Runway** /
**Zhipu GLM-Video**, with per-prompt control and time-of-day
asynchronous rendering. Without this PR the "AI 视频模型选择"
feature promised on the visual-presets landing page remains
incomplete.

This proposal drafts the openspec scaffold for that next-PR — not
the code. It is intentionally kept in a separate openspec change
folder (`openspec/changes/studio-ai-video-renderer/`) so the two
scopes can land independently: visual-presets ships today without
waiting on vendor API keys, permissions, or quota plumbing;
ai-video-renderer lands once ops signs off on Kling's pricing.

## What changes (DRAFTED — code lands in a separate PR)

* **Backend** (Python):
  * `StudioRenderBackend` Protocol interface in
    `web_runner/studio_backends/` package — `RemotionBackend`,
    `KlingBackend`, `ZhipuGLMVideoBackend` are concrete impls.
  * Per-project `studio_projects.preferred_backend` JSONB or
    `studio_projects.render_config.preferred_backend` (using the
    existing forward-compat slot from the visual-presets PR).
  * Provider-agnostic quota + key management — admin sets
    `kling_api_key` / `zhipu_api_key` via the existing
    `ai_api_keys` table (round-AI-paywall from the
    `usage_metering` middleware).
  * Per-project safety: operationally-pinned quota (e.g. 5
    seconds of Kling render per free user / month) with a
    Remotion silent-fallback on exhaustion.

* **Remotion** (TS): no change in this PR-scaffold; the picker
  UI just adds a second dropdown ("Renderer: Remotion / Kling
  (生成式) / Zhipu GLM-Video").

* **Frontend page** (`StudioDetailPage.tsx`): second dropdown;
  the existing "渲染成片" button routes via
  `<Renderer>::render(episodes, preset)` callable.

* **Tests / OpenSpec**: full extent covered in
  `openspec/changes/studio-ai-video-renderer/specs/studio-ai-video\
  -renderer/spec.md` (DRAFTED — see companion file).

## Why now

The catalog (visual-presets) already routes through
`render_config[<some_vendor_field>]` — adding a `preferred_backend`
field rides the same JSONB dict without a second schema
migration. **The catalog PR's "future per-renderer fields ride
this same JSONB dict without an ALTER round-trip" claim is
realised here.**

## Vendor shortlist (LLM-documented, ops chooses)

| Vendor           | Why considered                                                  | Why primary vs. backup |
| ---------------- | --------------------------------------------------------------- | --------------------- |
| **Kling (可灵)** | 国内直连 · 中文提示词理解最佳 · 9:16 short-form native · 价格友好 | **PRIMARY**            |
| Zhipu GLM-Video | 国内合规备选 · 文生视频 · 队列异步                               | **FALLBACK**           |
| Sora (OpenAI)    | 顶级质量 · 但国内访问受限 + 价格偏高 · 海外代理合规风险          | Out of scope for v1   |
| Runway Gen-3     | 海外生态好 · 国内直连不易 · 中文支持弱                           | Out of scope for v1   |
| Veo 3 (Google)   | 顶级质量 · 国内 GCP 访问受限                                     | Out of scope for v1   |

## Status of the openspec scaffold

This folder ships with `proposal.md` + `tasks.md` + `spec.md` in
**DRAFT** state — **NO CODE** in this PR. The openspec exists so
the design conversation (vendor selection, fallback semantics,
quota policy) can run in parallel while visual-presets lands.

When ops / engineering signs off, a follow-up PR opens against
this folder, populates `_index.json`'s `status: "approved"`, and
ships the `StudioRenderBackend` implementation + adapters + tests
one render at a time.

## Out of scope

* Onboarding / first-time setup for the vendor APIs. The
  visual-presets PR's `.env.example` already enumerates the
  OpenRouter / Pexels / Pixabay keys; this PR adds `KLING_API_KEY`
  alongside (one `.env` line per vendor).
* Per-account tier-gating on verbose vendor UIs. That's a
  follow-up (use the existing `usage_metering.py` middleware).
