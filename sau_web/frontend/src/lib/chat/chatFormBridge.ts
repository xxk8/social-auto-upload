// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/lib/chat/chatFormBridge.ts` module that was missing on origin/main.
// Use LOOSE TYPING (any returns) to avoid downstream TS errors.
// Replace with the real form/chat bridge implementation in a follow-up PR.

export const chatFormBridge: any = {}

export function attachChatFormBridge(_formId: string, _handlers: any): void {}
export function detachChatFormBridge(_formId: string): void {}
export function getChatFormBridge(_formId: string): any {
  return null
}

export default chatFormBridge