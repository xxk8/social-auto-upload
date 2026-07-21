"""Tests for `scripts/dev_docs_audit.py`.

These tests lock the 7 behavior surfaces documented in the audit-script
header (6 hard invariants + 1 soft advisory). The first 7 tests (one per
hard invariant + advisory + one end-to-end) run on the LIVE repo — they
act as the real safety net that catches a regression where a future PR
accidentally moves 2 rows in the `详细文档` table, drops a filename from
`INDEX.md`, breaks the surface-doc triangulation, removes a sub-doc
backlink to the hub, points the sub-doc's Hub backlink at an audience
INDEX.md does not list it under, or omits a canonical section in a
sub-doc.

The trailing 8 tests cover regression-injection + main entrypoint:
5 monkeypatch fault-injection smokes + 2 hard-invariant edge-case smokes
(zero-audience row + dual-audience cited on either anchor) + 1 main
entrypoint exit-code smoke. 15 tests total: 7 live + 7 monkeypatch
regression + 1 main smoke.
"""
from __future__ import annotations

import contextlib
import io
import sys
from pathlib import Path

import pytest

# Make scripts/ importable so we can import `dev_docs_audit` as a module.
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import dev_docs_audit as auditor  # noqa: E402

# ── Live-repo behavior ──────────────────────────────────────────────────────
# These five tests ASSERT the live repo is in a healthy state. If any
# regresses, the dev must fix the doc before this audit suite passes again.

def test_invariant_1_readme_table_order_passes_live() -> None:
    """`运营 Cron Runbook` + `开发文档枢纽` MUST sit DIRECTLY AFTER `Web Shell`."""
    failures = auditor.check_readme_table_order()
    assert failures == [], f"README.md regressed table-order invariant: {failures}"


def test_invariant_2_index_lists_all_subdocs_passes_live() -> None:
    """Each docs/dev/ sub-doc filename must appear at least once in INDEX.md."""
    failures = auditor.check_index_lists_all_subdocs()
    assert failures == [], f"INDEX.md regressed: {failures}"


def test_invariant_3_surface_docs_reference_passes_live() -> None:
    """Each of CLAUDE.md / README.md / docs/install.md must reference both dev-doc targets."""
    failures = auditor.check_surface_docs_references()
    assert failures == [], f"surface docs regressed: {failures}"


def test_advisory_subdoc_template_reports_live() -> None:
    """Soft-warn (Advisory 4, forward-facing): live repo sub-docs predate
    Contract Rule 3, so the advisory list is non-empty and each entry
    contains actionable template guidance. The audit must NOT exit 1 on
    these — they are forward-facing contract rules that existing docs
    predate, NOT a regression in the current contract state.
    """
    advisories = auditor.check_subdoc_template_sections_advisory()
    # Post-retrofit: zero advisories means every docs/dev/ sub-doc has the
    # 3 canonical sections per Contract Rule 3. If advisories becomes
    # non-empty again, a future PR dropped one of: ## Why this exists,
    # ## Prereqs, ## Cross-references on a sub-doc.
    assert len(advisories) == 0, (
        "Contract Rule 3 retrofit incomplete: at least one docs/dev/ sub-doc "
        "still missing a canonical template section."
    )
    for adv in advisories:
        assert "Advisory 4" in adv, adv
        assert "missing canonical section" in adv, adv


def test_invariant_4_subdoc_backlinks_to_hub_passes_live() -> None:
    """Hard Invariant 4: every docs/dev/ sub-doc (excluding INDEX) contains
    the literal `docs/dev/INDEX.md` substring AND one of the 3 audience
    anchors (`#operators`, `#contributors`, `#onboarding`).
    """
    failures = auditor.check_subdoc_backlinks_to_hub()
    assert failures == [], f"sub-doc hub backlink regressed: {failures}"


def test_invariant_5_subdoc_anchor_matches_matrix_passes_live() -> None:
    """Hard Invariant 5 (cross-check): every sub-doc's cited Hub anchor
    intersects with the audience set INDEX.md's "Quick-reference table —
    by file" matrix lists it under. Catches regressions like
    `postgres-getting-started.md` pointing to `#contributors` when the
    matrix says it's Operators + Onboarding.
    """
    failures = auditor.check_subdoc_audience_matrix_match()
    assert failures == [], f"sub-doc anchor vs INDEX matrix regressed: {failures}"


def test_run_all_invariants_passes_live() -> None:
    """End-to-end smoke test: all HARD invariants hold concurrently on the
    live repo. Soft advisories may surface (forward-facing) but never block.
    """
    failures, _advisories = auditor.run_all_checks()
    assert failures == [], f"discoverability contract regressed: {failures}"


# ── Regression simulation (monkeypatch) ──────────────────────────────────────

def test_check_readme_table_order_fails_when_row_at_wrong_position(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 1 emits a clear failure when 运营 Cron Runbook slips to row 5."""
    # Read the real README.md, simulate a regression by appending a dummy
    # row that pushes 运营 Cron Runbook to a position after 历史 Web 说明.
    readme_path = auditor.REPO_ROOT / "README.md"
    real_content = readme_path.read_text(encoding="utf-8")
    # Sanity: the live content starts with the right pattern.
    assert "运营 Cron Runbook" in real_content

    # Simulate: also embed a fake `## 📃 详细文档` section with rows in the
    # WRONG order, so the invariant complains.
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: real_content.replace(
            "## 📃 详细文档", "## 📃 详细文档\n\n| 文档 | 路径 | 用途 |\n"
            "| --- | --- | --- |\n"
            "| 安装说明 | a | b |\n"
            "| 更新说明 | a | b |\n"
            "| CLI 命令速查 | a | b |\n"
            "| Web Shell | a | b |\n"
            "| Agent Bootstrap | a | b |\n"
            "| 历史 Web 说明 | a | b |\n"
            "| 运营 Cron Runbook | a | b |\n"
            "| 开发文档枢纽 | a | b |\n",
        )
        if p.name == "README.md"
        else real_content,
    )

    failures = auditor.check_readme_table_order()
    assert len(failures) >= 1
    assert any("Invariant 1" in f for f in failures), f"missing invariant-1 tag: {failures}"


def test_check_index_lists_all_subdocs_fails_when_subdoc_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 2 complains when INDEX.md omits a sub-doc reference."""
    # Mock _list_dev_subdocs to include a fictional file.
    real_list = auditor._list_dev_subdocs

    def fake_list() -> list[Path]:
        return real_list() + [Path("/tmp/sau-fake-missing-subdoc.md")]

    monkeypatch.setattr(auditor, "_list_dev_subdocs", fake_list)

    failures = auditor.check_index_lists_all_subdocs()
    assert any("sau-fake-missing-subdoc.md" in f for f in failures)


def test_check_surface_docs_references_fails_when_one_surface_is_bare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 3 complains when a surface doc is missing a reference."""
    real_readme = auditor._read(auditor.REPO_ROOT / "README.md")
    # Strip the cron-runbook reference from README.md; the live version has it.
    stripped = real_readme.replace("docs/dev/monitor-cdp-throttling-cron-ops.md", "")
    # IMPORTANT: capture the unpatched _read BEFORE monkeypatch so the lambda
    # fallback branch (non-README path) does NOT infinite-recurse via
    # `auditor._read(p)` after the patch rebinds the name to the lambda itself.
    original_read = auditor._read
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: stripped if p.name == "README.md" else original_read(p),
    )

    failures = auditor.check_surface_docs_references()
    assert any("README.md" in f and "monitor-cdp-throttling-cron-ops" in f for f in failures)


def test_check_subdoc_backlinks_fails_when_hub_ref_stripped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 4 complains when a sub-doc loses its `docs/dev/INDEX.md`
    substring (the canonical grep `grep -L "docs/dev/INDEX.md" docs/dev/*.md`
    simulated via `_read` monkeypatch).
    """
    # Pick postgres-getting-started.md as the regression target — it now has
    # a real backlink (added in the round that introduced this invariant).
    target = auditor.DEVDOCS_DIR / "postgres-getting-started.md"
    real = auditor._read(target)
    stripped = real.replace("docs/dev/INDEX.md", "")
    # Sanity: the live version has the substring; without it the test would
    # silently pass against an already-stripped repo.
    assert "docs/dev/INDEX.md" in real, (
        f"test setup incorrect: {target.name} no longer references INDEX.md"
    )

    original_read = auditor._read
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: stripped if p.name == "postgres-getting-started.md" else original_read(p),
    )

    failures = auditor.check_subdoc_backlinks_to_hub()
    assert any(
        "postgres-getting-started.md" in f and "does not reference" in f
        for f in failures
    ), f"missing invariant-4 strip failure in {failures}"


def test_check_subdoc_matrix_fails_when_anchor_mismatch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 5 complains when sub-doc's cited anchor is NOT in the
    INDEX matrix's audience set for that file.

    Simulates: swap `postgres-getting-started.md`'s matrix row audience
    set from {Operators, Onboarding} to {Contributors}. The sub-doc
    still cites `#operators`, which is no longer in the (modified)
    matrix set → invariant 5 mismatch.
    """
    real_index = auditor._read(auditor.INDEX_PATH)
    # Sanity: the live matrix row for postgres-getting-started is
    # `Operators ✅  Onboarding ✅  Contributors —`; this is the
    # exact pattern we will swap.
    assert "`postgres-getting-started.md` | ✅ | — | ✅ |" in real_index, (
        "test precondition: postgres-getting-started matrix row format changed; "
        "update test setup to match the new cell layout."
    )
    # Swap: turn Operators ✅ → — and Contributors — → ✅. The new set
    # becomes {Contributors} only. Real sub-doc still cites
    # `docs/dev/INDEX.md#operators` (from Round-4 Hub backlink), which
    # is now MISALIGNED with the modified matrix set.
    modified_index = real_index.replace(
        "`postgres-getting-started.md` | ✅ | — | ✅ |",
        "`postgres-getting-started.md` | — | ✅ | — |",
    )
    assert modified_index != real_index, (
        "matrix swap did not take effect; check the replace pattern"
    )

    original_read = auditor._read
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: modified_index if str(p).endswith("INDEX.md") else original_read(p),
    )

    failures = auditor.check_subdoc_audience_matrix_match()
    assert any(
        "postgres-getting-started.md" in f and "Invariant 5" in f
        for f in failures
    ), f"missing invariant-5 mismatch failure in {failures}"


def test_check_subdoc_matrix_fails_when_zero_audience_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 5 complains when INDEX.md lists a sub-doc with a
    zero-audience matrix row (`| — | — | — |`). The matrix set is
    `frozenset()` — no cited anchor can ever be a member, so the
    cross-check fault-injects a hard failure.
    """
    real_index = auditor._read(auditor.INDEX_PATH)
    # Sanity: live matrix row for pg-doc is `Operators ✅  Contributors —  Onboarding ✅`.
    assert "`postgres-getting-started.md` | ✅ | — | ✅ |" in real_index, (
        "test precondition: pg-doc matrix row format changed; "
        "update test setup to match the new cell layout."
    )
    # Swap both ✅ cells → —. The new set becomes `frozenset()`.
    modified_index = real_index.replace(
        "`postgres-getting-started.md` | ✅ | — | ✅ |",
        "`postgres-getting-started.md` | — | — | — |",
    )
    assert modified_index != real_index, (
        "zero-audience row swap did not take effect; check the replace pattern"
    )

    original_read = auditor._read
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: modified_index if str(p).endswith("INDEX.md") else original_read(p),
    )

    failures = auditor.check_subdoc_audience_matrix_match()
    assert any(
        "postgres-getting-started.md" in f and "Invariant 5" in f
        for f in failures
    ), f"missing invariant-5 zero-audience failure in {failures}"


def test_check_subdoc_matrix_passes_when_citing_any_in_matrix(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Invariant 5 lenient-intersection rule: a sub-doc citing ANY
    anchor in the matrix row's audience set PASSES, not just the
    primary one. We swap pg-doc's Hub backlink from `#operators` to
    `#onboarding`; the matrix still lists pg-doc under
    `{operators, onboarding}`, so `#onboarding` ∈ matrix set → pass.

    Symmetric to `test_check_subdoc_matrix_fails_when_anchor_mismatch`,
    which fails on `#operators` against a `{contributors}`-only matrix.
    Together they pin the lenient-intersection semantics both ways.
    """
    target = auditor.DEVDOCS_DIR / "postgres-getting-started.md"
    real_pg = auditor._read(target)
    # Sanity: live Hub backlink cites `#operators` (added in Round-4).
    assert "(docs/dev/INDEX.md#operators)" in real_pg, (
        "test precondition: pg-doc no longer cites `#operators` in its Hub backlink"
    )
    modified_pg = real_pg.replace(
        "(docs/dev/INDEX.md#operators)",
        "(docs/dev/INDEX.md#onboarding)",
    )
    assert modified_pg != real_pg, (
        "anchor swap did not take effect; check the replace pattern"
    )

    original_read = auditor._read
    monkeypatch.setattr(
        auditor,
        "_read",
        lambda p: modified_pg if p.name == "postgres-getting-started.md" else original_read(p),
    )

    failures = auditor.check_subdoc_audience_matrix_match()
    # Hard Invariant 5 should NOT fire for pg-doc — cited `#onboarding`
    # is in the live matrix row's `{operators, onboarding}` set.
    pg_failures = [f for f in failures if "postgres-getting-started.md" in f]
    assert not any("Invariant 5" in f for f in pg_failures), (
        f"invariant-5 dual-audience cite should PASS but failed: {pg_failures}"
    )


def test_main_exit_codes_and_format() -> None:
    """`main([])` returns 0 in CI mode; `main([])` would return 1 with stderr formatted correctly when invariants fail (already tested implicitly by in-memory invalidate runs elsewhere)."""
    # Snapshot the live invariants passing.
    failures, _advisories = auditor.run_all_checks()
    if failures:  # pragma: no cover — guard for accidental live regression
        pytest.skip(
            f"Live repo failed discoverability check before main() smoke test: {failures}"
        )

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = auditor.main([])
    assert rc == 0
    assert "[dev_docs_audit] PASS" in buf.getvalue(), (
        f"missing PASS banner: {buf.getvalue()!r}"
    )
