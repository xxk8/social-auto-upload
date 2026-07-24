"""Hot list proxy route — fetches trending data from platform APIs directly."""
from __future__ import annotations

import json as _json
import re as _re
import time
from urllib.parse import quote

from flask import Blueprint, jsonify, request
import requests as http_requests

bp = Blueprint("hotlist", __name__)

_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

_cache: dict[str, tuple[float, list]] = {}
CACHE_TTL = 300


def _get(url: str, timeout: int = 10, headers: dict | None = None, **kw) -> http_requests.Response:
    h = {"User-Agent": _UA}
    if headers:
        h.update(headers)
    resp = http_requests.get(url, headers=h, timeout=timeout, **kw)
    resp.raise_for_status()
    return resp


def _fetch_douyin() -> list[dict]:
    # Step 1: get temporary cookie
    cookie_resp = _get("https://www.douyin.com/passport/general/login_guiding_strategy/?aid=6383", timeout=8)
    pattern = r"passport_csrf_token=(.*?);"
    match = _re.search(pattern, str(cookie_resp.headers.get("set-cookie", "")))
    cookie_val = match.group(1) if match else ""

    # Step 2: call hot search API with cookie
    resp = _get(
        "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1",
        timeout=8,
        headers={"Cookie": f"passport_csrf_token={cookie_val}", "Referer": "https://www.douyin.com/"},
    )
    items = resp.json().get("data", {}).get("word_list", [])
    return [
        {"title": i.get("word", ""), "hot": i.get("hot_value", 0), "url": f"https://www.douyin.com/hot/{i.get('sentence_id', '')}"}
        for i in items[:15]
    ]


def _fetch_kuaishou() -> list[dict]:
    # Fetch HTML page and parse __APOLLO_STATE__ embedded JSON
    resp = _get("https://www.kuaishou.com/?isHome=1", timeout=10)
    html = resp.text
    prefix = "window.__APOLLO_STATE__="
    start = html.find(prefix)
    if start == -1:
        raise RuntimeError("快手页面结构变更，未找到 __APOLLO_STATE__")
    script_slice = html[start + len(prefix):]
    # Find end sentinel
    sentinel_a = script_slice.find(";(function(")
    sentinel_b = script_slice.find("</script>")
    if sentinel_a != -1 and sentinel_b != -1:
        cut = min(sentinel_a, sentinel_b)
    elif sentinel_a != -1:
        cut = sentinel_a
    else:
        cut = sentinel_b
    if cut == -1:
        raise RuntimeError("快手数据解析失败：未找到结束标记")
    raw = script_slice[:cut].strip().rstrip(";")
    last_brace = raw.rfind("}")
    if last_brace != -1:
        raw = raw[:last_brace + 1]
    data = _json.loads(raw).get("defaultClient", {})

    all_items = (
        data.get('$ROOT_QUERY.visionHotRank({"page":"home"})', {}).get("items", [])
        or data.get('$ROOT_QUERY.visionHotRank({"page":"home","platform":"web"})', {}).get("items", [])
    )
    results = []
    for item_ref in all_items:
        hot_item = data.get(item_ref.get("id", ""), {})
        if not hot_item:
            continue
        photo_id = (hot_item.get("photoIds", {}).get("json", [""])[0] if hot_item.get("photoIds") else "")
        results.append({
            "title": hot_item.get("name", ""),
            "hot": hot_item.get("hotValue", ""),
            "url": f"https://www.kuaishou.com/short-video/{photo_id}" if photo_id else "",
        })
    return results[:15]


def _fetch_weibo() -> list[dict]:
    resp = _get("https://weibo.com/ajax/side/hotSearch", timeout=8, headers={"Referer": "https://weibo.com/"})
    items = resp.json().get("data", {}).get("realtime", [])
    return [
        {"title": i.get("note", i.get("word", "")), "hot": i.get("num", 0),
         "url": f"https://s.weibo.com/weibo?q={quote(i.get('note', i.get('word', '')))}"}
        for i in items[:15]
    ]


def _fetch_zhihu() -> list[dict]:
    # Use api.zhihu.com (not www.zhihu.com)
    resp = _get("https://api.zhihu.com/topstory/hot-lists/total?limit=15", timeout=8)
    items = resp.json().get("data", [])
    results = []
    for i in items[:15]:
        target = i.get("target", {})
        qid = target.get("url", "").split("/")[-1]
        detail = i.get("detail_text", "0 热度")
        hot_str = detail.split(" ")[0] if detail else "0"
        try:
            hot_val = float(hot_str) * 10000
        except ValueError:
            hot_val = 0
        results.append({
            "title": target.get("title", ""),
            "hot": int(hot_val),
            "url": f"https://www.zhihu.com/question/{qid}" if qid else "",
        })
    return results[:15]


def _fetch_bilibili() -> list[dict]:
    resp = _get("https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all", timeout=8)
    items = resp.json().get("data", {}).get("list", [])
    return [
        {"title": i.get("title", ""), "hot": i.get("stat", {}).get("view", 0), "url": f"https://www.bilibili.com/video/{i.get('bvid', '')}"}
        for i in items[:15]
    ]


def _fetch_baidu() -> list[dict]:
    resp = _get("https://top.baidu.com/board?tab=realtime", timeout=8)
    match = _re.search(r"<!--s-data:(.*?)-->", resp.text, _re.DOTALL)
    if not match:
        return []
    data = _json.loads(match.group(1))
    cards = data.get("data", {}).get("cards", [])
    items = cards[0].get("content", []) if cards else []
    return [
        {"title": i.get("word", ""), "hot": i.get("hotScore", 0), "url": i.get("url", "")}
        for i in items[:15]
    ]


def _fetch_toutiao() -> list[dict]:
    resp = _get("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", timeout=8)
    items = resp.json().get("data", [])
    return [
        {"title": i.get("Title", ""), "hot": int(i.get("HotValue", 0)), "url": i.get("Url", "")}
        for i in items[:15]
    ]


def _fetch_douban_movie() -> list[dict]:
    resp = _get("https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=15&page_start=0", timeout=8)
    items = resp.json().get("subjects", [])
    return [
        {"title": i.get("title", ""), "hot": i.get("rate", ""), "url": i.get("url", "")}
        for i in items[:15]
    ]


def _fetch_36kr() -> list[dict]:
    resp = http_requests.post(
        "https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot",
        json={"partner_id": "wap", "param": {"siteId": 1, "platformId": 2}},
        headers={"User-Agent": _UA, "Content-Type": "application/json"},
        timeout=8,
    )
    resp.raise_for_status()
    data = resp.json().get("data", {}).get("hotRankList", [])
    return [
        {"title": i.get("templateMaterial", {}).get("widgetTitle", ""), "hot": i.get("templateMaterial", {}).get("statRead", 0),
         "url": f"https://www.36kr.com/p/{i.get('itemId', '')}"}
        for i in (data or [])[:15]
    ]


def _fetch_sspai() -> list[dict]:
    resp = _get("https://sspai.com/api/v1/articles?offset=0&limit=15&type=recommend_to_home&sort=comment_count", timeout=8)
    items = resp.json().get("data", [])
    return [
        {"title": i.get("title", ""), "hot": i.get("like_count", 0), "url": f"https://sspai.com/post/{i.get('id', '')}"}
        for i in items[:15]
    ]


def _fetch_ithome() -> list[dict]:
    resp = _get("https://m.ithome.com/rankm/", timeout=10)
    html = resp.text
    import re as _re
    items = []
    # Find all rank items: <div class="placeholder..." data-news-id="...">...<a href="...">...<span class="plc-title">title</span>...<span class="review-num">NNN评</span>
    pattern = r'data-news-id="(\d+)".*?href="([^"]*)".*?class="plc-title">([^<]*)<.*?class="review-num">(\d+)评'
    matches = _re.findall(pattern, html, _re.DOTALL)
    for news_id, href, title, hot in matches[:15]:
        url = f"https://www.ithome.com/0/{news_id[:3]}/{news_id[3:]}.htm" if len(news_id) > 3 else href
        items.append({"title": title.strip(), "hot": int(hot), "url": url})
    return items


def _fetch_sspai() -> list[dict]:
    resp = _get("https://sspai.com/api/v1/article/tag/page/get?limit=15&tag=%E7%83%AD%E9%97%A8%E6%96%87%E7%AB%A0", timeout=8)
    items = resp.json().get("data", [])
    return [
        {"title": i.get("title", ""), "hot": i.get("like_count", 0), "url": f"https://sspai.com/post/{i.get('id', '')}"}
        for i in items[:15]
    ]


def _fetch_qq_news() -> list[dict]:
    resp = _get("https://r.inews.qq.com/gw/event/hot_ranking_list?page_size=15", timeout=8)
    idlist = resp.json().get("idlist", [])
    items = idlist[0].get("newslist", []) if idlist else []
    return [
        {"title": i.get("title", ""), "hot": i.get("hotEvent", {}).get("hotScore", 0), "url": i.get("url", "")}
        for i in items[:15]
    ]


_FETCHERS: dict[str, callable] = {
    "douyin": _fetch_douyin,
    "kuaishou": _fetch_kuaishou,
    "bilibili": _fetch_bilibili,
    "weibo": _fetch_weibo,
    "zhihu": _fetch_zhihu,
    "baidu": _fetch_baidu,
    "toutiao": _fetch_toutiao,
    "douban-movie": _fetch_douban_movie,
    "36kr": _fetch_36kr,
    "sspai": _fetch_sspai,
    "ithome": _fetch_ithome,
    "qq-news": _fetch_qq_news,
}

_SOURCE_NAMES = {
    "douyin": "抖音", "kuaishou": "快手", "bilibili": "B站",
    "weibo": "微博", "zhihu": "知乎", "baidu": "百度",
    "toutiao": "头条", "douban-movie": "豆瓣",
    "36kr": "36氪", "sspai": "少数派", "ithome": "IT之家", "qq-news": "腾讯新闻",
}


@bp.route("/api/hotlist/<source>")
def get_hotlist(source: str):
    if source not in _FETCHERS:
        return jsonify({"error": f"Unknown source: {source}", "data": []}), 400

    now = time.time()
    cached = _cache.get(source)
    if cached and now - cached[0] < CACHE_TTL:
        return jsonify({"data": cached[1], "source": source, "name": _SOURCE_NAMES.get(source, source)})

    try:
        items = _FETCHERS[source]()
        _cache[source] = (now, items)
        return jsonify({"data": items, "source": source, "name": _SOURCE_NAMES.get(source, source)})
    except Exception as e:
        return jsonify({"data": [], "source": source, "name": _SOURCE_NAMES.get(source, source), "error": str(e)})


@bp.route("/api/hotlist")
def get_all_hotlists():
    results = {}
    now = time.time()

    for source in _FETCHERS:
        cached = _cache.get(source)
        if cached and now - cached[0] < CACHE_TTL:
            results[source] = cached[1]
            continue
        try:
            items = _FETCHERS[source]()
            _cache[source] = (now, items)
            results[source] = items
        except Exception:
            results[source] = []

    return jsonify({"data": results})


@bp.route("/api/hotlist/analyze", methods=["POST"])
def analyze_hot_topic():
    """AI 分析热点话题 — 需要登录 + AI 配置。"""
    from web_runner.routes.auth import _current_user_id, _is_auth_enabled

    if _is_auth_enabled() and _current_user_id() is None:
        return jsonify({"success": False, "message": "请先登录"}), 401

    data = request.get_json(silent=True) or {}
    title = data.get("title", "").strip()
    url = data.get("url", "").strip()
    source = data.get("source", "")

    if not title:
        return jsonify({"success": False, "message": "话题标题不能为空"}), 400

    # 尝试抓取页面内容（失败则只用标题）
    content_snippet = ""
    if url:
        try:
            resp = _get(url, timeout=8, headers={"Accept": "text/html"})
            # 简单提取文本，去掉 HTML 标签
            text = _re.sub(r"<script[^>]*>.*?</script>", "", resp.text, flags=_re.DOTALL)
            text = _re.sub(r"<style[^>]*>.*?</style>", "", text, flags=_re.DOTALL)
            text = _re.sub(r"<[^>]+>", " ", text)
            text = _re.sub(r"\s+", " ", text).strip()
            content_snippet = text[:2000]  # 截取前 2000 字
        except Exception:
            pass

    # 调用 AI 生成分析
    try:
        from web_runner.routes.ai import _ai_request_queue, _ensure_ai_worker, _has_any_api_key
        import threading

        if not _has_any_api_key():
            return jsonify({"success": False, "message": "AI 服务未配置，请在设置中配置 API Key"})

        _ensure_ai_worker()

        prompt = f"""请分析以下热点话题，给出简洁的解读：

话题：{title}
来源：{source}
{f'相关内容摘要：{content_snippet[:1500]}' if content_snippet else ''}

请从以下几个方面分析（每点 1-2 句话）：
1. 事件概要：发生了什么
2. 核心争议/关注点
3. 可能的影响
4. 建议关注的方向"""

        system_prompt = "你是一个专业的热点分析师，擅长用简洁清晰的语言解读新闻事件。回答要客观、有深度，但保持简洁。"

        result_holder: dict = {}
        result_event = threading.Event()
        _ai_request_queue.put((
            result_event,
            {"prompt": prompt, "model": "google/gemma-4-26b-a4b-it:free", "system_prompt": system_prompt},
            result_holder,
        ))
        result_event.wait(timeout=60)

        if not result_event.is_set():
            return jsonify({"success": False, "message": "AI 分析超时，请稍后重试"})

        if result_holder.get("success"):
            # 记录使用
            try:
                from web_runner.middleware.usage_metering import log_action
                uid = _current_user_id()
                if uid:
                    log_action(uid, "hotlist_ai_analyze")
            except Exception:
                pass
            return jsonify({
                "success": True,
                "analysis": result_holder.get("content", ""),
                "title": title,
                "source": source,
            })
        else:
            return jsonify({"success": False, "message": result_holder.get("message", "AI 分析失败")})

    except Exception as e:
        return jsonify({"success": False, "message": f"分析出错: {str(e)[:100]}"})
