"""AI helpers (sentiment classification + reply suggestion) for crawler results."""
from __future__ import annotations

from crawler.ai.reply import generate_reply_suggestion
from crawler.ai.sentiment import analyze_sentiment

__all__ = ["analyze_sentiment", "generate_reply_suggestion"]
