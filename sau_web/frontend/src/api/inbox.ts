// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/api/inbox.ts` module that was missing on origin/main.
// Use LOOSE TYPING (any returns) to avoid downstream TS errors.
// Replace with the real API client implementation in a follow-up PR.

export const inboxApi: any = {}

export async function fetchInbox(_params?: any): Promise<any[]> {
  return []
}

export async function sendInboxMessage(_payload: any): Promise<any> {
  return {}
}

export async function markInboxRead(_id: string): Promise<void> {}

export default inboxApi