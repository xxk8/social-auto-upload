"""Short-drama script craft for Studio generate pipeline.

Inspired by open short-drama craft packs (hooks, rhythm, character bible)
and production pipelines (script → cast → shots). Pure helpers — no Flask
or DB imports — so unit tests can exercise parsers without the app.

Output contract (stored in ``studio_episodes`` / ``studio_assets``):

* scene dict:
    id, location, time, visual, action, duration_s, shot, characters[]
* dialogue dict:
    id, scene_id, speaker, line, emotion
* character asset:
    kind='character', code, name, prompt (visual + role bible)
* pipeline (in project.render_config.pipeline):
    script_approved, cast_approved, source, logline, genre_tags
"""
from __future__ import annotations

import json
import re
from typing import Any

ACTS = ("起", "承", "转", "合")

# Rhythm hints (short-drama craft, compressed for 4-act micro series).
_ACT_BEAT: dict[str, str] = {
    "起": "开篇黄金 3 秒钩子 + 建置人物/冲突；节奏偏快，信息密度高",
    "承": "冲突升级、关系拉扯；爽点或虐点递进，埋下线索",
    "转": "最大反转或危机；情绪风暴，观众不能划走",
    "合": "短期收束 + 新悬念（可连载）；避免空洞说教",
}

_HOOK_TYPES = "悬念钩 / 反转钩 / 情绪钩 / 信息钩 / 危机钩"


def system_prompt() -> str:
    return (
        "你是资深微短剧编剧与分镜统筹，服务竖屏短视频（抖音/红果/快手）。\n"
        "必须只输出一个 JSON 对象（不要 markdown 围栏，不要解释），结构如下：\n"
        "{\n"
        '  "logline": "一句话故事线",\n'
        '  "genre_tags": ["题材1","题材2"],\n'
        '  "characters": [\n'
        "    {\n"
        '      "code": "C01", "name": "姓名", "role": "女主|男主|反派|配角",\n'
        '      "archetype": "人设标签", "goal": "本剧目标", "flaw": "缺陷",\n'
        '      "visual": "定妆：年龄/五官/发型/服装/标志物，便于 AI 画图锁脸"\n'
        "    }\n"
        "  ],\n"
        '  "locations": [\n'
        '    {"code": "L01", "name": "场景名", "visual": "环境/光影/色调描述"}\n'
        "  ],\n"
        '  "episodes": [\n'
        "    {\n"
        '      "act": "起|承|转|合",\n'
        '      "title": "集标题",\n'
        '      "hook": "开场钩子（3 秒内抓住观众）",\n'
        '      "cliffhanger": "集末钩子（必须想看下一集）",\n'
        '      "beat": "本集核心事件一句话",\n'
        '      "hook_type": "悬念钩|反转钩|情绪钩|信息钩|危机钩",\n'
        '      "scenes": [\n'
        "        {\n"
        '          "id": "s1", "location": "场景名", "time": "日|夜|黄昏",\n'
        '          "shot": "特写|近景|中景|全景|航拍",\n'
        '          "visual": "画面可见物", "action": "发生的事",\n'
        '          "duration_s": 6,\n'
        '          "characters": ["角色名"]\n'
        "        }\n"
        "      ],\n"
        '      "dialogues": [\n'
        '        {"id": "d1", "scene_id": "s1", "speaker": "角色名",\n'
        '         "line": "口语化台词", "emotion": "情绪"}\n'
        "      ]\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "硬性约束：\n"
        "1. episodes 必须恰好 4 条，act 依次为 起、承、转、合。\n"
        "2. 每集 2–4 个 scenes，每集至少 2 条 dialogues；台词短、口语、有潜台词。\n"
        "3. characters 2–5 人；visual 必须足够具体以便跨镜头一致。\n"
        "4. 每集 hook + cliffhanger 必填；hook_type 从给定五类里选。\n"
        "5. 合规：不写涉政/色情/过度血腥；正能量价值观优先。\n"
        "6. 全中文（专有名词可保留）。\n"
    )


def user_prompt(*, title: str, synopsis: str, style: str) -> str:
    beat_lines = "\n".join(f"- {act}：{_ACT_BEAT[act]}" for act in ACTS)
    return (
        f"项目标题：{title}\n"
        f"简介：{synopsis}\n"
        f"风格/题材提示：{style}\n"
        f"钩子类型参考：{_HOOK_TYPES}\n"
        f"四幕节奏：\n{beat_lines}\n"
        "请按 system 的 JSON schema 生成可直接拍的竖屏微短剧四幕大纲。"
        "把「起」写成可单独成片的一集（60–90 秒量级的分镜密度）。"
    )


def _strip_fences(text: str) -> str:
    s = (text or "").strip()
    if not s:
        return ""
    # ```json ... ``` or ``` ... ```
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s, re.I)
    if m:
        return m.group(1).strip()
    # leading junk before first {
    i = s.find("{")
    j = s.rfind("}")
    if i >= 0 and j > i:
        return s[i : j + 1]
    return s


def _as_list(val: Any) -> list:
    if val is None:
        return []
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return []
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, list) else [s]
        except Exception:
            return [s]
    return [val]


def _clip(s: Any, n: int) -> str:
    t = str(s or "").strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def normalize_scene(raw: Any, idx: int) -> dict[str, Any]:
    if isinstance(raw, str):
        return {
            "id": f"s{idx}",
            "location": "",
            "time": "",
            "shot": "中景",
            "visual": _clip(raw, 500),
            "action": _clip(raw, 800),
            "duration_s": 8,
            "characters": [],
        }
    if not isinstance(raw, dict):
        return {
            "id": f"s{idx}",
            "location": "",
            "time": "",
            "shot": "中景",
            "visual": "",
            "action": _clip(raw, 400),
            "duration_s": 8,
            "characters": [],
        }
    chars = raw.get("characters") or raw.get("cast") or []
    if isinstance(chars, str):
        chars = [c.strip() for c in re.split(r"[,，、/]", chars) if c.strip()]
    elif not isinstance(chars, list):
        chars = []
    else:
        chars = [str(c).strip() for c in chars if str(c).strip()]
    dur = raw.get("duration_s", raw.get("duration", 8))
    try:
        dur_i = int(dur)
    except Exception:
        dur_i = 8
    dur_i = max(2, min(30, dur_i))
    sid = str(raw.get("id") or f"s{idx}").strip() or f"s{idx}"
    return {
        "id": sid[:32],
        "location": _clip(raw.get("location") or raw.get("place") or "", 80),
        "time": _clip(raw.get("time") or "", 20),
        "shot": _clip(raw.get("shot") or raw.get("framing") or "中景", 20),
        "visual": _clip(raw.get("visual") or raw.get("description") or "", 500),
        "action": _clip(
            raw.get("action") or raw.get("content") or raw.get("summary") or "", 800
        ),
        "duration_s": dur_i,
        "characters": chars[:8],
    }


def normalize_dialogue(raw: Any, idx: int) -> dict[str, Any] | None:
    if isinstance(raw, str):
        line = raw.strip()
        if not line:
            return None
        # "角色：台词" / "角色: 台词"
        m = re.match(r"^(.{1,20})[:：]\s*(.+)$", line)
        if m:
            return {
                "id": f"d{idx}",
                "scene_id": "",
                "speaker": m.group(1).strip()[:40],
                "line": _clip(m.group(2), 300),
                "emotion": "",
            }
        return {
            "id": f"d{idx}",
            "scene_id": "",
            "speaker": "旁白",
            "line": _clip(line, 300),
            "emotion": "",
        }
    if not isinstance(raw, dict):
        return None
    line = _clip(raw.get("line") or raw.get("text") or raw.get("content") or "", 300)
    if not line:
        return None
    return {
        "id": str(raw.get("id") or f"d{idx}")[:32],
        "scene_id": str(raw.get("scene_id") or raw.get("scene") or "")[:32],
        "speaker": _clip(raw.get("speaker") or raw.get("name") or "旁白", 40),
        "line": line,
        "emotion": _clip(raw.get("emotion") or raw.get("mood") or "", 40),
    }


def normalize_character(raw: Any, idx: int) -> dict[str, Any] | None:
    if isinstance(raw, str):
        name = raw.strip()
        if not name:
            return None
        return {
            "code": f"C{idx:02d}",
            "name": name[:40],
            "role": "配角",
            "archetype": "",
            "goal": "",
            "flaw": "",
            "visual": name,
        }
    if not isinstance(raw, dict):
        return None
    name = _clip(raw.get("name") or "", 40)
    if not name:
        return None
    code = str(raw.get("code") or f"C{idx:02d}").strip()[:16] or f"C{idx:02d}"
    visual = _clip(
        raw.get("visual")
        or raw.get("appearance")
        or raw.get("prompt")
        or raw.get("description")
        or "",
        600,
    )
    role = _clip(raw.get("role") or "配角", 20)
    archetype = _clip(raw.get("archetype") or raw.get("tag") or "", 40)
    goal = _clip(raw.get("goal") or "", 120)
    flaw = _clip(raw.get("flaw") or "", 120)
    # Asset prompt: compact character bible for image gen / consistency.
    prompt_parts = [
        f"角色:{name}",
        f"身份:{role}" if role else "",
        f"人设:{archetype}" if archetype else "",
        f"目标:{goal}" if goal else "",
        f"缺陷:{flaw}" if flaw else "",
        f"定妆:{visual}" if visual else "",
    ]
    prompt = "；".join(p for p in prompt_parts if p)
    return {
        "code": code,
        "name": name,
        "role": role,
        "archetype": archetype,
        "goal": goal,
        "flaw": flaw,
        "visual": visual,
        "prompt": _clip(prompt, 800),
    }


def normalize_location(raw: Any, idx: int) -> dict[str, Any] | None:
    if isinstance(raw, str):
        name = raw.strip()
        if not name:
            return None
        return {"code": f"L{idx:02d}", "name": name[:40], "visual": name, "prompt": name}
    if not isinstance(raw, dict):
        return None
    name = _clip(raw.get("name") or raw.get("location") or "", 40)
    if not name:
        return None
    visual = _clip(raw.get("visual") or raw.get("description") or raw.get("prompt") or "", 500)
    code = str(raw.get("code") or f"L{idx:02d}").strip()[:16] or f"L{idx:02d}"
    prompt = f"场景:{name}；环境:{visual}" if visual else f"场景:{name}"
    return {
        "code": code,
        "name": name,
        "visual": visual,
        "prompt": _clip(prompt, 600),
    }


def _default_scenes(act: str, title: str, synopsis: str, style: str) -> list[dict]:
    beat = _ACT_BEAT.get(act, "")
    return [
        {
            "id": "s1",
            "location": "主场景",
            "time": "日",
            "shot": "中景",
            "visual": f"风格：{style}",
            "action": f"【{act}】{beat}。主题：{synopsis}",
            "duration_s": 8,
            "characters": [],
        },
        {
            "id": "s2",
            "location": "主场景",
            "time": "日",
            "shot": "近景",
            "visual": "情绪推进镜头",
            "action": f"围绕「{title}」推进「{act}」情节点，制造可感知的变化。",
            "duration_s": 8,
            "characters": [],
        },
    ]


def _default_dialogues(act: str, title: str) -> list[dict]:
    return [
        {
            "id": "d1",
            "scene_id": "s1",
            "speaker": "旁白",
            "line": f"这一集的关键词是「{act}」——{title}。",
            "emotion": "克制",
        },
        {
            "id": "d2",
            "scene_id": "s2",
            "speaker": "主角",
            "line": "这一步，退无可退。",
            "emotion": "坚定",
        },
    ]


def scaffold_package(
    *,
    title: str,
    synopsis: str,
    style: str,
) -> dict[str, Any]:
    """Local template when LLM is unavailable — still structured."""
    chars = [
        {
            "code": "C01",
            "name": "主角",
            "role": "主角",
            "archetype": "逆境反击",
            "goal": "拿回属于自己的东西",
            "flaw": "太容易相信人",
            "visual": "25-30 岁，清爽造型，标志性配饰，竖屏特写友好",
            "prompt": (
                f"角色:主角；身份:主角；人设:逆境反击；"
                f"目标:拿回属于自己的东西；缺陷:太容易相信人；"
                f"定妆:25-30 岁，清爽造型，标志性配饰，竖屏特写友好；题材:{style}"
            ),
        },
        {
            "code": "C02",
            "name": "对手",
            "role": "反派",
            "archetype": "笑里藏刀",
            "goal": "巩固自己的优势",
            "flaw": "傲慢",
            "visual": "同龄精英感，冷色服装，气场强",
            "prompt": (
                "角色:对手；身份:反派；人设:笑里藏刀；目标:巩固自己的优势；"
                "缺陷:傲慢；定妆:同龄精英感，冷色服装，气场强"
            ),
        },
    ]
    locations = [
        {
            "code": "L01",
            "name": "主场景",
            "visual": f"与「{synopsis[:40]}」相关的写实空间，{style}",
            "prompt": f"场景:主场景；环境:与剧情相关的写实空间；风格:{style}",
        }
    ]
    episodes = []
    hooks = {
        "起": ("危机钩", f"开场即冲突：{synopsis[:60]}", "一个不该出现的人/消息出现了"),
        "承": ("情绪钩", "关系与利益开始撕裂", "主角发现被利用的证据"),
        "转": ("反转钩", "最大反转落地", "盟友变成敌人，或真相颠覆前设"),
        "合": ("信息钩", "短期收束，抛出更大局", "一张照片/合同揭开下一章"),
    }
    for act in ACTS:
        ht, hook, cliff = hooks[act]
        episodes.append(
            {
                "act": act,
                "title": f"{title} · {act}",
                "hook": hook,
                "cliffhanger": cliff,
                "beat": _ACT_BEAT[act],
                "hook_type": ht,
                "scenes": _default_scenes(act, title, synopsis, style),
                "dialogues": _default_dialogues(act, title),
            }
        )
    return {
        "logline": f"关于「{synopsis[:80]}」的竖屏微短剧",
        "genre_tags": [style] if style and style != "默认" else ["都市"],
        "characters": chars,
        "locations": locations,
        "episodes": episodes,
        "source": "scaffold",
    }


def parse_ai_package(
    text: str,
    *,
    title: str,
    synopsis: str,
    style: str,
) -> dict[str, Any] | None:
    """Parse LLM output into a normalized package, or None if unusable."""
    raw = _strip_fences(text)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        # Fallback: legacy 起承转合 markdown → wrap as plain scenes
        return _parse_legacy_acts(text, title=title, synopsis=synopsis, style=style)
    if not isinstance(data, dict):
        return None

    characters: list[dict] = []
    for i, c in enumerate(_as_list(data.get("characters")), start=1):
        nc = normalize_character(c, i)
        if nc:
            characters.append(nc)

    locations: list[dict] = []
    for i, loc in enumerate(_as_list(data.get("locations") or data.get("scenes_locations")), start=1):
        nl = normalize_location(loc, i)
        if nl:
            locations.append(nl)

    episodes_in = _as_list(data.get("episodes") or data.get("acts"))
    by_act: dict[str, dict] = {}
    for ep in episodes_in:
        if not isinstance(ep, dict):
            continue
        act = str(ep.get("act") or "").strip()
        if act not in ACTS:
            continue
        scenes = [
            normalize_scene(s, i)
            for i, s in enumerate(_as_list(ep.get("scenes")), start=1)
        ]
        dialogues: list[dict] = []
        for i, d in enumerate(_as_list(ep.get("dialogues") or ep.get("lines")), start=1):
            nd = normalize_dialogue(d, i)
            if nd:
                dialogues.append(nd)
        if not scenes:
            scenes = _default_scenes(act, title, synopsis, style)
        if not dialogues:
            dialogues = _default_dialogues(act, str(ep.get("title") or title))
        # Inject meta beat into first scene if provided
        meta_bits = []
        hook = _clip(ep.get("hook") or "", 200)
        cliff = _clip(ep.get("cliffhanger") or ep.get("hook_end") or "", 200)
        beat = _clip(ep.get("beat") or "", 200)
        hook_type = _clip(ep.get("hook_type") or "", 20)
        if hook:
            meta_bits.append(f"【开场钩子·{hook_type or '悬念'}】{hook}")
        if beat:
            meta_bits.append(f"【本集节拍】{beat}")
        if cliff:
            meta_bits.append(f"【集末钩子】{cliff}")
        if meta_bits and scenes:
            prefix = "\n".join(meta_bits)
            act0 = scenes[0].get("action") or ""
            scenes[0]["action"] = _clip(f"{prefix}\n{act0}".strip(), 1200)
            scenes[0]["hook"] = hook
            scenes[0]["cliffhanger"] = cliff
            scenes[0]["hook_type"] = hook_type
            scenes[0]["beat"] = beat

        by_act[act] = {
            "act": act,
            "title": _clip(ep.get("title") or f"{title} · {act}", 80),
            "hook": hook,
            "cliffhanger": cliff,
            "beat": beat,
            "hook_type": hook_type,
            "scenes": scenes[:8],
            "dialogues": dialogues[:24],
        }

    if len(by_act) < 2:
        # Too sparse — try legacy markdown parse
        legacy = _parse_legacy_acts(text, title=title, synopsis=synopsis, style=style)
        if legacy:
            return legacy
        return None

    episodes = []
    for act in ACTS:
        if act in by_act:
            episodes.append(by_act[act])
        else:
            episodes.append(
                {
                    "act": act,
                    "title": f"{title} · {act}",
                    "hook": "",
                    "cliffhanger": "",
                    "beat": _ACT_BEAT[act],
                    "hook_type": "",
                    "scenes": _default_scenes(act, title, synopsis, style),
                    "dialogues": _default_dialogues(act, title),
                }
            )

    if not characters:
        characters = scaffold_package(title=title, synopsis=synopsis, style=style)[
            "characters"
        ]

    logline = _clip(data.get("logline") or data.get("one_liner") or synopsis, 200)
    tags = data.get("genre_tags") or data.get("tags") or []
    if isinstance(tags, str):
        tags = [t.strip() for t in re.split(r"[,，、/]", tags) if t.strip()]
    elif not isinstance(tags, list):
        tags = []
    tags = [_clip(t, 20) for t in tags if str(t).strip()][:6]

    return {
        "logline": logline,
        "genre_tags": tags,
        "characters": characters[:8],
        "locations": locations[:8],
        "episodes": episodes,
        "source": "ai",
    }


def _parse_legacy_acts(
    text: str,
    *,
    title: str,
    synopsis: str,
    style: str,
) -> dict[str, Any] | None:
    """Best-effort parse of plain 起承转合 markdown into structured package."""
    acts_order = list(ACTS)
    found: dict[str, str] = {}
    parts = re.split(
        r"(?m)^(?:#+\s*)?(?:【)?([起承转合])(?:】)?(?:\s*[·.\-—:].*)?$",
        text or "",
    )
    i = 1
    while i + 1 < len(parts):
        act = parts[i].strip()
        body = (parts[i + 1] or "").strip()
        if act in acts_order and body:
            found[act] = body
        i += 2
    if not found:
        return None
    episodes = []
    for act in acts_order:
        content = found.get(act) or _ACT_BEAT[act]
        content = re.sub(r"^(?:#+\s*)?.{0,40}\n+", "", content, count=1).strip() or _ACT_BEAT[
            act
        ]
        content = content[:4000]
        scenes = [
            {
                "id": "s1",
                "location": "",
                "time": "",
                "shot": "中景",
                "visual": f"风格：{style}",
                "action": content,
                "duration_s": 12,
                "characters": [],
            }
        ]
        # Pull simple 「角色：台词」 lines into dialogues
        dialogues: list[dict] = []
        di = 1
        for line in content.splitlines():
            stripped = line.strip()
            if "：" not in stripped and ":" not in stripped:
                continue
            nd = normalize_dialogue(stripped, di)
            if nd and nd.get("speaker") and nd["speaker"] != "旁白":
                dialogues.append(nd)
                di += 1
        if not dialogues:
            dialogues = _default_dialogues(act, title)
        episodes.append(
            {
                "act": act,
                "title": f"{title} · {act}",
                "hook": content[:80],
                "cliffhanger": "",
                "beat": content[:120],
                "hook_type": "悬念钩",
                "scenes": scenes,
                "dialogues": dialogues[:12],
            }
        )
    return {
        "logline": synopsis[:200],
        "genre_tags": [style] if style else [],
        "characters": scaffold_package(title=title, synopsis=synopsis, style=style)[
            "characters"
        ],
        "locations": [],
        "episodes": episodes,
        "source": "ai-legacy",
    }


def build_package(
    ai_text: str | None,
    *,
    title: str,
    synopsis: str,
    style: str,
) -> dict[str, Any]:
    """Main entry: AI text → package, else scaffold."""
    if ai_text:
        pkg = parse_ai_package(ai_text, title=title, synopsis=synopsis, style=style)
        if pkg:
            return pkg
    return scaffold_package(title=title, synopsis=synopsis, style=style)


def episode_markdown(ep: dict[str, Any], *, project_title: str = "") -> str:
    """Human-readable markdown for one episode (export / clipboard)."""
    lines: list[str] = []
    act = ep.get("act") or ""
    title = ep.get("title") or ""
    if project_title:
        lines.append(f"# {project_title} — {act} · {title}")
    else:
        lines.append(f"# {act} · {title}")
    lines.append("")
    scenes = _as_list(ep.get("scenes") if "scenes" in ep else ep.get("scenes_json"))
    dialogues = _as_list(
        ep.get("dialogues") if "dialogues" in ep else ep.get("dialogues_json")
    )
    # Meta from first scene if present
    if scenes and isinstance(scenes[0], dict):
        s0 = scenes[0]
        if s0.get("hook"):
            lines.append(f"> **开场钩子**（{s0.get('hook_type') or '—'}）：{s0['hook']}")
        if s0.get("beat"):
            lines.append(f"> **本集节拍**：{s0['beat']}")
        if s0.get("cliffhanger"):
            lines.append(f"> **集末钩子**：{s0['cliffhanger']}")
        if s0.get("hook") or s0.get("beat") or s0.get("cliffhanger"):
            lines.append("")

    lines.append("## 分镜")
    lines.append("")
    for i, sc in enumerate(scenes, start=1):
        if isinstance(sc, str):
            lines.append(f"### 镜头 {i}")
            lines.append(sc)
            lines.append("")
            continue
        if not isinstance(sc, dict):
            continue
        loc = sc.get("location") or "场景"
        time_ = sc.get("time") or ""
        shot = sc.get("shot") or ""
        header = f"### 镜头 {i} · {loc}"
        if time_ or shot:
            header += f"（{' / '.join(x for x in (time_, shot) if x)}）"
        lines.append(header)
        if sc.get("visual"):
            lines.append(f"- **画面**：{sc['visual']}")
        if sc.get("action"):
            lines.append(f"- **动作**：{sc['action']}")
        if sc.get("duration_s"):
            lines.append(f"- **时长**：{sc['duration_s']}s")
        if sc.get("characters"):
            lines.append(f"- **出镜**：{', '.join(sc['characters'])}")
        lines.append("")

    if dialogues:
        lines.append("## 对白")
        lines.append("")
        for d in dialogues:
            if isinstance(d, str):
                lines.append(f"- {d}")
                continue
            if not isinstance(d, dict):
                continue
            sp = d.get("speaker") or "旁白"
            emo = f"（{d['emotion']}）" if d.get("emotion") else ""
            lines.append(f"- **{sp}**{emo}：{d.get('line') or ''}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def merge_pipeline(
    existing_render_config: Any,
    *,
    source: str,
    logline: str,
    genre_tags: list[str],
    script_approved: bool | None = None,
    cast_approved: bool | None = None,
    reset_approvals: bool = False,
) -> dict[str, Any]:
    """Merge pipeline fields into render_config without dropping preset."""
    rc: dict[str, Any]
    if isinstance(existing_render_config, dict):
        rc = dict(existing_render_config)
    elif isinstance(existing_render_config, str) and existing_render_config.strip():
        try:
            parsed = json.loads(existing_render_config)
            rc = dict(parsed) if isinstance(parsed, dict) else {}
        except Exception:
            rc = {}
    else:
        rc = {}

    pipe = rc.get("pipeline")
    if not isinstance(pipe, dict):
        pipe = {}
    else:
        pipe = dict(pipe)

    if reset_approvals:
        pipe["script_approved"] = False
        pipe["cast_approved"] = False
    if script_approved is not None:
        pipe["script_approved"] = bool(script_approved)
        if not script_approved:
            pipe["cast_approved"] = False
    if cast_approved is not None:
        # Cast approval implies script is locked.
        if cast_approved:
            pipe["script_approved"] = True
        pipe["cast_approved"] = bool(cast_approved)

    pipe["source"] = source or pipe.get("source") or "scaffold"
    pipe["logline"] = logline or pipe.get("logline") or ""
    pipe["genre_tags"] = genre_tags if genre_tags is not None else pipe.get("genre_tags") or []

    if "preset" not in rc:
        rc["preset"] = "classic"
    if "version" not in rc:
        rc["version"] = 1
    rc["pipeline"] = pipe
    return rc


def get_pipeline(render_config: Any) -> dict[str, Any]:
    if isinstance(render_config, str) and render_config.strip():
        try:
            render_config = json.loads(render_config)
        except Exception:
            render_config = None
    if not isinstance(render_config, dict):
        return {
            "script_approved": False,
            "cast_approved": False,
            "source": "",
            "logline": "",
            "genre_tags": [],
        }
    pipe = render_config.get("pipeline")
    if not isinstance(pipe, dict):
        pipe = {}
    return {
        "script_approved": bool(pipe.get("script_approved")),
        "cast_approved": bool(pipe.get("cast_approved")),
        "source": str(pipe.get("source") or ""),
        "logline": str(pipe.get("logline") or ""),
        "genre_tags": list(pipe.get("genre_tags") or [])
        if isinstance(pipe.get("genre_tags"), list)
        else [],
    }
