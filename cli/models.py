"""Data models for CLI upload requests."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from uploader.douyin_uploader.main import DOUYIN_PUBLISH_STRATEGY_IMMEDIATE
from uploader.ks_uploader.main import KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE
from uploader.tencent_uploader.main import TENCENT_PUBLISH_STRATEGY_IMMEDIATE
from uploader.xiaohongshu_uploader.main import XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class BaseUploadRequest:
    account_name: str
    publish_date: datetime | int
    debug: bool = True
    headless: bool = True


@dataclass(slots=True, kw_only=True)
class DouyinVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    description: str
    tags: list[str]
    thumbnail_file: Path | None = None
    thumbnail_landscape_file: Path | None = None
    thumbnail_portrait_file: Path | None = None
    product_link: str = ''
    product_title: str = ''
    publish_strategy: str = DOUYIN_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class DouyinNoteUploadRequest(BaseUploadRequest):
    image_files: list[Path]
    title: str
    note: str
    tags: list[str]
    publish_strategy: str = DOUYIN_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class KuaishouVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    description: str
    tags: list[str]
    thumbnail_file: Path | None = None
    publish_strategy: str = KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class KuaishouNoteUploadRequest(BaseUploadRequest):
    image_files: list[Path]
    title: str
    note: str
    tags: list[str]
    publish_strategy: str = KUAISHOU_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class XiaohongshuVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    description: str
    tags: list[str]
    thumbnail_file: Path | None = None
    publish_strategy: str = XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class XiaohongshuNoteUploadRequest(BaseUploadRequest):
    image_files: list[Path]
    title: str
    note: str
    tags: list[str]
    publish_strategy: str = XIAOHONGSHU_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True)
class BilibiliVideoUploadRequest:
    account_name: str
    video_file: Path
    title: str
    description: str
    tid: int
    tags: list[str]
    publish_date: datetime | int


@dataclass(slots=True, kw_only=True)
class BilibiliNoteUploadRequest(BaseUploadRequest):
    image_files: list[Path]
    title: str
    note: str
    tags: list[str]
    publish_strategy: str = 'immediate'


@dataclass(slots=True, kw_only=True)
class TencentVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    description: str
    tags: list[str]
    thumbnail_file: Path | None = None
    thumbnail_landscape_file: Path | None = None
    thumbnail_portrait_file: Path | None = None
    short_title: str | None = None
    category: str | None = None
    is_draft: bool = False
    publish_strategy: str = TENCENT_PUBLISH_STRATEGY_IMMEDIATE


@dataclass(slots=True, kw_only=True)
class TencentNoteUploadRequest(BaseUploadRequest):
    image_files: list[Path]
    title: str
    note: str
    tags: list[str]
    publish_strategy: str = TENCENT_PUBLISH_STRATEGY_IMMEDIATE
    is_draft: bool = False


@dataclass(slots=True, kw_only=True)
class TiktokVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    tags: list[str]


@dataclass(slots=True, kw_only=True)
class BaijiahaoVideoUploadRequest(BaseUploadRequest):
    video_file: Path
    title: str
    tags: list[str]
