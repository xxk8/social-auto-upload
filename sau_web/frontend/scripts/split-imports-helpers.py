#!/usr/bin/env python3
# ──────────────────────────────────────────────────────────────────────────
# scripts/split-imports-helpers.py
#
# Bulk-updates consumer imports after the OPT-follow-up-3-sweep-2 split.
#
# The 6 `.tsx → .tsx + .helpers.ts` splits moved non-component value exports
# (helpers, hooks, constants, contexts, types-of-values) out of
# component-only files. ~45 consumer files still import hook-side or
# constant-side symbols from the original `.tsx` path, where those
# symbols no longer live. This script re-routes those imports so:
#
#   - hook / context / constant / type-side symbols
#       → `@/X/Component.helpers`
#   - component-side symbols
#       → original `@/X/Component`
#
# Mixed import lines split into 2 separate `import` statements.
# Idempotent: re-runs detect already-routed paths and skip them.
# Per-name unknown symbols (not in either set) preserve the import as-is
# — defensive, never silently drop an unknown name.
# ──────────────────────────────────────────────────────────────────────────

import argparse
import re
import sys
from pathlib import Path

# (import-path basename → {helper-set}, {component-set}) — sourced from
# the 6 split decisions in the .helpers.ts files; edits to the splits
# must update both the .helpers.ts files AND this table in the same PR.
TARGETS = {
    'shared': (
        {'PLATFORM_TAG_LIMITS', 'effectiveMaxTags', 'platformTagLabel', 'formatTaskId'},
        {'SectionHeader'},
    ),
    'AccountsProvider': (
        {
            'validateGroupName', 'useAccountsState', 'useAccountsDispatch',
            'AccountsState', 'AccountsDispatch', 'DragEndEvent',
            'AccountsStateCtx', 'AccountsDispatchCtx', 'GroupNameValidation',
        },
        {'AccountsProvider'},
    ),
    'OnboardingTour': (
        {'resetOnboardingTour', 'STORAGE_KEY', 'TOUR_DONE_EVENT', 'TOUR_RESET_EVENT'},
        {'OnboardingTour'},
    ),
    'ThemeProvider': (
        {'useTheme', 'Theme', 'ThemeProviderState', 'ThemeProviderContext'},
        {'ThemeProvider'},
    ),
    'platform-icon': (
        {'PLATFORM_COLORS', 'PLATFORM_BORDER_LEFT'},
        {'PlatformIcon'},
    ),
    'toast': (
        {'useToast', 'Toast', 'ToastType', 'ToastContextType', 'ToastContext'},
        {'ToastProvider'},
    ),
}


def basename_of(path: str) -> str:
    """Canonical basename (last path segment) for `@/X/Y` or relative paths."""
    p = path[2:] if path.startswith('@/') else path
    p = p.rstrip('/')
    return p.split('/')[-1] if p else ''


# import { X, type Y, Z } from 'PATH';
# Captures: indent (group 2), names (group 3), quote char (group 4),
# path (group 5). The newline before the import is in group 1 so we can
# re-emit it on rewrite.
IMPORT_RE = re.compile(
    r"(\n)([ \t]*)import\s*\{([^}]*)\}\s*from\s*([\"'])([^\"']+)\4\s*;?",
    re.MULTILINE,
)


def classify(names_str: str, helpers: set, comps: set):
    """Return (comp_names, help_names, unknowns) preserving any `type` prefix."""
    comp_names: list[str] = []
    help_names: list[str] = []
    unknowns: list[str] = []
    for raw in names_str.split(','):
        n = raw.strip()
        if not n:
            continue
        bare = n[5:].strip() if n.startswith('type ') else n
        if bare in comps:
            comp_names.append(n)
        elif bare in helpers:
            help_names.append(n)
        else:
            unknowns.append(n)
    return comp_names, help_names, unknowns


def rewrite(content: str) -> tuple[str, dict]:
    """Apply rewrite to a single file's text. Returns (new_text, stats)."""
    counts = {'scanned': 0, 'split': 0, 'comp_only': 0, 'help_only': 0, 'skipped': 0}

    def sub(m):
        nl, indent, names_str, quote, path = m.groups()
        counts['scanned'] += 1
        base = basename_of(path)
        if base not in TARGETS:
            counts['skipped'] += 1
            return m.group(0)
        # Idempotency: already routed to .helpers
        if path.endswith('.helpers') or '/.helpers' in path:
            counts['skipped'] += 1
            return m.group(0)
        helpers, comps = TARGETS[base]
        comp_names, help_names, unknowns = classify(names_str, helpers, comps)
        # Defensive: don't touch lines with any unclassified symbol —
        # safer than mis-routing a name we didn't recognize. Caller can
        # grep for these and resolve manually.
        if unknowns:
            counts['skipped'] += 1
            return m.group(0)
        if comp_names and help_names:
            counts['split'] += 1
            comp_block = '{' + ', '.join(comp_names) + '}'
            help_block = '{' + ', '.join(help_names) + '}'
            return (
                f"\n{indent}import {comp_block} from {quote}{path}{quote};"
                f"\n{indent}import {help_block} from {quote}{path}.helpers{quote};"
            )
        if comp_names:
            counts['comp_only'] += 1
            return f"\n{indent}import {{{', '.join(comp_names)}}} from {quote}{path}{quote};"
        counts['help_only'] += 1
        return f"\n{indent}import {{{', '.join(help_names)}}} from {quote}{path}.helpers{quote};"

    new = IMPORT_RE.sub(sub, content)
    return new, counts


def walk_targets(roots):
    for root in roots:
        rp = Path(root)
        if not rp.exists():
            continue
        for path in rp.rglob('*.ts*'):
            if path.suffix not in ('.ts', '.tsx'):
                continue
            yield path


def main():
    p = argparse.ArgumentParser(
        description='Bulk-rewrite consumer imports after OPT-follow-up-3-sweep-2 split.'
    )
    p.add_argument('--dry-run', action='store_true', help='report counts without writing')
    p.add_argument('--roots', nargs='+', default=['src', 'tests'])
    args = p.parse_args()

    aggregate = {'files_scanned': 0, 'files_edited': 0, 'split': 0, 'comp_only': 0, 'help_only': 0, 'skipped': 0}
    for path in walk_targets(args.roots):
        aggregate['files_scanned'] += 1
        try:
            original = path.read_text(encoding='utf-8')
        except (UnicodeDecodeError, OSError) as e:
            print(f'WARN: skip {path}: {e}', file=sys.stderr)
            continue
        new, stats = rewrite(original)
        for k in ('split', 'comp_only', 'help_only', 'skipped'):
            aggregate[k] += stats[k]
        if new != original:
            aggregate['files_edited'] += 1
            if not args.dry_run:
                path.write_text(new, encoding='utf-8')
            tag = '[DRY] ' if args.dry_run else '[WRITE] '
            print(f'{tag}{path}: split={stats["split"]} help={stats["help_only"]} comp={stats["comp_only"]} skip={stats["skipped"]}')

    print()
    print(f"Total: scanned {aggregate['files_scanned']} files, edited {aggregate['files_edited']}")
    print(f"Imports: split={aggregate['split']}  help-only={aggregate['help_only']}  comp-only={aggregate['comp_only']}  skipped={aggregate['skipped']}")


if __name__ == '__main__':
    main()
