#!/usr/bin/env python3
"""Discoverability-on-arrival contract audit for docs/ surfaces.

Encodes the strict part of the contract documented in `docs/dev/INDEX.md` § '
Discoverability-on-arrival contract' so a future PR that regresses the
README `详细文档` table ordering, the INDEX.md sub-doc cross-references, or
the surface-doc triangulation is caught at CI time.

HARD invariants (exit 1 on any violation):
  1. README.md `## 📃 详细文档` table row order:
     `运营 Cron Runbook` + `开发文档枢纽` MUST sit DIRECTLY AFTER `Web Shell`.
  2. `docs/dev/INDEX.md` must reference every docs/dev/ sub-doc by basename
     at least once.
  3. CLAUDE.md / README.md / docs/install.md must each reference both
     `docs/dev/INDEX.md` and `docs/dev/monitor-cdp-throttling-cron-ops.md`.
  4. Every docs/dev/ sub-doc must contain `docs/dev/INDEX.md` AND one of
     `{#operators, #contributors, #onboarding}` anchors — a one-line
     backlink in the sub-doc's `## Cross-references` section so a cold
     reader can hop back to the hub. Mirrors the canonical grep:
     `grep -L "docs/dev/INDEX.md" docs/dev/*.md`.
  5. **(Cross-check)** Every sub-doc's cited Hub anchor MUST intersect with
     the audience set INDEX.md's "Quick-reference table — by file" matrix
     lists it under. Catches regressions where the sub-doc and INDEX.md
     disagree on primary audience placement (e.g. a multi-audience doc
     pointing to a third audience neither table lists it under).

SOFT advisories (logged but do NOT cause exit 1):
  6. Each docs/dev/ sub-doc should mirror `postgres-getting-started.md`'s
     section ordering (Contract Rule 3 — Built-from-template). Existing
     Chinese-headed docs in the hub pre-date the contract; the audit
     reports which sub-docs lack the canonical template so a future PR
     can retrofit them, but does NOT block merges on this.

Exit codes:
  0  all hard invariants pass
  1  at least one hard invariant failed (per-violation list printed to stderr)

Pure stdlib (no external deps). Self-contained: < 100 ms warm, ~1 s cold.

Usage (CI):
  python scripts/dev_docs_audit.py

Usage (local):
  python scripts/dev_docs_audit.py           # verdict + advisory list
  python scripts/dev_docs_audit.py --quiet   # only on hard failures

This script pairs with `tests/test_dev_docs_audit.py` which locks the
expected behavior per invariant; both SHOULD be edited together when the
4-rule contract in `docs/dev/INDEX.md` is amended.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# ── Invariant constants ─────────────────────────────────────────────────────

DEVDOCS_DIR = REPO_ROOT / "docs" / "dev"
INDEX_PATH = DEVDOCS_DIR / "INDEX.md"

# Surface docs that MUST each cross-reference the dev-docs hub + the
# TBF-018 cron runbook. Order matches the user-facing discoverability story:
# CLAUDE.md (AI agent) → README.md (human) → docs/install.md (post-install).
SURFACE_DOCS = [
    REPO_ROOT / "CLAUDE.md",
    REPO_ROOT / "README.md",
    REPO_ROOT / "docs" / "install.md",
]

# The two dev-docs files the surface must reference; mirrors the
# discoverability triangulation added in earlier rounds.
SURFACE_MUST_REFERENCES = [
    "docs/dev/INDEX.md",
    "docs/dev/monitor-cdp-throttling-cron-ops.md",
]

# Specific README.md `## 📃 详细文档` table ordering invariant.
# `运营 Cron Runbook` + `开发文档枢纽` MUST sit IMMEDIATELY AFTER `Web Shell`
# in the documented-table sequence; otherwise their discoverability claim
# regresses. Other rows above (安装说明/更新说明/CLI) precede this anchor
# and are intentionally NOT in this list — only the on-call adjacency
# matters.
README_TABLE_ORDER = [
    "Web Shell",
    "运营 Cron Runbook",
    "开发文档枢纽",
    "Agent Bootstrap",
    "历史 Web 说明",
]

# SOFT-advisory canonical sections per Contract Rule 3. Logged to stderr
# when missing but never exit-1. Existing Chinese-headed docs pre-date the
# contract and currently lack these headings; a future PR can retrofit.
SOFT_CANONICAL_SECTIONS = [
    "## Why this exists",
    "## Prereqs",
    "## Cross-references",
]

# Audience anchors for the sub-doc → hub backlink (HARD Invariant 4).
# Per Contract Rule 1 (Pick 1–2 audiences), each docs/dev/ sub-doc must
# cite `docs/dev/INDEX.md` plus ONE of these anchors so the deep-link
# lands on the audience section the sub-doc belongs to (not on INDEX.md
# page top). Multiple-audience docs need only cite one anchor; readers
# land in the primary audience's section and scroll for the secondary.
HUB_AUDIENCE_ANCHORS = (
    "#operators",
    "#contributors",
    "#onboarding",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _list_dev_subdocs() -> list[Path]:
    """All .md files in docs/dev/ EXCEPT INDEX.md (the hub itself)."""
    return sorted(p for p in DEVDOCS_DIR.glob("*.md") if p.name != "INDEX.md")


def _next_h2_line_index(text: str, offset: int) -> int | None:
    """Return the line index of the next `## ...` heading AT THE START OF A
    LINE in `text[offset:]`, or None if no such heading exists.

    Line-prefix scan (rather than substring scan) avoids misfiring if any
    table cell in the text contains `## ` as literal content.
    """
    m = re.search(r"^## ", text[offset:], flags=re.MULTILINE)
    return offset + m.start() if m else None


# ── HARD Invariant 1: README.md 详细文档 table ordering ──────────────────────

def check_readme_table_order() -> list[str]:
    """`运营 Cron Runbook` + `开发文档枢纽` MUST sit DIRECTLY AFTER `Web Shell`.

    Returns failure list (empty on pass).

    Implementation:
      * Find the `## 📃 详细文档` section by scanning line by line.
      * Extract the first column of every table row, then drop the markdown
        header + separator rows (which start with `文档` / `---`).
      * Find the index of `Web Shell` in the cleaned list, then walk
        `len(README_TABLE_ORDER)` rows forward and assert they match the
        audit's expected sequence.
    """
    failures: list[str] = []
    readme = _read(REPO_ROOT / "README.md")

    # Locate the H2 section.
    h2_start = readme.find("## 📃 详细文档")
    if h2_start == -1:
        failures.append(
            "Invariant 1 (README table order): `## 📃 详细文档` heading not "
            "found in README.md; cannot evaluate row order."
        )
        return failures

    nxt = _next_h2_line_index(readme, h2_start + 1)
    h2_end = nxt if nxt is not None else len(readme)
    table_section = readme[h2_start:h2_end]

    # Extract the first column of every row. The first two rows are
    # markdown header `## 文档 | ## 路径 | ## 用途` and separator
    # `## --- | ## --- | ## ---` — drop them so the walk starts at the
    # first DATA row.
    raw_rows = re.findall(r"^\|\s*([^|]+?)\s*\|", table_section, flags=re.MULTILINE)
    rows = [r.strip() for r in raw_rows if r.strip() not in {"文档", "---"}]
    if not rows:
        failures.append(
            "Invariant 1 (README table order): no rows detected under "
            "`## 📃 详细文档`; table may have been deleted or restructured."
        )
        return failures

    # Find the Web Shell anchor (first occurrence) and walk forward.
    try:
        idx = rows.index("Web Shell")
    except ValueError:
        failures.append(
            f"Invariant 1 (README table order): `Web Shell` row not "
            f"found in `## 📃 详细文档` table. Cleanup produced: "
            f"`{', '.join(rows)}`."
        )
        return failures

    for offset, expected in enumerate(README_TABLE_ORDER):
        actual = rows[idx + offset] if idx + offset < len(rows) else "<missing>"
        if actual != expected:
            failures.append(
                f"Invariant 1 (README table order): row {idx + offset} under "
                f"`## 📃 详细文档` (counting from `Web Shell` at row {idx}) "
                f"must be `{expected}`, got `{actual}`. Full table data rows: "
                f"`{', '.join(rows)}`."
            )
    return failures


# ── HARD Invariant 2: docs/dev/INDEX.md lists every sub-doc ─────────────────

def check_index_lists_all_subdocs() -> list[str]:
    """Each docs/dev/ sub-doc filename MUST appear in INDEX.md at least once."""
    failures: list[str] = []
    if not INDEX_PATH.exists():
        failures.append(
            f"Invariant 2 (INDEX lists all sub-docs): {INDEX_PATH} missing. "
            f"Re-create `docs/dev/INDEX.md` to restore the hub."
        )
        return failures

    index_content = _read(INDEX_PATH)
    for subdoc in _list_dev_subdocs():
        bare = subdoc.name[:-3]  # strip `.md`
        if bare not in index_content:
            failures.append(
                f"Invariant 2 (INDEX lists all sub-docs): "
                f"`docs/dev/{subdoc.name}` not referenced in `docs/dev/INDEX.md` "
                f"(a `[name]({bare}.md)` link in one of the audience tables "
                f"is the cheapest fix; also add a row in the quick-reference "
                f"matrix)."
            )
    return failures


# ── HARD Invariant 3: surface docs reference the dev-docs hub + runbook ──────

def check_surface_docs_references() -> list[str]:
    """Each surface doc must reference BOTH `docs/dev/INDEX.md` AND
    `docs/dev/monitor-cdp-throttling-cron-ops.md` at least once.
    """
    failures: list[str] = []
    for surface in SURFACE_DOCS:
        if not surface.exists():
            failures.append(
                f"Invariant 3 (surface docs reference dev-docs): "
                f"surface doc `{surface}` missing."
            )
            continue
        text = _read(surface)
        for ref in SURFACE_MUST_REFERENCES:
            if ref not in text:
                failures.append(
                    f"Invariant 3 (surface docs reference dev-docs): "
                    f"`{surface.relative_to(REPO_ROOT)}` does not reference "
                    f"`{ref}`. Add the link in the surface doc's relevant "
                    f"section (top-level pointer for CLAUDE.md, "
                    f"detailed-docs table or new Operations section for "
                    f"README.md, footer for docs/install.md)."
                )
    return failures


# ── HARD Invariant 4: every docs/dev/ sub-doc backlinks to INDEX.md#<audience>
# Sub-invariant of Contract Rule 1 (Pick 1–2 audiences). The user's canonical
# grep is `grep -L "docs/dev/INDEX.md" docs/dev/*.md` (excluding INDEX itself).
# Without the anchor, the deep-link lands on INDEX.md top instead of the
# audience section the sub-doc belongs to. Mirrors sub-doc → hub
# discoverability so a reader who lands on a sub-doc cold can hop back.

def check_subdoc_backlinks_to_hub() -> list[str]:
    """Each docs/dev/ sub-doc must:
      * contain the literal `docs/dev/INDEX.md` substring (the backlink
        target — mirrors `grep -L "docs/dev/INDEX.md" docs/dev/*.md`);
      * contain one of the 3 audience anchors (`#operators`, `#contributors`,
        `#onboarding`) so the deep-link lands on the matching audience
        section, not on INDEX.md top.

    Each sub-doc only needs to cite ONE anchor (Contract Rule 1 allows
    1–2 audiences; the link points to the primary audience, and readers
    scroll for the secondary).
    """
    failures: list[str] = []
    for subdoc in _list_dev_subdocs():
        text = _read(subdoc)
        # Substring check (mirrors user's `grep -L "docs/dev/INDEX.md"`).
        if "docs/dev/INDEX.md" not in text:
            failures.append(
                f"Invariant 4 (sub-doc backlink to hub): "
                f"`docs/dev/{subdoc.name}` does not reference "
                f"`docs/dev/INDEX.md`. Add a one-liner backlink in the "
                f"sub-doc's `## Cross-references` section, e.g. "
                f"`- **Hub**: [docs/dev/INDEX.md#contributors]"
                f"(docs/dev/INDEX.md#contributors) \u2014 Contributors "
                f"(writing code, merging PRs).`"
            )
            continue
        # Anchor check — must include at least one of the 3 audience anchors.
        if not any(a in text for a in HUB_AUDIENCE_ANCHORS):
            failures.append(
                f"Invariant 4 (sub-doc backlink to hub): "
                f"`docs/dev/{subdoc.name}` references `docs/dev/INDEX.md` "
                f"but does not include one of the 3 audience anchors: "
                f"{', '.join(HUB_AUDIENCE_ANCHORS)}. The anchor is what "
                f"routes the deep-link to the right audience section "
                f"(e.g. `#operators` jumps to the Operators table on "
                f"INDEX.md); without it, the link lands on INDEX.md top "
                f"and the reader has to scroll to find the right table."
            )
    return failures


# ── HARD Invariant 5: sub-doc anchors must match INDEX's quick-reference matrix
# Cross-check between Rule 1 audience selection (recorded in INDEX.md's
# "Quick-reference table — by file") and Rule 5's anchor choice (in the
# sub-doc's `## Cross-references`). Bounded section extraction avoids
# picking up other tables that happen to have a filename column; strict
# ✅ classification makes typos / blanks / unrecognized marks fail-safe
# as negatives rather than silently mapping to an audience.

def check_subdoc_audience_matrix_match() -> list[str]:
    """For each docs/dev/ sub-doc, assert that AT LEAST ONE cited audience
    anchor intersects with the audience set INDEX.md's "Quick-reference
    table — by file" matrix lists it under. Multi-audience docs need
    only cite ONE anchor (Contract Rule 5 spec) — the cross-check
    tolerates intersection rather than requiring full superset coverage.

    Failure modes:
      * Sub-doc missing from the matrix → hard fail (forces the matrix
        row to be added on PR).
      * Sub-doc cites an anchor NOT in its matrix audience set → hard
        fail with both offending anchor + valid set quoted.
      * Matrix empty / unparseable / missing H2 → single loud failure
        so a structural INDEX.md edit forces a paired audit update.
    """
    failures: list[str] = []
    if not INDEX_PATH.exists():
        failures.append(
            "Invariant 5 (audience matrix cross-check): "
            "`docs/dev/INDEX.md` missing; cannot evaluate audience matrix."
        )
        return failures

    index_content = _read(INDEX_PATH)

    # Bounded section extraction: only parse rows inside the
    # "Quick-reference table — by file" H2-bounded region.
    h2_start = index_content.find("## Quick-reference table — by file")
    if h2_start == -1:
        failures.append(
            "Invariant 5 (audience matrix cross-check): "
            "`## Quick-reference table — by file` heading not found in "
            "`docs/dev/INDEX.md`. The cross-check cannot run without the "
            "matrix; restore the section or update the audit script."
        )
        return failures

    nxt = _next_h2_line_index(index_content, h2_start + 1)
    table_text = (
        index_content[h2_start:nxt] if nxt is not None
        else index_content[h2_start:]
    )

    # Parse matrix rows. Each data row begins with a backtick-quoted
    # filename; each subsequent cell maps to an audience column.
    matrix_audiences: dict[str, set[str]] = {}
    row_regex = r"^\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|"
    for match in re.finditer(row_regex, table_text, flags=re.MULTILINE):
        filename = match.group(1).strip()
        # Strict ✅ classification; blanks / em-dashes / typos are
        # negatives (safe default per Contract Rule 1 spec).
        valid: set[str] = set()
        if "✅" in match.group(2):
            valid.add("#operators")
        if "✅" in match.group(3):
            valid.add("#contributors")
        if "✅" in match.group(4):
            valid.add("#onboarding")
        matrix_audiences[filename] = valid

    if not matrix_audiences:
        failures.append(
            "Invariant 5 (audience matrix cross-check): "
            "`## Quick-reference table — by file` matrix parsed empty in "
            "`docs/dev/INDEX.md`. Check that the table still has rows of "
            "the form `\\|`<code>file.md</code>`|`\u00A0\u2705:`\u00A0|`\u00A0\u2014:`\u00A0|`|` "
            "(or update the audit script's row_regex if the table format "
            "intentionally changed)."
        )
        return failures

    # Cross-check against actual sub-docs.
    for subdoc in _list_dev_subdocs():
        if subdoc.name not in matrix_audiences:
            failures.append(
                f"Invariant 5 (audience matrix cross-check): "
                f"`docs/dev/{subdoc.name}` is missing from the "
                f"`Quick-reference table — by file` matrix in "
                f"`docs/dev/INDEX.md`. Add a row tagging which audiences "
                f"({{Operators, Contributors, Onboarding}}) this sub-doc "
                f"belongs to."
            )
            continue

        valid_anchors = matrix_audiences[subdoc.name]
        text = _read(subdoc)
        cited_anchors = {a for a in HUB_AUDIENCE_ANCHORS if a in text}

        if not cited_anchors:
            # Hard 4 already flags missing anchors; skip here to avoid
            # double-flagging the same regression on the same line.
            continue

        if not cited_anchors.intersection(valid_anchors):
            # Pick a deterministic "offender": the first cited anchor
            # that is not in the matrix's audience set. Iterate in
            # HUB_AUDIENCE_ANCHORS order for stable failure message text.
            offender = next(
                (a for a in HUB_AUDIENCE_ANCHORS
                 if a in cited_anchors and a not in valid_anchors),
                next(iter(cited_anchors)),
            )
            failures.append(
                f"Invariant 5 (audience matrix cross-check): "
                f"`docs/dev/{subdoc.name}` cites anchor `{offender}` but "
                f"INDEX.md's matrix lists it under `{sorted(valid_anchors)}`. "
                f"Either change the sub-doc's Hub backlink to a primary "
                f"audience in the matrix set, OR update the matrix row to "
                f"add the cited audience."
            )
    return failures


# ── SOFT advisory 4: each sub-doc has the canonical template sections ────────
# Informational only — never exit 1. Existing Chinese-headed docs pre-date
# the contract; the audit reports which sub-docs lack the canonical
# template so a future PR can retrofit them, but does NOT block merges.

def check_subdoc_template_sections_advisory() -> list[str]:
    """Each docs/dev/ sub-doc SHOULD include the 3 canonical sections."""
    advisories: list[str] = []
    for subdoc in _list_dev_subdocs():
        text = _read(subdoc)
        missing = [s for s in SOFT_CANONICAL_SECTIONS if s not in text]
        if missing:
            advisories.append(
                f"Advisory 4 (sub-doc template sections — informational): "
                f"`docs/dev/{subdoc.name}` is missing canonical section(s): "
                f"{', '.join(repr(s) for s in missing)}. Per Contract Rule 3, "
                f"future retrofit may mirror `postgres-getting-started.md`'s "
                f"section ordering."
            )
    return advisories


# ── Main ────────────────────────────────────────────────────────────────────

def run_hard_invariants() -> list[str]:
    """Run HARD invariants only (return failure list, empty on pass)."""
    failures: list[str] = []
    failures.extend(check_readme_table_order())
    failures.extend(check_index_lists_all_subdocs())
    failures.extend(check_surface_docs_references())
    failures.extend(check_subdoc_backlinks_to_hub())
    failures.extend(check_subdoc_audience_matrix_match())
    return failures


def run_all_checks() -> tuple[list[str], list[str]]:
    """Run HARD invariants + SOFT advisories; return (failures, advisories)."""
    failures = run_hard_invariants()
    advisories = check_subdoc_template_sections_advisory()
    return failures, advisories


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="only emit on hard failures (still exit 1 on any); "
        "useful as a pre-commit hook local check.",
    )
    args = parser.parse_args(argv)

    failures, advisories = run_all_checks()
    if not failures and not advisories:
        if not args.quiet:
            print("[dev_docs_audit] PASS: all hard invariants hold, no advisories.")
        return 0

    if not failures:
        # All hard invariants pass; only soft advisories. Exit 0, log advisory.
        if not args.quiet:
            print("[dev_docs_audit] PASS: all hard invariants hold.")
            if advisories:
                print(
                    f"[dev_docs_audit] {len(advisories)} SOFT advisory(ies) "
                    f"(informational; do NOT block — these are forward-facing "
                    f"contract rules that existing docs pre-date):"
                )
                for a in advisories:
                    print(f"  - {a}", file=sys.stderr)
        return 0

    # Hard violations present.
    print(
        f"[dev_docs_audit] FAIL: {len(failures)} hard contract violation(s).",
        file=sys.stderr,
    )
    for f in failures:
        print(f"  - {f}", file=sys.stderr)
    if advisories:
        print(
            f"[dev_docs_audit] Plus {len(advisories)} soft advisory(ies) "
            f"(informational):",
            file=sys.stderr,
        )
        for a in advisories:
            print(f"  - {a}", file=sys.stderr)
    print(
        "[dev_docs_audit] Fix the hard violations listed above; the contract is "
        "documented in `docs/dev/INDEX.md` § 'Discoverability-on-arrival contract'.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
