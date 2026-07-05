"""YouTube platform operations — AC #2 smoke test.

A new platform needs only this file + a 6-line PLATFORM_PARSER_CONFIG
entry in cli/parser.py to be CLI-recognisable. Dispatch wiring is a
separate refactor; ``sau youtube login`` raises ``RuntimeError:
Unsupported platform`` at the dispatch layer (expected signal that
the parser worked but the dispatcher hasn't been wired yet).
"""
from __future__ import annotations

from cli.utils import resolve_account_file
from uploader.youtube_uploader.main import YouTubeVideo, cookie_auth, youtube_setup


async def login(account_name, headless=True, qrcode_callback=None):
    # qrcode_callback unused — YouTube uses interactive Google auth, no QR.
    account_file = resolve_account_file('youtube', account_name)
    return await youtube_setup(str(account_file), handle=True, return_detail=True, headless=headless)


async def check(account_name):
    account_file = resolve_account_file('youtube', account_name)
    if not account_file.exists():
        return False
    return await cookie_auth(str(account_file))


async def upload_video(
    account_name, video_file, title, tags,
    description='', thumbnail_file=None, visibility='public',
    debug=True, headless=True,
):
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(',') if t.strip()]
    account_file = resolve_account_file('youtube', account_name)
    if not await youtube_setup(str(account_file), handle=False):
        raise RuntimeError(f'YouTube cookie missing/expired: {account_file}. Run `sau youtube login --account {account_name}` first.')
    app = YouTubeVideo(
        title=title, file_path=str(video_file), tags=tags, account_file=str(account_file),
        description=description, thumbnail_path=str(thumbnail_file) if thumbnail_file else None,
        visibility=visibility, debug=debug, headless=headless,
    )
    await app.main()
    return account_file
