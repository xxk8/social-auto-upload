// ─────────────────────────────────────────────────────────────────────
// stableStringHash — djb2 32-bit string hasher.
//
// Deterministic across browsers / runtimes and well-distributed for
// short strings (emails, IDs, slugs). Originally inlined as `_hash`
// in AdminAvatar.tsx + PlatformDistribution.tsx (admin feature); lifted
// here when a second consumer appeared so the algorithm lives in one
// place. Non-cryptographic — use only for stable palette / bucket
// assignment, NOT for anything security-sensitive.
//
// The exact algorithm (djb2, variant `(h << 5) + h` ≡ `h * 33`):
//   h(0) = 5381
//   h(i+1) = ((h(i) * 33) ^ charCodeAt(i)) >>> 0
//
// Returns a non-negative 32-bit integer (`0 ≤ n < 2^32`). To bucket
// into a fixed-size palette at the call site:
//
//   `stableStringHash(s) % palette.length`
//
// Module exports the function ONLY (safe for `react-refresh/
// only-export-components` — no cva() / const recipes alongside).
// ─────────────────────────────────────────────────────────────────────

/**
 * djb2 32-bit hash of an arbitrary string.
 *
 * Stable across Node.js, browsers, V8, SpiderMonkey, and JSC — same
 * input string → same return value. Empty string returns 5381
 * (the seed), so callers handling empty identifiers should branch
 * before hashing (e.g. AdminAvatar maps `''` to the `'?'` glyph via
 * `_initials` upstream; it doesn't reach this function).
 *
 * @param input — any non-null string (caller's responsibility).
 *               For nullish input, callers are expected to coerce to
 *               a default identity string before hashing.
 * @returns non-negative 32-bit integer.
 */
function stableStringHash(input: string): number {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    // `h * 33` ≡ `(h << 5) + h`. XOR with the next char ensures the
    // hash mixes bit-spread information from every char, not just the
    // first 5 bits.
    h = (h * 33) ^ input.charCodeAt(i)
  }
  // `>>> 0` converts the JS-bitwise result to an unsigned 32-bit int
  // so callers can modulo into palette indices without surprises.
  return h >>> 0
}

export { stableStringHash }
