# Tasks

## 1. Dependencies

- [x] Add `dexie@^4` as a runtime dep in `sau_web/frontend/package.json`
- [x] Add `fake-indexeddb` as a dev dep + wire `fake-indexeddb/auto` in vitest setup
- [x] Verify TypeScript resolves `dexie` types

## 2. DexieChatStorage adapter

- [x] Implement `DexieChatStorage` in `sau_web/frontend/src/lib/chat/storage.dexie.ts`
- [x] Re-export from `storage.ts` barrel

## 3. Startup wiring

- [x] `bootstrapChatPersistence` prune → hydrate → subscribe write-through
- [x] Call from `main.tsx` (best-effort; memory fallback on failure)

## 4. Test harness

- [x] vitest setup installs `fake-indexeddb/auto`
- [x] `storage.dexie.test.ts` — sort / atomic save / deleteMany / prune / contract suite
- [x] `pnpm/npm vitest run src/lib/chat` green

## 5. Verification

- [x] vitest chat suite green
- [x] pytest backend suite still green (orthogonal)
