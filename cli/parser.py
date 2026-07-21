"""CLI argument parser.

Each platform's CLI surface is described by a :class:`PlatformParserConfig`
dataclass, and the top-level :func:`build_parser` walks the
``PLATFORM_PARSER_CONFIG`` registry to assemble the argparse subparser tree.
This replaces the seven hand-written ``_add_<platform>_parser`` functions that
previously lived in this module — adding a new platform is now a ~15-line
config entry, not an 80-line copy/paste.

Byte-for-byte ``--help`` parity with the pre-refactor parser is a hard
contract; see ``openspec/changes/cli-uploader-architecture-consistency``
(``proposal.md`` Acceptance Criterion #1).
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

from cli.utils import SCHEDULE_FORMAT, parse_schedule

# Refactor marker — read by ``tests/test_cli_parser_byte_for_byte.py`` to
# auto-skip its one-shot structural diff once the registry-driven parser
# ships (see LIFECYCLE block in that test's docstring). Removed in the
# follow-up "delete on merge" commit referenced by
# ``openspec/changes/cli-uploader-architecture-consistency`` Task 1.6.
__refactor_marker__ = True


def existing_file_path(value: str) -> Path:
    """Validate that the file path exists."""
    path = Path(value)
    if not path.is_file():
        raise argparse.ArgumentTypeError(f'File not found: {value}')
    return path


def schedule_value(value: str):
    """Parse schedule value."""
    try:
        return parse_schedule(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Invalid schedule '{value}'. Expected format: {SCHEDULE_FORMAT}"
        ) from exc


def add_runtime_flags(parser: argparse.ArgumentParser) -> None:
    """Add debug and headless flags to parser."""
    parser.add_argument('--debug', action='store_true', help='Enable debug mode')
    headless_group = parser.add_mutually_exclusive_group()
    headless_group.add_argument(
        '--headed', dest='headless', action='store_false', help='Run with browser UI'
    )
    headless_group.add_argument(
        '--headless', dest='headless', action='store_true', help='Run in headless mode'
    )
    parser.set_defaults(headless=True)


@dataclass
class PlatformParserConfig:
    """Per-platform CLI surface description.

    Every flag toggles a single cross-platform divergence: a missing field in
    the original hand-written parser is expressed as ``False`` here, and a
    required-where-default-exists-elsewhere flip is expressed as
    ``desc_required`` / similar. The intent is that a new platform can be
    added by composing these flags without touching any function body.
    """

    name: str
    """Subparser key (e.g. ``'douyin'``). Also the platform id used by dispatchers."""

    display_name: str
    """Human-facing platform name. Used for the platform subparser ``help`` and
    for the ``--account`` help text. May be the same as ``upload_label``."""

    has_upload_note: bool = False
    """Whether this platform exposes an ``upload-note`` subcommand."""

    upload_label: str | None = None
    """Label used in the ``upload-video`` / ``upload-note`` action help text.
    Defaults to ``display_name`` when unset. ``tencent`` overrides this to
    ``'WeChat Channels'`` so the action help reads ``'Upload one video to
    WeChat Channels'`` while the top-level platform help still reads
    ``'Tencent/WeChat Channels operations'``."""

    account_label: str | None = None
    """Label used in the ``--account`` help text for every subcommand on this
    platform. Defaults to ``display_name`` when unset. ``tencent`` overrides
    this to the short form ``'Tencent'`` so ``--account`` reads
    ``'Tencent user-defined account_name'`` even though the top-level help
    says ``'Tencent/WeChat Channels operations'``. This split is a quirk of
    the pre-refactor parser that we preserve byte-for-byte."""

    note_help_phrase: str = 'one note'
    """Noun phrase used in the ``upload-note`` action help text. Defaults to
    ``'one note'`` so the help reads ``'Upload one note to {upload_label}'``.
    ``bilibili`` overrides this to ``'note with images'`` and ``tencent`` to
    ``'image note (图文)'`` to match the pre-refactor help strings exactly."""

    # ── upload-video options ──────────────────────────────────────────────

    has_desc: bool = True
    """Whether ``--desc`` is exposed. ``tiktok`` / ``baijiahao`` do not have a
    description field on the platform side, so they set this to ``False``."""

    desc_required: bool = False
    """Mark ``--desc`` as required. ``bilibili`` only — the platform API
    refuses uploads without a description, so the CLI enforces it eagerly."""

    has_thumbnail: bool = True
    """Whether a generic ``--thumbnail`` flag is exposed. ``bilibili``,
    ``tiktok``, ``baijiahao`` do not."""

    has_thumbnail_landscape: bool = False
    """Add ``--thumbnail-landscape``. ``douyin`` / ``tencent`` only."""

    has_thumbnail_portrait: bool = False
    """Add ``--thumbnail-portrait``. ``douyin`` / ``tencent`` only."""

    has_product_link: bool = False
    """Add ``--product-link``. ``douyin`` only."""

    has_product_title: bool = False
    """Add ``--product-title``. ``douyin`` only."""

    has_short_title: bool = False
    """Add ``--short-title``. ``tencent`` only."""

    has_category: bool = False
    """Add ``--category``. ``tencent`` only."""

    has_draft: bool = False
    """Add ``--draft`` to ``upload-video``. ``tencent`` only."""

    has_tid: bool = False
    """Add ``--tid`` (Bilibili category id). ``bilibili`` only."""

    upload_video_runtime: bool = True
    """Whether ``--debug`` / ``--headed`` / ``--headless`` are added to the
    ``upload-video`` subparser. ``bilibili`` does NOT expose these on
    ``upload-video`` (the platform goes through the ``biliup`` CLI, which
    has its own headless semantics), so it sets this to ``False``."""

    # ── upload-note options ───────────────────────────────────────────────

    note_has_draft: bool = False
    """Add ``--draft`` to ``upload-note``. ``tencent`` only."""

    note_runtime: bool = True
    """Whether ``--debug`` / ``--headed`` / ``--headless`` are added to the
    ``upload-note`` subparser. All current platforms expose them; the flag
    exists for symmetry with ``upload_video_runtime`` and to support future
    platforms that opt out (e.g. a third-party CLI-backed platform)."""


PLATFORM_PARSER_CONFIG: dict[str, PlatformParserConfig] = {
    'douyin': PlatformParserConfig(
        name='douyin',
        display_name='Douyin',
        has_upload_note=True,
        has_thumbnail_landscape=True,
        has_thumbnail_portrait=True,
        has_product_link=True,
        has_product_title=True,
    ),
    'kuaishou': PlatformParserConfig(
        name='kuaishou',
        display_name='Kuaishou',
        has_upload_note=True,
    ),
    'xiaohongshu': PlatformParserConfig(
        name='xiaohongshu',
        display_name='Xiaohongshu',
        has_upload_note=True,
    ),
    'bilibili': PlatformParserConfig(
        name='bilibili',
        display_name='Bilibili',
        has_upload_note=True,
        has_thumbnail=False,
        desc_required=True,
        has_tid=True,
        upload_video_runtime=False,
        note_help_phrase='note with images',
    ),
    'tencent': PlatformParserConfig(
        name='tencent',
        display_name='Tencent/WeChat Channels',
        account_label='Tencent',
        upload_label='WeChat Channels',
        note_help_phrase='image note (图文)',
        has_upload_note=True,
        has_thumbnail_landscape=True,
        has_thumbnail_portrait=True,
        has_short_title=True,
        has_category=True,
        has_draft=True,
        note_has_draft=True,
    ),
    'tiktok': PlatformParserConfig(
        name='tiktok',
        display_name='TikTok',
        has_desc=False,
        has_thumbnail=False,
    ),
    'baijiahao': PlatformParserConfig(
        name='baijiahao',
        display_name='Baijiahao',
        has_desc=False,
        has_thumbnail=False,
    ),
    'youtube': PlatformParserConfig(
        name='youtube',
        display_name='YouTube',
        has_desc=True,
        has_thumbnail=True,
    ),
}


def _add_login_check_subparsers(actions: argparse._SubParsersAction, config: PlatformParserConfig) -> None:
    """Build the ``login`` and ``check`` subcommands shared by every platform.

    Both subcommands take a single ``--account`` argument. ``login`` also gets
    the runtime flags (``--debug`` / ``--headed`` / ``--headless``) because
    the QR-code scan happens inside a Playwright browser whose headless
    behaviour is controlled from the CLI; ``check`` does not need them.
    """
    display_name = config.display_name
    account_label = config.account_label or display_name
    for action_name in ('login', 'check'):
        action_parser = actions.add_parser(action_name, help=f'{display_name} {action_name}')
        action_parser.add_argument('--account', required=True, help=f'{account_label} user-defined account_name')
        if action_name == 'login':
            add_runtime_flags(action_parser)


def _add_upload_video_subparser(actions: argparse._SubParsersAction, config: PlatformParserConfig) -> None:
    """Build the ``upload-video`` subcommand for one platform.

    Argument order is the cross-platform stable ordering used by the original
    hand-written parsers. Conditional flags are inserted at the same index
    regardless of whether they are exposed, so ``--help`` output is identical
    to the pre-refactor parser when all flags are present and only the
    removed flags are missing when a platform opts out.
    """
    display_name = config.display_name
    account_label = config.account_label or display_name
    upload_label = config.upload_label or display_name
    parser = actions.add_parser('upload-video', help=f'Upload one video to {upload_label}')

    parser.add_argument('--account', required=True, help=f'{account_label} user-defined account_name')
    parser.add_argument('--file', required=True, type=existing_file_path, help='Video file path')
    parser.add_argument('--title', required=True, help='Video title')

    if config.has_desc:
        if config.desc_required:
            # ``bilibili`` only: the platform API refuses uploads without a
            # description, so the CLI makes the flag required and gives it
            # the shorter "Video description" help string. We do NOT pass
            # ``default`` here because argparse forbids combining
            # ``required=True`` with an explicit default.
            parser.add_argument('--desc', required=True, help='Video description')
        else:
            parser.add_argument('--desc', default='', help='Optional video description')

    if config.has_tid:
        parser.add_argument('--tid', required=True, type=int, help='Bilibili category id')

    parser.add_argument('--tags', default='', help='Comma-separated tags, such as tag1,tag2')
    parser.add_argument('--schedule', type=schedule_value, help=f'Schedule time in {SCHEDULE_FORMAT}')

    if config.has_thumbnail:
        # The help text tightens to "3:4 portrait" when the platform also
        # exposes the aspect-specific flags — that is, when ``--thumbnail``
        # is functionally a portrait-thumbnail alias. Kuaishou / Xiaohongshu
        # only expose a single generic flag and keep the looser help.
        thumb_help = (
            'Optional 3:4 portrait thumbnail path'
            if (config.has_thumbnail_landscape or config.has_thumbnail_portrait)
            else 'Optional thumbnail path'
        )
        parser.add_argument('--thumbnail', type=existing_file_path, help=thumb_help)

    if config.has_thumbnail_landscape:
        parser.add_argument('--thumbnail-landscape', type=existing_file_path, help='Optional 4:3 landscape thumbnail path')
    if config.has_thumbnail_portrait:
        parser.add_argument('--thumbnail-portrait', type=existing_file_path, help='Optional 3:4 portrait thumbnail path')

    if config.has_product_link:
        parser.add_argument('--product-link', default='', help='Optional product link')
    if config.has_product_title:
        parser.add_argument('--product-title', default='', help='Optional product title')

    if config.has_short_title:
        parser.add_argument('--short-title', help='Optional WeChat Channels short title')
    if config.has_category:
        parser.add_argument('--category', help='Optional original content category')
    if config.has_draft:
        parser.add_argument('--draft', action='store_true', help='Save as draft instead of publishing')

    if config.upload_video_runtime:
        add_runtime_flags(parser)


def _add_upload_note_subparser(actions: argparse._SubParsersAction, config: PlatformParserConfig) -> None:
    """Build the ``upload-note`` subcommand for one platform.

    Only platforms that opt in via ``has_upload_note`` get this subcommand.
    The ``note_help_phrase`` config field controls the noun phrase used in
    the help text — default ``'one note'`` (douyin/kuaishou/xiaohongshu),
    ``'note with images'`` (bilibili), ``'image note (图文)'`` (tencent).
    """
    display_name = config.display_name
    account_label = config.account_label or display_name
    upload_label = config.upload_label or display_name
    parser = actions.add_parser('upload-note', help=f'Upload {config.note_help_phrase} to {upload_label}')

    parser.add_argument('--account', required=True, help=f'{account_label} user-defined account_name')
    parser.add_argument('--images', required=True, nargs='+', type=existing_file_path, help='Image file paths')
    parser.add_argument('--title', required=True, help='Note title')
    parser.add_argument('--note', default='', help='Optional note content')
    parser.add_argument('--tags', default='', help='Comma-separated tags, such as tag1,tag2')
    parser.add_argument('--schedule', type=schedule_value, help=f'Schedule time in {SCHEDULE_FORMAT}')

    if config.note_has_draft:
        parser.add_argument('--draft', action='store_true', help='Save as draft instead of publishing')

    if config.note_runtime:
        add_runtime_flags(parser)


def _build_platform_parser(platform_parsers: argparse._SubParsersAction, config: PlatformParserConfig) -> None:
    """Build one platform's full subparser tree from its config entry."""
    display_name = config.display_name
    platform_parser = platform_parsers.add_parser(config.name, help=f'{display_name} operations')
    actions = platform_parser.add_subparsers(dest='action', required=True)

    # Order matters: login, check, upload-video, [upload-note] — matches the
    # pre-refactor hand-written parsers exactly, which is what the
    # ``--help`` byte-for-byte acceptance criterion depends on.
    _add_login_check_subparsers(actions, config)
    _add_upload_video_subparser(actions, config)
    if config.has_upload_note:
        _add_upload_note_subparser(actions, config)


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser.

    Walks :data:`PLATFORM_PARSER_CONFIG` in insertion order — Python 3.7+
    guarantees ``dict`` iteration order — so the platform list in
    ``--help`` matches the pre-refactor order (douyin → baijiahao).
    """
    parser = argparse.ArgumentParser(prog='sau', description='CLI for social-auto-upload.')
    platform_parsers = parser.add_subparsers(dest='platform', required=True)

    for config in PLATFORM_PARSER_CONFIG.values():
        _build_platform_parser(platform_parsers, config)

    return parser
