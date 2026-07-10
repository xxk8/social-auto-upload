import { describe, expect, it } from 'vitest'
import {
  CHARS_PER_SEC,
  FADE_SEC,
  MAX_SCENE_SEC,
  MIN_SCENE_SEC,
  FPS,
  sceneDurationFrames,
  sceneDurationSec,
  totalScenesDurationFrames,
  totalScenesDurationSec,
  transitionFrames,
} from './pacing'

describe('pacing constants — single source of truth (round-Video-Backgrounds-v1)', () => {
  it('pins the canonical per-card duration math', () => {
    expect(FPS).toBe(30)
    expect(CHARS_PER_SEC).toBe(14)
    expect(MIN_SCENE_SEC).toBe(3)
    expect(MAX_SCENE_SEC).toBe(8)
    expect(FADE_SEC).toBeCloseTo(0.4, 5)

    // Sanity check: if any of these drift, a future preset or
    // render_config change lands with a different per-card duration
    // than the Python-side `_render_via_remotion`'s `durationInFrames`
    // math (cross-fade sum + per-scene frames). CI MUST catch this
    // drift before merging so the rendered MP4 stays in lock-step
    // with `Root.tsx::calculateStudioMetadata`.
  })
})

describe('sceneDurationSec', () => {
  it('clamps to MIN_SCENE_SEC for very short bodies', () => {
    expect(sceneDurationSec('')).toBe(MIN_SCENE_SEC)
    expect(sceneDurationSec('一')).toBe(MIN_SCENE_SEC)
  })

  it('clamps to MAX_SCENE_SEC for very long bodies', () => {
    expect(sceneDurationSec('A'.repeat(1000))).toBe(MAX_SCENE_SEC)
  })

  it('honors CHARS_PER_SEC for typical bodies', () => {
    // 28 chars / 14 chars-per-sec = 2.0 → clamps to MIN_SCENE_SEC=3
    expect(sceneDurationSec('A'.repeat(28))).toBe(MIN_SCENE_SEC)
    // 56 chars at 14 cps = 4.0 — within [MIN, MAX]
    expect(sceneDurationSec('A'.repeat(56))).toBeCloseTo(4.0, 5)
    // 84 chars at 14 cps = 6.0 — within [MIN, MAX]
    expect(sceneDurationSec('A'.repeat(84))).toBeCloseTo(6.0, 5)
  })
})

describe('sceneDurationFrames', () => {
  it('rounds halfway values to nearest integer', () => {
    // 4.5s @ 30fps = 135
    const body = 'A'.repeat(63) // 63 / 14 = 4.5
    expect(sceneDurationFrames(body)).toBe(135)
  })
})

describe('scene aggregations', () => {
  it('totalSec sums per-scene durations', () => {
    const scenes = [
      { body: 'A'.repeat(42) }, // 3.0s (clamped to MIN)
      { body: 'A'.repeat(56) }, // 4.0s
    ]
    expect(totalScenesDurationSec(scenes)).toBeCloseTo(7.0, 5)
  })

  it('totalFrames sums per-scene frame durations', () => {
    const scenes = [
      { body: 'A'.repeat(42) }, // 90 frames
      { body: 'A'.repeat(56) }, // 120 frames
    ]
    expect(totalScenesDurationFrames(scenes)).toBe(210)
  })

  it('transitionFrames returns 0 for single-scene scripts', () => {
    expect(transitionFrames(1)).toBe(0)
    expect(transitionFrames(0)).toBe(0)
  })

  it('transitionFrames returns FADE_SEC * FPS for >1 scene', () => {
    expect(transitionFrames(2)).toBe(Math.round(FADE_SEC * FPS))
    expect(transitionFrames(7)).toBe(Math.round(FADE_SEC * FPS))
  })
})
