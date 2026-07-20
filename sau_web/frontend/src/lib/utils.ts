// TODO(migration-stub): minimal placeholder for the pre-existing
// `src/lib/utils.ts` module that was missing on origin/main. Use
// LOOSE TYPING (any returns) to avoid downstream TS2345/TS2322
// mismatches with the 30+ importers. Replace with the real `cn`
// implementation (classNames utility) in a follow-up PR.

export const cn = (...args: any[]): string =>
  args.filter(Boolean).join(' ')

export const escapeQuotes = (s: string): string =>
  s.replace(/"/g, '\\"').replace(/'/g, "\\'")

export default cn