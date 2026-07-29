# Locale JSON Mutation Rules

> **Read this before editing `sau_web/frontend/src/locales/{zh-CN,en-US}.json`.**
> Skipping the rule has cost this branch one round-trip fix before (see "Why this rule exists" below).

## The rule

When you need to add, remove, or restructure keys in any locale JSON under
`sau_web/frontend/src/locales/`, use **one of** the two paths below —
never plain multi-line `str_replace` on JSON:

| Path | When to use | Trade-off |
|---|---|---|
| **A. `python -m json.tool` round-trip** for *editorial* changes (preserve order, surgical key inserts) | Adding/removing one or two keys while keeping structure and ordering intact | Existing git diff stays minimal; order preserved via Python dict semantics |
| **B. `write_file` with the full intended content** for *structural* changes (renames, repaths, key reshuffles) | When you're sure the entire file's intent is shifting — read current state in full first | Diff is larger (whole-file), but the new state is transparent and not subject to indentation ambiguities |

`str_replace` on JSON is **rejected by default**. If you have a strong reason
to use it (very small one-line typo), a single-line `str_replace` on a JSON
file is tolerable ONLY when:

1. The keys affected are leaves (string values), not structural commits, and
2. The total diff is <10 lines, and
3. You immediately re-emit the file via `python -m json.tool input > output`
   to normalize it before committing.

If your edit can't satisfy all three constraints, it's not actually a "small"
edit — switch to Path A or B.

## Why this rule exists

The rule was forged by a real incident on `en-US.json` during the
2026-Q3 stats-banner alignment refactor. A multi-line `str_replace`
intended to nest a new `marketing.stats` block INSIDE `marketing` instead
landed it at top-level depth. Symptom:

```text
Before fix:
  jq '.marketing | has("stats")' → false
  jq '.stats'                    → {...}   ← top-level, wrong depth
After fix (python json.load + dump):
  jq '.marketing | has("stats")' → true
  jq '. | has("stats")'          → false
```

The visual rendering didn't break because every page reads `t('marketing.stats.X', <fallback>)` —
when the lookup misses, the inline fallback string renders. Screenshots all looked correct, but the i18n
namespace was effectively dead for English visitors until a separate visual loop (capturing an en-US
screenshot and asserting captions match the en-US JSON keys) caught the regression.

**The bug's root cause**: the replacement's anchor matched across two indented lines (4-space
`dashboard` vs. the 4-space `stats` insertion). JSON's structural depth is encoded in indentation,
but `str_replace` operates on byte-equal strings — the new block landed at the same depth as the
anchor, not where it logically belonged. The fix was a python `json.load`/`dump` cycle that
explicitly reparented the `stats` node.

The same risk surfaces any time you anchor on whitespace cues instead of structural tokens.

## Acceptable tooling

### Path A — Python round-trip (preferred for editorial changes)

```bash
python3 - <<'PY'
import json, sys
PATH = 'sau_web/frontend/src/locales/en-US.json'
with open(PATH) as f:
    data = json.load(f)

# Example: add 'banner_label' under marketing.stats
data['marketing'].setdefault('stats', {})['banner_label'] = 'Trust metrics at a glance'

# Re-emit deterministic, diff-friendly format
with open(PATH, 'w') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY
```

- Preserves insertion order (Python 3.7+ dict semantics).
- Indent=2 matches what `git` will treat as "no actual change" for whitespace-only
  keys.
- `ensure_ascii=False` keeps CJK / ZWJ / emoji glyphs human-readable in diffs.
- The trailing `\n` matches `unix` shebang / POSIX conventions.

### Path B — `write_file` with full content (preferred for structural changes)

When the file's structure shifts significantly (renaming a top-level key, splitting
a duplicate, recovering from corruption), use `write_file` with the full intended content.
This is most transparent; the downside is a noisier diff. Always verify the post-write
output with `python -m json.tool < file > /dev/null` (no-op if valid; nonzero exit if malformed).

### Validation gate (always run, regardless of path)

```bash
python -m json.tool sau_web/frontend/src/locales/zh-CN.json > /dev/null \
  && python -m json.tool sau_web/frontend/src/locales/en-US.json > /dev/null \
  && echo "JSON locale files: valid"
```

If either round-trip fails, the **fix is**: re-emit via `json.dump(data, indent=2, ensure_ascii=False)`
and `git diff` to verify the structural change is what you intended.

## Audit helper script

A reusable Python one-liner surfaces pending problems:

```bash
python3 - <<'PY'
import json, sys
ok = True
for path in [
    'sau_web/frontend/src/locales/zh-CN.json',
    'sau_web/frontend/src/locales/en-US.json',
]:
    try:
        with open(path) as f:
            data = json.load(f)
        # Round-trip check: ensure the file can be re-emitted cleanly.
        json.dumps(data, indent=2, ensure_ascii=False)
        # Spot-check: top-level keys must contain 'marketing'.
        assert 'marketing' in data, f'{path} missing top-level marketing'
        # Spot-check: marketing must contain every key we have shared chrome for.
        for required in ('topbar', 'footer', 'landing'):
            assert required in data['marketing'], f'{path} missing marketing.{required}'
        print(f'{path}: OK ({len(data["marketing"])} marketing keys)')
    except Exception as e:
        ok = False
        print(f'{path}: FAIL — {e}')
sys.exit(0 if ok else 1)
PY
```

Save a copy under `scripts/audit-locale-i18n.py` if you find yourself running it often.

## CI enforcement

`.github/workflows/ci.yml` has a `locale-json-validate` job that round-trips
both locale files through `python json.load/dump` on every push and PR.
Look for `Verify locale JSON round-trips` in CI logs if a PR fails with an
`invalid JSON` error — that means the rule above was bypassed somehow.

## When the rule does NOT apply

The rule is scoped to `*.json` files ONLY. Don't generalize:

* **`.tsx` / `.ts` files** — `str_replace` is fine, JSX and TS are whitespace-tolerant.
* **Markdown** — `str_replace` is fine.
* **YAML** (CI workflows, k8s configs) — `str_replace` is also risky because YAML
  is indentation-sensitive in unexpected ways. Prefer `write_file` with the full
  intended YAML if the change crosses comment blocks or has ambiguous
  indentation. (CI YAML changes are extremely rare on this branch; if you do
  one, prefer write_file.)
* **`/tmp/*.py` ad-hoc repair scripts** — untracked, no impact.

## Related docs

* [`docs/dev/INDEX.md`](INDEX.md) — discover other contributor / onboarding docs.
* [`docs/web-shell.md`](../web-shell.md) — how to run the React + Flask shell that consumes these locales.
* [`docs/dev/web-shell-architecture-lock.md`](web-shell-architecture-lock.md) — the SPA + Flask boundary this rule fits into (locales are front-end only).
