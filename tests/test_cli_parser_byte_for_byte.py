"""Byte-for-byte structural equivalence vs ``git show HEAD:cli/parser.py``.

Locks in the Phase-1 acceptance criterion of
``openspec/changes/cli-uploader-architecture-consistency`` (AC #1) by
walking the new ``build_parser()`` and the pre-refactor parser from git
HEAD, then diffing their ``_actions`` trees. We inspect ``_actions``
directly rather than calling ``format_help()`` so the test is robust to
argparse implementation details (and side-steps the unrelated
``%Y``-in-help-string quirk in Python 3.14+).

LIFECYCLE
---------
This is a **one-shot PR-time test**. Once the refactor is merged, ``git
show HEAD:cli/parser.py`` returns the *new* parser, so the comparison
trivially passes (new-vs-new). The test guards against that by skipping
when the new ``cli.parser`` exposes a ``__refactor_marker__`` attribute,
which the refactor is expected to add before merge — see
``openspec/changes/cli-uploader-architecture-consistency`` Task 1.6
"delete on merge". After the refactor merges, this file should be
deleted (not just skipped) in a follow-up commit so the parser surface
remains covered by the regular ``test_sau_browser_cli.py`` /
``test_sau_bilibili_cli.py`` unit tests.

CI NOTE
-------
GitHub Actions' ``actions/checkout@v4`` defaults to ``fetch-depth: 1``
which still includes the merge commit, so ``git show HEAD:<path>`` is
available — but a truly shallow ``--depth 1`` clone that never fetches
the parent would fail. The ``shutil.which('git')`` guard + a try/except
around the subprocess call makes the test skip cleanly in either case.
"""
from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from types import ModuleType

import pytest


def _action_signature(action) -> tuple:
    """Public contract of an argparse.Action — what callers actually see."""
    return (
        tuple(action.option_strings),
        action.required,
        action.default,
        type(action.type).__name__ if action.type is not None else None,
        tuple(action.choices) if action.choices is not None else None,
        action.help,
    )


def _walk_parser(parser, path: str = ''):
    for action in parser._actions:
        yield (path, _action_signature(action))
    for action in parser._actions:
        choices = getattr(action, 'choices', None)
        if isinstance(choices, dict):
            for name, sub in choices.items():
                if isinstance(sub, type(parser)):
                    yield from _walk_parser(sub, f'{path}/{name}')


def _load_old_parser_module(tmp_path: Path) -> ModuleType:
    """Materialise the pre-refactor parser from git HEAD as an importable module.

    Writes the pre-refactor source to a per-test temp file (so parallel
    pytest workers don't race on a shared ``/tmp/`` path) and loads it
    under a uuid-suffixed module name (so the importlib registry never
    collides with a real ``cli.parser`` import).
    """
    project_root = Path(__file__).resolve().parent.parent
    result = subprocess.run(
        ['git', 'show', 'HEAD:cli/parser.py'],
        capture_output=True, text=True, check=True,
        cwd=project_root,
    )
    old_path = tmp_path / f'_sau_old_cli_parser_{uuid.uuid4().hex}.py'
    old_path.write_text(result.stdout)
    module_name = f'_sau_old_cli_parser_{uuid.uuid4().hex}'
    spec = importlib.util.spec_from_file_location(module_name, old_path)
    module = importlib.util.module_from_spec(spec)
    inserted = str(project_root) not in sys.path
    if inserted:
        sys.path.insert(0, str(project_root))
    try:
        spec.loader.exec_module(module)
    finally:
        if inserted:
            sys.path.remove(str(project_root))
    return module


@pytest.mark.skipif(
    shutil.which('git') is None,
    reason='git binary not available — cannot diff against pre-refactor parser',
)
def test_parser_byte_for_byte_against_git_head(tmp_path):
    # Skip if the refactor has already been merged (the new cli.parser
    # exposes a marker the refactor is expected to add). See LIFECYCLE
    # block in the module docstring.
    from cli import parser as new_parser_module
    from cli.parser import build_parser  # new registry-driven parser
    if getattr(new_parser_module, '__refactor_marker__', False):
        pytest.skip(
            'refactor already merged — `git show HEAD:cli/parser.py` would '
            'return the new parser, making this test a no-op. Delete the test.'
        )

    try:
        old_module = _load_old_parser_module(tmp_path)
    except subprocess.CalledProcessError as exc:
        pytest.skip(f'git history unavailable (likely shallow CI clone): {exc}')

    old_parser = old_module.build_parser()
    new_parser = build_parser()

    old_sig = sorted(_walk_parser(old_parser))
    new_sig = sorted(_walk_parser(new_parser))

    only_in_old = set(old_sig) - set(new_sig)
    only_in_new = set(new_sig) - set(old_sig)
    assert old_sig == new_sig, (
        f'Parser structure diverged. '
        f'old={len(old_sig)} actions, new={len(new_sig)} actions. '
        f'Only in OLD: {sorted(only_in_old)!r}. '
        f'Only in NEW: {sorted(only_in_new)!r}.'
    )
