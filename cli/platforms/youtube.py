"""YouTube platform operations."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from cli.models import YoutubeVideoUploadRequest
from cli.utils import resolve_account_file
from uploader.youtube_uploader.main import YouTubeVideo, cookie_auth, youtube_setup


async def login(account_name: str, headless: bool = False, qrcode_callback=None) -> Any:
    """Login to YouTube (interactive Google account; headed Chrome recommended)."""
    # qrcode_callback unused — YouTube uses interactive Google auth, no QR.
    account_file = resolve_account_file("youtube", account_name)
    return await youtube_setup(
        str(account_file),
        handle=True,
        return_detail=True,
        headless=headless,
    )


async def check(account_name: str) -> bool:
    """Check if YouTube storage_state is still valid."""
    account_file = resolve_account_file("youtube", account_name)
    if not account_file.exists():
        return False
    return await cookie_auth(str(account_file))


async def upload_video(request: YoutubeVideoUploadRequest) -> Path:
    """Upload one video to YouTube Studio."""
    account_file = resolve_account_file("youtube", request.account_name)
    is_ready = await youtube_setup(str(account_file), handle=False)
    if not is_ready:
        raise RuntimeError(
            f"YouTube cookie is missing or expired: {account_file}. "
            f"Run `sau youtube login --account {request.account_name}` first "
            "(must use headed Chrome on a real desktop)."
        )
    app = YouTubeVideo(
        title=request.title,
        file_path=str(request.video_file),
        tags=request.tags,
        account_file=str(account_file),
        description=request.description,
        thumbnail_path=str(request.thumbnail_file) if request.thumbnail_file else None,
        playlist=request.playlist,
        visibility=request.visibility or "public",
        debug=request.debug,
        headless=request.headless,
    )
    await app.main()
    return account_file
