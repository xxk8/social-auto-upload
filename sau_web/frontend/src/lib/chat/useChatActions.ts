// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/lib/chat/useChatActions.ts` hook that was missing on origin/main.
// Use LOOSE TYPING (any returns) to avoid downstream TS errors.
// Replace with the real React hook implementation in a follow-up PR.

export function useChatActions(): any {
  return {
    send: async (_payload: any): Promise<any> => null,
    clear: (): void => {},
    retry: async (_id: string): Promise<any> => null,
    cancel: (_id: string): void => {},
    isStreaming: false,
    streamChunk: null,
  }
}

export default useChatActions