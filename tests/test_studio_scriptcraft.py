"""Unit tests for studio_scriptcraft (no DB / Flask)."""
from __future__ import annotations

import json

from web_runner.studio_scriptcraft import (
    build_package,
    episode_markdown,
    get_pipeline,
    merge_pipeline,
    parse_ai_package,
    scaffold_package,
)


def test_scaffold_has_four_acts_and_assets():
    pkg = scaffold_package(title="逆袭", synopsis="被裁后反杀", style="都市爽文")
    assert len(pkg["episodes"]) == 4
    assert [e["act"] for e in pkg["episodes"]] == ["起", "承", "转", "合"]
    for ep in pkg["episodes"]:
        assert len(ep["scenes"]) >= 2
        assert len(ep["dialogues"]) >= 2
        assert ep["hook"]
        assert ep["cliffhanger"]
    assert len(pkg["characters"]) >= 2
    assert pkg["source"] == "scaffold"


def test_parse_json_package():
    raw = {
        "logline": "灰姑娘职场复仇",
        "genre_tags": ["都市", "复仇"],
        "characters": [
            {
                "code": "C01",
                "name": "林晚",
                "role": "女主",
                "archetype": "隐忍爆发",
                "goal": "证明自己",
                "flaw": "过度隐忍",
                "visual": "28岁短发白衬衫",
            }
        ],
        "locations": [{"code": "L01", "name": "写字楼", "visual": "冷白灯光"}],
        "episodes": [
            {
                "act": "起",
                "title": "被当众羞辱",
                "hook": "会议桌上的开除通知",
                "cliffhanger": "她笑着签了字",
                "beat": "开场冲突",
                "hook_type": "危机钩",
                "scenes": [
                    {
                        "id": "s1",
                        "location": "会议室",
                        "time": "日",
                        "shot": "特写",
                        "visual": "红头文件",
                        "action": "老板甩文件",
                        "duration_s": 5,
                        "characters": ["林晚"],
                    }
                ],
                "dialogues": [
                    {
                        "id": "d1",
                        "scene_id": "s1",
                        "speaker": "老板",
                        "line": "从今天起，你不用来了。",
                        "emotion": "嘲讽",
                    }
                ],
            },
            {
                "act": "承",
                "title": "暗中布局",
                "hook": "旧同事递来U盘",
                "cliffhanger": "U盘里是他的罪证",
                "beat": "升级",
                "hook_type": "信息钩",
                "scenes": [{"action": "夜色中复制文件", "location": "出租屋"}],
                "dialogues": [{"speaker": "林晚", "line": "这一次，我不会再退。"}],
            },
            {
                "act": "转",
                "title": "反转",
                "hook": "证人反水",
                "cliffhanger": "真正的幕后另有其人",
                "beat": "反转",
                "hook_type": "反转钩",
                "scenes": [{"action": "对质"}],
                "dialogues": [{"speaker": "证人", "line": "我什么都不知道。"}],
            },
            {
                "act": "合",
                "title": "收束",
                "hook": "新闻发布会",
                "cliffhanger": "更大的棋盘",
                "beat": "收",
                "hook_type": "悬念钩",
                "scenes": [{"action": "她站上舞台"}],
                "dialogues": [{"speaker": "林晚", "line": "故事才刚开始。"}],
            },
        ],
    }
    text = "```json\n" + json.dumps(raw, ensure_ascii=False) + "\n```"
    pkg = parse_ai_package(text, title="逆袭", synopsis="被裁", style="都市")
    assert pkg is not None
    assert pkg["source"] == "ai"
    assert pkg["logline"] == "灰姑娘职场复仇"
    assert len(pkg["episodes"]) == 4
    assert pkg["episodes"][0]["scenes"][0]["hook"] == "会议桌上的开除通知"
    assert pkg["characters"][0]["name"] == "林晚"
    assert "定妆" in pkg["characters"][0]["prompt"]


def test_build_package_fallback_on_garbage():
    pkg = build_package("not json at all 哈哈哈", title="T", synopsis="S", style="甜宠")
    assert pkg["source"] == "scaffold"
    assert len(pkg["episodes"]) == 4


def test_legacy_markdown_parse():
    text = """
起
开场被羞辱，女主隐忍。

承
她开始收集证据。

转
最大反转：盟友是敌人。

合
她赢了，但更大危机来了。
"""
    pkg = parse_ai_package(text, title="X", synopsis="Y", style="Z")
    assert pkg is not None
    assert pkg["source"] == "ai-legacy"
    assert [e["act"] for e in pkg["episodes"]] == ["起", "承", "转", "合"]


def test_episode_markdown_structured():
    md = episode_markdown(
        {
            "act": "起",
            "title": "开局",
            "scenes": [
                {
                    "id": "s1",
                    "location": "咖啡馆",
                    "time": "日",
                    "shot": "近景",
                    "visual": "一杯洒出的咖啡",
                    "action": "撞见前男友",
                    "duration_s": 6,
                    "hook": "开门见山",
                    "hook_type": "情绪钩",
                    "cliffhanger": "她转身离开",
                }
            ],
            "dialogues": [
                {"speaker": "女主", "line": "好久不见。", "emotion": "平静"}
            ],
        },
        project_title="测试剧",
    )
    assert "开场钩子" in md
    assert "咖啡馆" in md
    assert "女主" in md


def test_merge_pipeline_preserves_preset():
    rc = merge_pipeline(
        {"preset": "classic", "version": 1},
        source="ai",
        logline="line",
        genre_tags=["都市"],
        reset_approvals=True,
    )
    assert rc["preset"] == "classic"
    assert rc["pipeline"]["script_approved"] is False
    assert rc["pipeline"]["cast_approved"] is False
    assert rc["pipeline"]["logline"] == "line"

    rc2 = merge_pipeline(
        rc,
        source="ai",
        logline="line",
        genre_tags=["都市"],
        script_approved=True,
    )
    assert rc2["pipeline"]["script_approved"] is True

    rc3 = merge_pipeline(
        rc2,
        source="ai",
        logline="line",
        genre_tags=["都市"],
        cast_approved=True,
    )
    assert rc3["pipeline"]["cast_approved"] is True
    assert rc3["pipeline"]["script_approved"] is True

    pipe = get_pipeline(rc3)
    assert pipe["script_approved"] is True
    assert pipe["cast_approved"] is True
