"""Platform dispatchers for CLI commands."""
from __future__ import annotations

import argparse
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from cli.models import (
    BaijiahaoVideoUploadRequest, BilibiliNoteUploadRequest, BilibiliVideoUploadRequest,
    DouyinNoteUploadRequest, DouyinVideoUploadRequest, KuaishouNoteUploadRequest,
    KuaishouVideoUploadRequest, TencentNoteUploadRequest, TencentVideoUploadRequest,
    TiktokVideoUploadRequest, XiaohongshuNoteUploadRequest, XiaohongshuVideoUploadRequest,
    YoutubeVideoUploadRequest,
)
from cli.platforms import baijiahao, bilibili, douyin, kuaishou, tencent, tiktok, xiaohongshu, youtube
from cli.utils import parse_image_files, parse_tags
from uploader.douyin_uploader.main import DOUYIN_PUBLISH_STRATEGY_IMMEDIATE, DOUYIN_PUBLISH_STRATEGY_SCHEDULED
from uploader.ks_uploader.main import KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE, KUAISHOU_PUBLISH_STRATEGY_SCHEDULED
from uploader.tencent_uploader.main import TENCENT_PUBLISH_STRATEGY_IMMEDIATE, TENCENT_PUBLISH_STRATEGY_SCHEDULED
from uploader.xiaohongshu_uploader.main import XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE, XIAOHONGSHU_PUBLISH_STRATEGY_SCHEDULED

ExtraBuilder = Callable[[argparse.Namespace], dict[str, Any]]
AsyncFn = Callable[..., Awaitable[Any]]


@dataclass(slots=True)
class PlatformHandler:
    display_name: str
    login_fn: AsyncFn
    check_fn: AsyncFn
    upload_video_fn: AsyncFn | None = None
    upload_note_fn: AsyncFn | None = None
    video_request_cls: type | None = None
    note_request_cls: type | None = None
    publish_strategy_map: dict[str, str] | None = None
    video_has_description: bool = True
    video_has_thumbnail: bool = False
    video_has_publish_strategy: bool = True
    video_has_debug_headless: bool = True
    max_tags: int | None = None
    video_extra_builder: ExtraBuilder | None = None
    note_extra_builder: ExtraBuilder | None = None

def _douyin_video_extra(a: argparse.Namespace) -> dict[str, Any]:
    return {
        'thumbnail_file': a.thumbnail, 'thumbnail_landscape_file': a.thumbnail_landscape,
        'thumbnail_portrait_file': a.thumbnail_portrait,
        'product_link': a.product_link, 'product_title': a.product_title,
    }

def _bilibili_video_extra(a: argparse.Namespace) -> dict[str, Any]:
    return {'tid': a.tid}

def _tencent_video_extra(a: argparse.Namespace) -> dict[str, Any]:
    return {
        'thumbnail_file': a.thumbnail, 'thumbnail_landscape_file': a.thumbnail_landscape,
        'thumbnail_portrait_file': a.thumbnail_portrait,
        'short_title': a.short_title, 'category': a.category, 'is_draft': a.draft,
    }


def _youtube_video_extra(a: argparse.Namespace) -> dict[str, Any]:
    return {
        'thumbnail_file': getattr(a, 'thumbnail', None),
        'playlist': getattr(a, 'playlist', None) or None,
        'visibility': getattr(a, 'visibility', None) or 'public',
    }

def _tencent_note_extra(a: argparse.Namespace) -> dict[str, Any]:
    return {'is_draft': a.draft}

def _strategy(h: PlatformHandler, args: argparse.Namespace) -> str | None:
    if h.publish_strategy_map is None:
        return None
    return h.publish_strategy_map['scheduled' if args.schedule else 'immediate']

def _check_tags(h: PlatformHandler, tags: list[str]) -> int | None:
    if h.max_tags is not None and len(tags) > h.max_tags:
        print(f'错误：小红书标签最多 {h.max_tags} 个，当前提供了 {len(tags)} 个: {tags}', file=sys.stderr)
        return 1
    return None

def _build_video_request(args: argparse.Namespace, h: PlatformHandler, tags: list[str]) -> Any:
    assert h.video_request_cls is not None
    kw: dict[str, Any] = {
        'account_name': args.account, 'video_file': args.file, 'title': args.title,
        'tags': tags, 'publish_date': args.schedule or 0,
    }
    if h.video_has_description:
        kw['description'] = args.desc
    if h.video_has_thumbnail:
        kw['thumbnail_file'] = args.thumbnail
    if h.video_has_publish_strategy:
        kw['publish_strategy'] = _strategy(h, args)
    if h.video_has_debug_headless:
        kw['debug'] = args.debug
        kw['headless'] = args.headless
    if h.video_extra_builder is not None:
        kw.update(h.video_extra_builder(args))
    return h.video_request_cls(**kw)

def _build_note_request(args: argparse.Namespace, h: PlatformHandler, tags: list[str]) -> Any:
    assert h.note_request_cls is not None
    kw: dict[str, Any] = {
        'account_name': args.account, 'image_files': parse_image_files(args.images),
        'title': args.title, 'note': args.note, 'tags': tags,
        'publish_date': args.schedule or 0, 'debug': args.debug, 'headless': args.headless,
        'publish_strategy': _strategy(h, args) or ('scheduled' if args.schedule else 'immediate'),
    }
    if h.note_extra_builder is not None:
        kw.update(h.note_extra_builder(args))
    return h.note_request_cls(**kw)

async def _dispatch_platform(args: argparse.Namespace, h: PlatformHandler) -> int:
    name = h.display_name
    if args.action == 'login':
        result = await h.login_fn(args.account, headless=args.headless)
        if not result['success']:
            raise RuntimeError(result['message'])
        print(f"{name} login flow completed: {result['account_file']}")
        return 0
    if args.action == 'check':
        is_valid = await h.check_fn(args.account)
        print('valid' if is_valid else 'invalid')
        return 0 if is_valid else 1
    if args.action == 'upload-video':
        if h.upload_video_fn is None or h.video_request_cls is None:
            raise RuntimeError(f'Unsupported {name} action: {args.action}')
        tags = parse_tags(args.tags)
        if (err := _check_tags(h, tags)) is not None:
            return err
        request = _build_video_request(args, h, tags)
        await h.upload_video_fn(request)
        print(f'{name} video upload submitted: {request.video_file}')
        return 0
    if args.action == 'upload-note':
        if h.upload_note_fn is None or h.note_request_cls is None:
            raise RuntimeError(f'Unsupported {name} action: {args.action}')
        tags = parse_tags(args.tags)
        if (err := _check_tags(h, tags)) is not None:
            return err
        request = _build_note_request(args, h, tags)
        await h.upload_note_fn(request)
        print(f'{name} note upload submitted: {len(request.image_files)} images')
        return 0
    raise RuntimeError(f'Unsupported {name} action: {args.action}')

def _ps(imm: str, sch: str) -> dict[str, str]:
    return {'immediate': imm, 'scheduled': sch}


def _bind(mod: Any, name: str) -> AsyncFn:
    """Attribute-lookup wrapper so ``patch('cli.platforms.x.fn')`` reaches dispatch.

    Storing bare ``mod.fn`` in PLATFORM_HANDLERS freezes the function object at
    import time; tests that patch the module attribute would never hit it.
    """

    async def _fn(*args: Any, **kwargs: Any) -> Any:
        return await getattr(mod, name)(*args, **kwargs)

    _fn.__name__ = name
    _fn.__qualname__ = f'{getattr(mod, "__name__", "mod")}.{name}'
    return _fn


PLATFORM_HANDLERS: dict[str, PlatformHandler] = {
    'douyin': PlatformHandler(
        'Douyin',
        _bind(douyin, 'login'),
        _bind(douyin, 'check'),
        _bind(douyin, 'upload_video'),
        _bind(douyin, 'upload_note'),
        DouyinVideoUploadRequest,
        DouyinNoteUploadRequest,
        _ps(DOUYIN_PUBLISH_STRATEGY_IMMEDIATE, DOUYIN_PUBLISH_STRATEGY_SCHEDULED),
        video_extra_builder=_douyin_video_extra,
    ),
    'kuaishou': PlatformHandler(
        'Kuaishou',
        _bind(kuaishou, 'login'),
        _bind(kuaishou, 'check'),
        _bind(kuaishou, 'upload_video'),
        _bind(kuaishou, 'upload_note'),
        KuaishouVideoUploadRequest,
        KuaishouNoteUploadRequest,
        _ps(KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE, KUAISHOU_PUBLISH_STRATEGY_SCHEDULED),
        video_has_thumbnail=True,
    ),
    'xiaohongshu': PlatformHandler(
        'Xiaohongshu',
        _bind(xiaohongshu, 'login'),
        _bind(xiaohongshu, 'check'),
        _bind(xiaohongshu, 'upload_video'),
        _bind(xiaohongshu, 'upload_note'),
        XiaohongshuVideoUploadRequest,
        XiaohongshuNoteUploadRequest,
        _ps(XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE, XIAOHONGSHU_PUBLISH_STRATEGY_SCHEDULED),
        video_has_thumbnail=True,
        max_tags=10,
    ),
    'bilibili': PlatformHandler(
        'Bilibili',
        _bind(bilibili, 'login'),
        _bind(bilibili, 'check'),
        _bind(bilibili, 'upload_video'),
        _bind(bilibili, 'upload_note'),
        BilibiliVideoUploadRequest,
        BilibiliNoteUploadRequest,
        _ps('immediate', 'scheduled'),
        video_has_publish_strategy=False,
        video_has_debug_headless=False,
        video_extra_builder=_bilibili_video_extra,
    ),
    'tencent': PlatformHandler(
        'Tencent/WeChat Channels',
        _bind(tencent, 'login'),
        _bind(tencent, 'check'),
        _bind(tencent, 'upload_video'),
        _bind(tencent, 'upload_note'),
        TencentVideoUploadRequest,
        TencentNoteUploadRequest,
        _ps(TENCENT_PUBLISH_STRATEGY_IMMEDIATE, TENCENT_PUBLISH_STRATEGY_SCHEDULED),
        video_extra_builder=_tencent_video_extra,
        note_extra_builder=_tencent_note_extra,
    ),
    'tiktok': PlatformHandler(
        'TikTok',
        _bind(tiktok, 'login'),
        _bind(tiktok, 'check'),
        _bind(tiktok, 'upload_video'),
        video_request_cls=TiktokVideoUploadRequest,
        video_has_description=False,
        video_has_publish_strategy=False,
    ),
    'baijiahao': PlatformHandler(
        'Baijiahao',
        _bind(baijiahao, 'login'),
        _bind(baijiahao, 'check'),
        _bind(baijiahao, 'upload_video'),
        video_request_cls=BaijiahaoVideoUploadRequest,
        video_has_description=False,
        video_has_publish_strategy=False,
    ),
    'youtube': PlatformHandler(
        'YouTube',
        _bind(youtube, 'login'),
        _bind(youtube, 'check'),
        _bind(youtube, 'upload_video'),
        video_request_cls=YoutubeVideoUploadRequest,
        video_has_description=True,
        video_has_thumbnail=True,
        video_has_publish_strategy=False,
        video_extra_builder=_youtube_video_extra,
    ),
}

async def dispatch(args: argparse.Namespace) -> int:
    """Dispatch command to appropriate platform handler."""
    handler = PLATFORM_HANDLERS.get(args.platform)
    if handler is None:
        valid = ', '.join(sorted(PLATFORM_HANDLERS.keys()))
        raise RuntimeError(f'Unsupported platform: {args.platform}. Valid platforms: {valid}')
    return await _dispatch_platform(args, handler)
