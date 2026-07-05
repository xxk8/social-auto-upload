## 1. Web API — 配额与依赖接入

- [ ] 1.1 在 `pyproject.toml` `dependencies` 数组里加 `"yt-dlp>=2024.10.7"`
- [ ] 1.2 在 `web_runner/middleware/usage_metering.py` 把 `"/api/inbox/": "inbox"` 加进 `_ENDPOINT_ACTION_MAP`;`_METERED_PREFIXES` 元组末尾加 `"/api/inbox/"`;`TIER_LIMITS` 加 `"inbox": int(os.environ.get("SAU_TIER_FREE_INBOX", "20"))`

## 2. Web API — 新蓝图实现

- [ ] 2.1 新建 `web_runner/routes/inbox.py`,写 `POST /api/inbox/download`、`POST /api/inbox/transcribe`、`GET /api/inbox/file/<name>` 三路由(共 ~60 行)
  - **download**:`subprocess.run(["yt-dlp", "--no-playlist", "--quiet", "--print", "after_move:filepath", "-o", str(DIR / "%(epoch>%H%M%S)s_%(id)s.%(ext)s"), url], cwd=str(DIR), timeout=180)`,读到 stdout 的最终路径写回 filename
  - **transcribe**:读 `OPENAI_API_KEY`,`requests.post("https://api.openai.com/v1/audio/transcriptions", files={"file": (name, f)}, data={"model": "whisper-1", "response_format": "srt"}, stream=True)`,把 `iter_content` 直接 yield 给 `Response(generator, mimetype="text/plain; charset=utf-8")`
  - **serve**:`send_from_directory(str(DIR), name)`,复用 `/api/inbox/*` 已有的 auth gate
- [ ] 2.2 在 `web_runner/__init__.py` 注册 `from web_runner.routes.inbox import bp as inbox_bp` + `app.register_blueprint(inbox_bp)`

## 3. Frontend — 1 个按钮接通

- [ ] 3.1 在 `sau_web/frontend/src/Components/AiPanel/AiPanelToolbar.tsx` 加"粘贴链接"按钮:点开 Popover → `<Input url>` → submit → POST `/api/inbox/download` 拿 `filename` → POST `/api/inbox/transcribe` 拿 srt → 写入 `<AiPanel>` 的 prompt textarea。把 download + transcribe 串成单一 TanStack mutation,失败有 toast。

## 4. 测试

- [ ] 4.1 加 `tests/test_inbox_url_validation.py`,断言 `/api/inbox/download` 在 url 为空或非 `http(s)://` 时返回 400(SaaS smoke;不真触发 yt-dlp)
- [ ] 4.2 跑 `pytest tests/test_inbox_url_validation.py tests/test_auth.py` 验证不回归
