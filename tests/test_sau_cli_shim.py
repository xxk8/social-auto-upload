"""Lock in the Phase-2 slim shim contract for sau_cli.py.

Phase 2 of openspec/changes/cli-uploader-architecture-consistency
reduces sau_cli.py from a 49-line re-export module to a thin
entry-point that only re-exports ``main`` (needed by pyproject.toml's
``sau = "sau_cli:main"`` console script).

This test file locks in the four clauses of the slim contract:

* AC #6 / D2: ``sau_cli.main`` is the same callable as ``cli.main.main``
  (not a wrapper), so the console script executes the real entry point
  without indirection.
* Task 3.4: the shim is at most 5 code lines (6 with one line of
  headroom for a future ``from __future__`` or ``__all__``).
* Task 3.5: ``python sau_cli.py --help`` is byte-for-byte equivalent
  to ``python -m cli.main --help``.
* D2: the shim does NOT re-export platform-specific symbols
  (``login_*`` / ``check_*`` / ``upload_*`` / ``build_parser`` /
  ``dispatch``). Callers must import from ``cli.parser``,
  ``cli.dispatchers``, ``cli.platforms`` directly.

These tests are static checks; they do NOT need a browser or cookie
file. Subprocess-based checks capture ``--help`` stdout, which only
exercises argparse wiring — no network, no Playwright.
"""
from __future__ import annotations

import ast
import inspect
import re
import subprocess
import sys
from pathlib import Path

import pytest

SHIM_PATH = Path(__file__).resolve().parent.parent / 'sau_cli.py'
PROJECT_ROOT = SHIM_PATH.parent


def _shim_source() -> str:
    return SHIM_PATH.read_text(encoding='utf-8')


def _shim_code_line_count() -> int:
    """Count of code lines: non-blank, non-docstring lines.

    The proposal's D2 design rationale is "sau_cli.py is a double entry
    point / mental burden" — i.e. the code must stay minimal. A multi-
    line docstring is documentation, not code, and should not eat the
    budget. Physical line count is fragile to harmless edits (a blank
    line, a reflowed docstring, a future ``from __future__ import
    annotations``).

    Uses ``ast.parse`` to find the module docstring's line range. We
    walk ``tree.body`` to find the first Expr-Constant-string node
    (the actual docstring), rather than assuming ``tree.body[0]`` —
    that way a future ``from __future__ import annotations`` BEFORE
    the docstring still works correctly.
    """
    tree = ast.parse(_shim_source())
    docstring_end_lineno = 0
    for stmt in tree.body:
        if (
            isinstance(stmt, ast.Expr)
            and isinstance(stmt.value, ast.Constant)
            and isinstance(stmt.value.value, str)
        ):
            docstring_end_lineno = stmt.end_lineno or 0
            break

    code_lines = 0
    for idx, line in enumerate(_shim_source().splitlines(), start=1):
        if idx <= docstring_end_lineno:
            continue  # inside the module docstring
        if not line.strip():
            continue  # blank line
        code_lines += 1
    return code_lines


# ────────────────────────────────────────────────────────────────────
# Task 3.4 — line count
# ────────────────────────────────────────────────────────────────────


def test_shim_is_at_most_6_code_lines() -> None:
    """Task 3.4: shim <= 6 code lines (5 per D2 + 1 line of headroom).

    Counts code lines (non-blank, non-docstring) rather than physical
    lines, so a docstring reflow or a future ``from __future__ import
    annotations`` does not eat the budget. The 5-line ideal matches
    the design.md D2 example:

        import sys
        from cli.main import main
        if __name__ == "__main__":
            sys.exit(main())

    A 6-line cap gives 1 line of headroom (e.g. for ``from __future__``
    or a future ``__all__``) without re-architecting the test.
    """
    count = _shim_code_line_count()
    assert count <= 6, (
        f"sau_cli.py has {count} code lines; "
        "slim it to <= 5 per design.md D2. The 6-line cap is the test's "
        "one-line headroom for `from __future__ import annotations` or a future `__all__`."
    )


# ────────────────────────────────────────────────────────────────────
# D2 — no platform re-exports (negative + positive check)
# ────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    'forbidden_pattern',
    [
        re.compile(r'^from\s+cli\.platforms\b', re.MULTILINE),    # from-form
        re.compile(r'^from\s+cli\.parser\b', re.MULTILINE),       # from-form
        re.compile(r'^from\s+cli\.dispatchers\b', re.MULTILINE), # from-form
        re.compile(r'^import\s+cli\.platforms\b', re.MULTILINE),  # bare import
        re.compile(r'^import\s+cli\.parser\b', re.MULTILINE),     # bare import
        re.compile(r'^import\s+cli\.dispatchers\b', re.MULTILINE),# bare import
    ],
    ids=[
        'from-cli-platforms', 'from-cli-parser', 'from-cli-dispatchers',
        'import-cli-platforms', 'import-cli-parser', 'import-cli-dispatchers',
    ],
)
def test_shim_does_not_re_export_internal_cli_symbols(forbidden_pattern: re.Pattern[str]) -> None:
    """D2: the shim must not import or re-export internal CLI symbols.

    Covers both the ``from cli.X import Y`` form (the obvious re-export
    shape) AND the bare ``import cli.X`` form (which would also leak
    the internal module into ``sau_cli``'s namespace and serve as a
    re-export for ``from sau_cli.X import Y`` callers).
    """
    src = _shim_source()
    match = forbidden_pattern.search(src)
    assert match is None, (
        "sau_cli.py must not import or re-export internal CLI symbols. "
        f"Found forbidden pattern: {forbidden_pattern.pattern!r}. "
        "Callers should import from cli.parser / cli.dispatchers / cli.platforms directly."
    )


def test_shim_only_imports_main_from_cli_main() -> None:
    """D2: the shim's only ``from cli.\\u2026`` import is ``from cli.main import main``.

    The positive half of the negative parametrize check above. A naive
    list-equality check is whitespace-fragile, so we count + match by
    prefix-and-keyword instead of full-line equality.
    """
    src = _shim_source()
    business_imports = [
        line.strip() for line in src.splitlines()
        if line.startswith('from cli.')
    ]
    assert len(business_imports) == 1, (
        "sau_cli.py should have exactly one `from cli.\\u2026` import line. "
        f"Found: {business_imports!r}."
    )
    line = business_imports[0]
    # Allow trailing comments (e.g. `# noqa: F401`) but not reformatting
    # like a multi-line parenthesised import. Multi-line imports would
    # not match this prefix and would fail the test, which is the
    # desired behaviour for a 5-line shim.
    assert line.startswith('from cli.main import ') and 'main' in line, (
        "sau_cli.py's only `from cli.\\u2026` import should target cli.main and "
        f"import `main`. Got: {line!r}."
    )


# ────────────────────────────────────────────────────────────────────
# AC #6 — sau_cli.main IS cli.main.main
# ────────────────────────────────────────────────────────────────────


def test_shim_main_is_identical_to_cli_main_main() -> None:
    """AC #6: ``sau_cli.main`` is the same function object as ``cli.main.main``.

    NOT a wrapper. The pyproject console script (``sau = "sau_cli:main"``)
    must execute the real entry point without indirection, otherwise
    behaviour drift between the two paths becomes inevitable.
    """
    import cli.main
    import sau_cli

    assert hasattr(sau_cli, 'main'), (
        'sau_cli must re-export `main` for the pyproject.toml console script.'
    )
    assert sau_cli.main is cli.main.main, (
        'sau_cli.main should be the EXACT same function object as cli.main.main '
        '(not a wrapper). Identity (is) check failed - likely someone re-defined main.'
    )


def test_shim_entry_point_calls_main_exactly_once() -> None:
    """D2: the entry-point block should call ``main()`` exactly once.

    Guards against accidental double-invocation, sys.exit wrapping, or
    post-processing that could diverge the shim's CLI behaviour from
    ``python -m cli.main``.
    """
    import sau_cli

    source = inspect.getsource(sau_cli)
    main_calls = source.count('main()')
    # Exactly one call site (the `sys.exit(main())` in the __main__ block).
    # Import statements like `from cli.main import main` are not `main()` calls.
    assert main_calls == 1, (
        f'sau_cli.py should call main() exactly once on the entry-point path. '
        f'Found {main_calls} occurrences of `main()` in the shim source.'
    )


# ────────────────────────────────────────────────────────────────────
# Task 3.5 — sau_cli.py --help ≡ python -m cli.main --help
# ────────────────────────────────────────────────────────────────────


def _run_help(argv: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, *argv, '--help'],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )


def test_shim_help_matches_cli_main_help() -> None:
    """Task 3.5: ``python sau_cli.py --help`` is byte-for-byte equivalent to ``python -m cli.main --help``."""
    shim_proc = _run_help(['sau_cli.py'])
    cli_main_proc = _run_help(['-m', 'cli.main'])

    assert shim_proc.returncode == 0, (
        f'python sau_cli.py --help exited {shim_proc.returncode}. '
        f'stderr: {shim_proc.stderr!r}'
    )
    assert cli_main_proc.returncode == 0, (
        f'python -m cli.main --help exited {cli_main_proc.returncode}. '
        f'stderr: {cli_main_proc.stderr!r}'
    )
    assert shim_proc.stdout == cli_main_proc.stdout, (
        'sau_cli.py --help diverged from python -m cli.main --help.\n'
        f'--- sau_cli.py stdout ({len(shim_proc.stdout)} bytes) ---\n'
        f'{shim_proc.stdout!r}\n'
        f'--- python -m cli.main stdout ({len(cli_main_proc.stdout)} bytes) ---\n'
        f'{cli_main_proc.stdout!r}'
    )


def test_shim_help_lists_every_registered_platform() -> None:
    """Sanity check: the shim should exit 0 on --help and list every platform in PLATFORM_PARSER_CONFIG.

    Derives the platform list from the source of truth (the parser
    registry) rather than hardcoding, so the next platform added (e.g.
    YouTube in ``youtube-full-integration``) is automatically covered.
    """
    from cli.parser import PLATFORM_PARSER_CONFIG

    proc = _run_help(['sau_cli.py'])
    assert proc.returncode == 0, (
        f'python sau_cli.py --help exited {proc.returncode}. '
        f'stderr: {proc.stderr!r}'
    )
    for platform in PLATFORM_PARSER_CONFIG:
        assert platform in proc.stdout, (
            f'--help output is missing platform {platform!r} (from PLATFORM_PARSER_CONFIG). '
            'The shim may not be importing the registry correctly.'
        )
