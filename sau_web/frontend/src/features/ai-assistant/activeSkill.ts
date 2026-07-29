/**
 * Module-level active skill prompt for the publish AI chat pipeline.
 * Set by `/skill <id>`; cleared by `/skill clear` or `/clear`.
 * Injected as an extra system message on every generate turn.
 * UI badge reads `useAiStore.activeSkillId` for reactivity.
 */
import { useAiStore } from '@/stores/useAiStore'

let activeSkillPrompt: string | null = null

export function setActiveSkill(id: string | null, prompt: string | null) {
  activeSkillPrompt = prompt
  useAiStore.getState().setActiveSkillId(id)
}

export function getActiveSkillPrompt(): string | null {
  return activeSkillPrompt
}

export function getActiveSkillId(): string | null {
  return useAiStore.getState().activeSkillId
}

export function clearActiveSkill() {
  activeSkillPrompt = null
  useAiStore.getState().setActiveSkillId(null)
}
