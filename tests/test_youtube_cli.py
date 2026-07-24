# -*- coding: utf-8 -*-
"""YouTube CLI parser + dispatch smoke tests."""
from __future__ import annotations

import asyncio
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import AsyncMock, patch

import sau_cli


class YoutubeCliTests(unittest.TestCase):
    def test_parser_has_youtube_upload_visibility(self):
        parser = sau_cli.build_parser()
        args = parser.parse_args(
            [
                "youtube",
                "upload-video",
                "--account",
                "me",
                "--file",
                str(Path(__file__).resolve()),  # any existing file
                "--title",
                "Hello",
                "--visibility",
                "unlisted",
            ]
        )
        self.assertEqual(args.platform, "youtube")
        self.assertEqual(args.action, "upload-video")
        self.assertEqual(args.visibility, "unlisted")

    def test_dispatch_youtube_check_prints_valid(self):
        args = Namespace(platform="youtube", action="check", account="me")
        with patch("cli.platforms.youtube.check", new=AsyncMock(return_value=True)):
            code = asyncio.run(sau_cli.dispatch(args))
        self.assertEqual(code, 0)
